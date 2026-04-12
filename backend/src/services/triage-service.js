const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const auditService = require('./audit-service');
const { createMap, materialize } = require('../../../shared/crdt/src');

// SLA config — Priority tiers with delivery windows
const SLA_CONFIG = {
  P0: { label: 'Critical Medical', sla_hours: 2, sla_minutes: 120, examples: 'antivenom, blood products' },
  P1: { label: 'High Priority', sla_hours: 6, sla_minutes: 360, examples: 'water, emergency food' },
  P2: { label: 'Standard', sla_hours: 24, sla_minutes: 1440, examples: 'general supplies' },
  P3: { label: 'Low Priority', sla_hours: 72, sla_minutes: 4320, examples: 'non-essentials, equipment' },
};

// CRDT state for priority taxonomy (M6.1 requirement: "stored in CRDT")
let priorityCrdtState = null;

function initPriorityTaxonomy(nodeId = 'server') {
  // Create a CRDT LWW-Map storing the priority taxonomy
  const fields = {};
  for (const [tier, config] of Object.entries(SLA_CONFIG)) {
    fields[`${tier}_label`] = config.label;
    fields[`${tier}_sla_hours`] = config.sla_hours;
    fields[`${tier}_sla_minutes`] = config.sla_minutes;
    fields[`${tier}_examples`] = config.examples;
  }
  priorityCrdtState = createMap('priority-taxonomy', fields, nodeId);
  return priorityCrdtState;
}

function getPriorities() {
  if (!priorityCrdtState) initPriorityTaxonomy();
  const materialized = materialize(priorityCrdtState);
  // Also return structured form for easy consumption
  const tiers = Object.entries(SLA_CONFIG).map(([tier, config]) => ({
    tier,
    ...config,
  }));
  return {
    priorities: tiers,
    crdt_state: priorityCrdtState,
  };
}

// SQLite datetime('now') omits the Z suffix — JS treats it as local time.
// Always normalize to UTC so comparisons are consistent.
function toUtc(dateStr) {
  if (!dateStr) return dateStr;
  const s = String(dateStr).trim();
  if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)) return s;
  return s + 'Z';
}

function computeSlaDeadline(priority, createdAt) {
  const config = SLA_CONFIG[priority];
  if (!config) throw new Error(`Unknown priority: ${priority}`);
  const created = new Date(toUtc(createdAt));
  return new Date(created.getTime() + config.sla_minutes * 60 * 1000).toISOString();
}

function computeEta(routeData, departureTime) {
  if (!routeData || !routeData.total_travel_time_min) return null;
  const departure = new Date(toUtc(departureTime));
  return new Date(departure.getTime() + routeData.total_travel_time_min * 60 * 1000).toISOString();
}

function checkRouteSlowdown(oldRoute, newRoute) {
  const oldTime = oldRoute?.total_travel_time_min || 0;
  const newTime = newRoute?.total_travel_time_min || 0;
  if (oldTime <= 0) return { slowed: false, pct: 0 };
  const pct = ((newTime - oldTime) / oldTime) * 100;
  return { slowed: pct >= 30, pct: Math.round(pct * 100) / 100 };
}

function evaluateDeliveries(broadcast) {
  const db = getDb();
  const activeDeliveries = db.prepare(
    `SELECT d.*, s.name as supply_name, src.name as source_name, tgt.name as target_name
     FROM deliveries d
     LEFT JOIN supplies s ON d.supply_id = s.id
     LEFT JOIN nodes src ON d.source_node_id = src.id
     LEFT JOIN nodes tgt ON d.target_node_id = tgt.id
     WHERE d.status IN ('pending', 'in_transit') AND d.route_data IS NOT NULL`
  ).all();

  const evaluations = [];
  const now = new Date();

  for (const delivery of activeDeliveries) {
    let routeData;
    try { routeData = JSON.parse(delivery.route_data); } catch { continue; }
    if (!routeData.found) continue;

    const slaDeadline = computeSlaDeadline(delivery.priority, delivery.created_at);

    // Estimate current ETA
    let currentEta;
    if (delivery.status === 'in_transit') {
      // Estimate remaining time based on elapsed
      const elapsed = (now.getTime() - new Date(toUtc(delivery.created_at)).getTime()) / 60000;
      const remaining = Math.max(0, routeData.total_travel_time_min - elapsed);
      currentEta = new Date(now.getTime() + remaining * 60 * 1000).toISOString();
    } else {
      // Pending — use full travel time from now
      currentEta = new Date(now.getTime() + routeData.total_travel_time_min * 60 * 1000).toISOString();
    }

    const slackMinutes = (new Date(slaDeadline).getTime() - new Date(currentEta).getTime()) / 60000;
    const slaTotal = SLA_CONFIG[delivery.priority]?.sla_minutes || 1440;

    let status = 'ok';
    if (slackMinutes <= 0) {
      status = 'breach';
    } else if (slackMinutes < slaTotal * 0.3) {
      status = 'warning';
    }

    // Update ETA in DB
    db.prepare("UPDATE deliveries SET eta = ?, updated_at = datetime('now') WHERE id = ?")
      .run(currentEta, delivery.id);

    evaluations.push({
      delivery_id: delivery.id,
      priority: delivery.priority,
      supply_name: delivery.supply_name || `${delivery.priority} Cargo → ${delivery.target_name || delivery.target_node_id}`,
      source_node_id: delivery.source_node_id,
      target_node_id: delivery.target_node_id,
      source_name: delivery.source_name || delivery.source_node_id,
      target_name: delivery.target_name || delivery.target_node_id,
      vehicle_type: delivery.vehicle_type,
      sla_deadline: slaDeadline,
      current_eta: currentEta,
      slack_minutes: Math.round(slackMinutes * 100) / 100,
      status,
      travel_time_min: routeData.total_travel_time_min,
      preemption_eligible: ['P2', 'P3'].includes(delivery.priority),
    });
  }

  // Sort: breaches first, then warnings, then by priority
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const statusOrder = { breach: 0, warning: 1, ok: 2 };
  evaluations.sort((a, b) => {
    const sd = (statusOrder[a.status] || 2) - (statusOrder[b.status] || 2);
    if (sd !== 0) return sd;
    return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
  });

  const result = {
    evaluations,
    breach_count: evaluations.filter(e => e.status === 'breach').length,
    warning_count: evaluations.filter(e => e.status === 'warning').length,
    ok_count: evaluations.filter(e => e.status === 'ok').length,
    evaluated_at: now.toISOString(),
  };

  if (broadcast) {
    broadcast('TRIAGE_EVALUATED', result);
  }

  return result;
}

function findNearestWaypoint(routePath) {
  const db = getDb();
  // Get waypoint/camp nodes that could serve as drop points
  const waypoints = db.prepare(
    "SELECT * FROM nodes WHERE type IN ('waypoint', 'camp') AND status = 'active'"
  ).all();

  if (waypoints.length === 0) return null;

  // Find the waypoint that is on or closest to the route path
  for (const nodeId of routePath) {
    const wp = waypoints.find(w => w.id === nodeId);
    if (wp) return wp;
  }

  // Fallback: return first active waypoint
  return waypoints[0];
}

function buildRationale(evaluation) {
  const { priority, supply_name, slack_minutes, status, sla_deadline, current_eta, travel_time_min } = evaluation;
  if (status === 'breach') {
    return `SLA BREACH: ${priority} delivery of "${supply_name}" will miss deadline by ${Math.abs(Math.round(slack_minutes))} minutes. ` +
      `ETA: ${current_eta}, SLA deadline: ${sla_deadline}. Travel time: ${travel_time_min} min. ` +
      `Autonomous preemption triggered to prioritize critical cargo.`;
  }
  return `SLA WARNING: ${priority} delivery of "${supply_name}" has only ${Math.round(slack_minutes)} minutes of slack remaining.`;
}

function executePreemption(deliveryId, broadcast) {
  const db = getDb();
  // Lazy require to avoid circular dependency
  const routeService = require('./route-service');

  const delivery = db.prepare(
    `SELECT d.*, s.name as supply_name, tgt.name as target_name
     FROM deliveries d
     LEFT JOIN supplies s ON d.supply_id = s.id
     LEFT JOIN nodes tgt ON d.target_node_id = tgt.id
     WHERE d.id = ?`
  ).get(deliveryId);
  if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);

  let routeData;
  try { routeData = JSON.parse(delivery.route_data); } catch {
    throw new Error('No valid route data for delivery');
  }

  // Find nearest waypoint for drop-off
  const waypoint = findNearestWaypoint(routeData.path || []);
  if (!waypoint) throw new Error('No suitable waypoint found for cargo deposit');

  const now = new Date();
  const slaDeadline = computeSlaDeadline(delivery.priority, delivery.created_at);
  const oldEta = delivery.eta || computeEta(routeData, delivery.created_at);

  // Compute new route: current position → waypoint for drop, then waypoint → destination
  let newRoute = null;
  try {
    newRoute = routeService.findPath(delivery.source_node_id, delivery.target_node_id, delivery.vehicle_type);
  } catch {
    // Route may not exist — use original
  }
  const newEta = newRoute ? computeEta(newRoute, now.toISOString()) : oldEta;

  const slackMinutes = (new Date(slaDeadline).getTime() - new Date(newEta || oldEta).getTime()) / 60000;

  // Build rationale
  const displayName = delivery.supply_name || `${delivery.priority} Cargo → ${delivery.target_name || delivery.target_node_id}`;
  const rationale = `PREEMPTION EXECUTED: ${delivery.priority} cargo "${displayName}" ` +
    `on delivery ${deliveryId}. P2/P3 cargo deposited at waypoint "${waypoint.name}" (${waypoint.id}). ` +
    `Vehicle rerouted with P0/P1 cargo only. ` +
    `SLA deadline: ${slaDeadline}, predicted ETA: ${newEta || 'unknown'}. ` +
    `Slack: ${Math.round(slackMinutes)} minutes. Decision made autonomously by triage engine.`;

  // Log decision in triage_decisions table
  const decisionId = uuidv4();
  db.prepare(`
    INSERT INTO triage_decisions (id, delivery_id, decision_type, priority, old_eta, new_eta, sla_deadline, slack_minutes, dropped_cargo, waypoint_id, rationale, decided_by)
    VALUES (?, ?, 'preempt', ?, ?, ?, ?, ?, ?, ?, ?, 'system')
  `).run(
    decisionId, deliveryId, delivery.priority,
    oldEta, newEta, slaDeadline, Math.round(slackMinutes),
    JSON.stringify([delivery.supply_id]),
    waypoint.id, rationale
  );

  // Update delivery status to preempted
  db.prepare("UPDATE deliveries SET status = 'preempted', updated_at = datetime('now') WHERE id = ?")
    .run(deliveryId);

  // Log to audit trail
  auditService.appendLog('system', 'TRIAGE_PREEMPTION', 'deliveries', {
    decision_id: decisionId,
    delivery_id: deliveryId,
    priority: delivery.priority,
    waypoint_id: waypoint.id,
    waypoint_name: waypoint.name,
    rationale,
  });

  const decision = {
    id: decisionId,
    delivery_id: deliveryId,
    decision_type: 'preempt',
    priority: delivery.priority,
    supply_name: displayName,
    old_eta: oldEta,
    new_eta: newEta,
    sla_deadline: slaDeadline,
    slack_minutes: Math.round(slackMinutes),
    dropped_cargo: [delivery.supply_id],
    waypoint: { id: waypoint.id, name: waypoint.name, lat: waypoint.lat, lng: waypoint.lng },
    rationale,
    decided_by: 'system',
    created_at: now.toISOString(),
  };

  if (broadcast) {
    broadcast('PREEMPTION_EXECUTED', decision);
  }

  return decision;
}

function getDecisions({ limit = 50 } = {}) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM triage_decisions ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  // Parse JSON fields stored as strings in SQLite
  return rows.map(row => ({
    ...row,
    dropped_cargo: row.dropped_cargo ? JSON.parse(row.dropped_cargo) : [],
  }));
}

module.exports = {
  SLA_CONFIG,
  initPriorityTaxonomy,
  getPriorities,
  computeSlaDeadline,
  computeEta,
  checkRouteSlowdown,
  evaluateDeliveries,
  executePreemption,
  findNearestWaypoint,
  buildRationale,
  getDecisions,
};
