const { getDb } = require('../db/connection');

// Vehicle type → allowed edge types
const VEHICLE_EDGE_MAP = {
  truck: ['road'],
  boat: ['waterway'],
  drone: ['airway'],
};

const DRONE_MAX_PAYLOAD_KG = 15;

// Load full graph from DB as adjacency list
function loadGraph() {
  const db = getDb();
  const nodes = db.prepare('SELECT * FROM nodes').all();
  const edges = db.prepare('SELECT * FROM edges').all();
  return { nodes, edges };
}

// Build adjacency list filtered by vehicle type and edge status
function buildAdjacencyList(edges, vehicleType) {
  const allowedTypes = VEHICLE_EDGE_MAP[vehicleType];
  if (!allowedTypes) throw new Error(`Unknown vehicle type: ${vehicleType}`);

  const adj = {};
  for (const edge of edges) {
    // Skip closed/washed_out edges
    if (edge.status === 'closed' || edge.status === 'washed_out') continue;
    // Skip edges not allowed for this vehicle
    if (!allowedTypes.includes(edge.type)) continue;

    if (!adj[edge.source_id]) adj[edge.source_id] = [];
    if (!adj[edge.target_id]) adj[edge.target_id] = [];

    const weight = edge.travel_time * (1 + edge.risk_score);

    // Treat edges as bidirectional
    adj[edge.source_id].push({
      target: edge.target_id,
      weight,
      edge_id: edge.id,
      distance: edge.distance,
      travel_time: edge.travel_time,
    });
    adj[edge.target_id].push({
      target: edge.source_id,
      weight,
      edge_id: edge.id,
      distance: edge.distance,
      travel_time: edge.travel_time,
    });
  }
  return adj;
}

// Dijkstra's shortest path
function dijkstra(adj, source, target) {
  const dist = {};
  const prev = {};
  const prevEdge = {};
  const visited = new Set();

  // Priority queue (simple array — graph is small)
  const pq = [];

  dist[source] = 0;
  pq.push({ node: source, cost: 0 });

  while (pq.length > 0) {
    // Extract min
    pq.sort((a, b) => a.cost - b.cost);
    const { node: u, cost } = pq.shift();

    if (visited.has(u)) continue;
    visited.add(u);

    if (u === target) break;

    const neighbors = adj[u] || [];
    for (const { target: v, weight, edge_id, distance, travel_time } of neighbors) {
      if (visited.has(v)) continue;
      const newDist = dist[u] + weight;
      if (dist[v] === undefined || newDist < dist[v]) {
        dist[v] = newDist;
        prev[v] = u;
        prevEdge[v] = edge_id;
        pq.push({ node: v, cost: newDist });
      }
    }
  }

  if (dist[target] === undefined) return null;

  // Reconstruct path
  const path = [];
  const edgesUsed = [];
  let current = target;
  while (current !== source) {
    path.unshift(current);
    edgesUsed.unshift(prevEdge[current]);
    current = prev[current];
  }
  path.unshift(source);

  return { path, edges_used: edgesUsed, total_weight: dist[target] };
}

// Main pathfinding function
function findPath(source, target, vehicleType, payloadWeightKg) {
  const startTime = Date.now();
  const db = getDb();

  // Validate nodes exist
  const sourceNode = db.prepare('SELECT id FROM nodes WHERE id = ?').get(source);
  const targetNode = db.prepare('SELECT id FROM nodes WHERE id = ?').get(target);
  if (!sourceNode) throw new Error(`Source node not found: ${source}`);
  if (!targetNode) throw new Error(`Target node not found: ${target}`);

  // Drone payload check
  if (vehicleType === 'drone' && payloadWeightKg && payloadWeightKg > DRONE_MAX_PAYLOAD_KG) {
    throw new Error(`Payload ${payloadWeightKg}kg exceeds drone max ${DRONE_MAX_PAYLOAD_KG}kg`);
  }

  const edges = db.prepare('SELECT * FROM edges').all();
  const adj = buildAdjacencyList(edges, vehicleType);
  const result = dijkstra(adj, source, target);

  const computationTimeMs = Date.now() - startTime;

  if (!result) {
    return {
      found: false,
      source,
      target,
      vehicle_type: vehicleType,
      message: `No ${vehicleType} route from ${source} to ${target}`,
      computation_time_ms: computationTimeMs,
    };
  }

  // Compute total distance and travel time from the edges used
  const edgeRows = db.prepare(
    `SELECT * FROM edges WHERE id IN (${result.edges_used.map(() => '?').join(',')})`
  ).all(...result.edges_used);
  const edgeMap = {};
  for (const e of edgeRows) edgeMap[e.id] = e;

  let totalDistance = 0;
  let totalTravelTime = 0;
  const edgeDetails = result.edges_used.map(eid => {
    const e = edgeMap[eid];
    totalDistance += e.distance;
    totalTravelTime += e.travel_time;
    return { id: e.id, source: e.source_id, target: e.target_id, type: e.type, distance: e.distance, travel_time: e.travel_time, status: e.status };
  });

  return {
    found: true,
    source,
    target,
    vehicle_type: vehicleType,
    path: result.path,
    edges: edgeDetails,
    total_distance_km: Math.round(totalDistance * 100) / 100,
    total_travel_time_min: Math.round(totalTravelTime * 100) / 100,
    total_weight: Math.round(result.total_weight * 100) / 100,
    computation_time_ms: computationTimeMs,
  };
}

// Update edge status and re-route affected deliveries
function updateEdgeStatus(edgeId, newStatus, broadcast) {
  const startTime = Date.now();
  const db = getDb();

  const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
  if (!edge) throw new Error(`Edge not found: ${edgeId}`);

  const oldStatus = edge.status;
  db.prepare('UPDATE edges SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newStatus, edgeId);

  // Broadcast edge change
  if (broadcast) {
    broadcast('EDGE_STATUS_CHANGED', {
      edge_id: edgeId,
      old_status: oldStatus,
      new_status: newStatus,
      source_id: edge.source_id,
      target_id: edge.target_id,
      type: edge.type,
    });
  }

  // Find affected active deliveries whose route_data includes this edge
  const activeDeliveries = db.prepare(
    "SELECT * FROM deliveries WHERE status IN ('pending', 'in_transit') AND route_data IS NOT NULL"
  ).all();

  const affected = [];
  for (const delivery of activeDeliveries) {
    let routeData;
    try { routeData = JSON.parse(delivery.route_data); } catch { continue; }
    if (!routeData.edges || !routeData.edges.some(e => e.id === edgeId)) continue;

    // Re-compute route
    try {
      const newRoute = findPath(delivery.source_node_id, delivery.target_node_id, delivery.vehicle_type);
      db.prepare('UPDATE deliveries SET route_data = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(newRoute), delivery.id);

      affected.push({ delivery_id: delivery.id, status: 'rerouted', new_route: newRoute });

      if (broadcast) {
        broadcast('ROUTE_RECALCULATED', { delivery_id: delivery.id, route: newRoute });
      }
    } catch (err) {
      affected.push({ delivery_id: delivery.id, status: 'no_route', error: err.message });
    }
  }

  return {
    edge_id: edgeId,
    old_status: oldStatus,
    new_status: newStatus,
    affected_deliveries: affected,
    computation_time_ms: Date.now() - startTime,
  };
}

module.exports = { loadGraph, findPath, updateEdgeStatus, VEHICLE_EDGE_MAP, DRONE_MAX_PAYLOAD_KG };
