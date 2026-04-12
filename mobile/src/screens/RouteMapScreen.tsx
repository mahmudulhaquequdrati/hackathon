import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAuthStore } from '../lib/useAuthStore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { api } from '../lib/api';
import { getDatabase } from '../lib/database';

interface GraphNode {
  id: string; name: string; type: string; lat: number; lng: number; status: string;
}
interface GraphEdge {
  id: string; source_id: string; target_id: string; type: string;
  distance: number; travel_time: number; risk_score: number; status: string;
}
interface RouteResult {
  found: boolean; path?: string[]; edges?: any[]; total_distance_km?: number;
  total_travel_time_min?: number; computation_time_ms?: number; message?: string;
  vehicle_type?: string; source?: string; target?: string;
}

export default function RouteMapScreen({ onBack }: { onBack: () => void }) {
  const { token } = useAuthStore();
  const isOnline = useOnlineStatus();
  const webViewRef = useRef<WebView>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoute, setActiveRoute] = useState<RouteResult | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<'truck' | 'boat' | 'drone'>('truck');

  const fetchGraph = useCallback(async () => {
    const db = await getDatabase();
    try {
      const json = await api.get<{ data: { nodes: GraphNode[]; edges: GraphEdge[] } }>('/routes/graph');
      if (json.data) {
        setNodes(json.data.nodes);
        setEdges(json.data.edges);
        // Cache to local DB for offline use
        await db.execAsync('DELETE FROM cached_nodes');
        await db.execAsync('DELETE FROM cached_edges');
        for (const n of json.data.nodes) {
          await db.runAsync(
            'INSERT OR REPLACE INTO cached_nodes (id, name, type, lat, lng, status) VALUES (?, ?, ?, ?, ?, ?)',
            [n.id, n.name, n.type, n.lat, n.lng, n.status],
          );
        }
        for (const e of json.data.edges) {
          await db.runAsync(
            'INSERT OR REPLACE INTO cached_edges (id, source_id, target_id, type, distance, travel_time, risk_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [e.id, e.source_id, e.target_id, e.type, e.distance, e.travel_time, e.risk_score, e.status],
          );
        }
      }
    } catch {
      // Offline — load from local cache
      const cachedNodes = await db.getAllAsync<GraphNode>('SELECT * FROM cached_nodes');
      const cachedEdges = await db.getAllAsync<GraphEdge>('SELECT * FROM cached_edges');
      if (cachedNodes.length > 0) {
        setNodes(cachedNodes);
        setEdges(cachedEdges);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // Push updated graph data to WebView
  useEffect(() => {
    if (nodes.length > 0 && webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        updateGraph(${JSON.stringify(nodes)}, ${JSON.stringify(edges)});
        true;
      `);
    }
  }, [nodes, edges]);

  // Push active route to WebView
  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        updateActiveRoute(${JSON.stringify(activeRoute)});
        true;
      `);
    }
  }, [activeRoute]);

  const findRoute = async (source: string, target: string) => {
    try {
      const json = await api.post<{ data: RouteResult }>('/routes/find-path', {
        source, target, vehicle_type: selectedVehicle,
      });
      setActiveRoute(json.data);
      if (!json.data.found) {
        Alert.alert('No Route', json.data.message || 'No route found');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const toggleEdgeStatus = async (edgeId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'open' ? 'washed_out' : 'open';
    try {
      const json = await api.patch<{ data: any }>(`/routes/edges/${edgeId}/status`, {
        status: newStatus,
      });
      if (json.data) {
        await fetchGraph();
        if (json.data.affected_deliveries?.length > 0) {
          Alert.alert('Rerouted', `${json.data.affected_deliveries.length} deliveries rerouted in ${json.data.computation_time_ms}ms`);
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // Handle messages from WebView (node taps, edge taps)
  const onWebViewMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'node_tap') {
        if (!activeRoute) {
          // First tap = source, find routes to all other nodes
          Alert.alert('Route From', `Select destination for ${selectedVehicle} from ${msg.node.name}`, [
            ...nodes.filter(n => n.id !== msg.node.id).map(n => ({
              text: n.name, onPress: () => findRoute(msg.node.id, n.id),
            })),
            { text: 'Cancel', style: 'cancel' as const },
          ]);
        } else {
          setActiveRoute(null); // Clear route on tap
        }
      } else if (msg.type === 'edge_tap') {
        Alert.alert(
          `Edge: ${msg.edge.id}`,
          `Type: ${msg.edge.type}\nStatus: ${msg.edge.status}\nTravel: ${msg.edge.travel_time}min\nRisk: ${msg.edge.risk_score}`,
          [
            { text: msg.edge.status === 'open' ? 'Mark Washed Out' : 'Reopen',
              onPress: () => toggleEdgeStatus(msg.edge.id, msg.edge.status),
              style: 'destructive' as const },
            { text: 'Close', style: 'cancel' as const },
          ]
        );
      }
    } catch {}
  };

  const leafletHtml = `
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body{margin:0;padding:0;background:#1a1a2e}
  #map{width:100%;height:100vh}
  .node-label{font-size:11px;font-weight:bold;color:#fff;text-shadow:1px 1px 2px #000}
</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map',{zoomControl:false}).setView([24.95,91.75],10);
try {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'OSM',maxZoom:18,errorTileUrl:'',
  }).addTo(map);
} catch(e) {
  // Offline — map works without tiles, nodes/edges still visible
}

var nodeLayer = L.layerGroup().addTo(map);
var edgeLayer = L.layerGroup().addTo(map);
var routeLayer = L.layerGroup().addTo(map);
var graphNodes = [], graphEdges = [];

var nodeColors = {hub:'#3b82f6',camp:'#22c55e',waypoint:'#9ca3af',drone_base:'#f97316'};
var edgeColors = {road:'#6b7280',waterway:'#06b6d4',airway:'#f97316'};

function updateGraph(nodes, edges) {
  graphNodes = nodes; graphEdges = edges;
  nodeLayer.clearLayers(); edgeLayer.clearLayers();

  // Draw edges
  edges.forEach(function(e) {
    var src = nodes.find(function(n){return n.id===e.source_id});
    var tgt = nodes.find(function(n){return n.id===e.target_id});
    if(!src||!tgt) return;
    var isFailed = e.status==='washed_out'||e.status==='closed';
    var line = L.polyline([[src.lat,src.lng],[tgt.lat,tgt.lng]],{
      color: isFailed ? '#ef4444' : (edgeColors[e.type]||'#6b7280'),
      weight: isFailed ? 6 : 5,
      dashArray: isFailed ? '10,6' : null,
      opacity: isFailed ? 0.9 : 0.7,
    }).addTo(edgeLayer);
    // Invisible fat line for easier touch on mobile
    var hitLine = L.polyline([[src.lat,src.lng],[tgt.lat,tgt.lng]],{
      color:'transparent', weight:25, opacity:0,
    }).addTo(edgeLayer);
    // Midpoint label
    var mid = [(src.lat+tgt.lat)/2,(src.lng+tgt.lng)/2];
    L.marker(mid,{icon:L.divIcon({className:'node-label',
      html:'<span style="color:'+(isFailed?'#ef4444':'#ccc')+'">'+e.type+' '+e.travel_time+'m</span>',
      iconSize:[80,16],iconAnchor:[40,8]})}).addTo(edgeLayer);
    function tapEdge(){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'edge_tap',edge:e}));
    }
    line.on('click',tapEdge);
    hitLine.on('click',tapEdge);
  });

  // Draw nodes
  nodes.forEach(function(n) {
    var color = nodeColors[n.type]||'#9ca3af';
    var circle = L.circleMarker([n.lat,n.lng],{
      radius:10, fillColor:color, color:'#fff', weight:2, fillOpacity:0.9
    }).addTo(nodeLayer);
    circle.bindTooltip(n.name,{permanent:true,direction:'top',className:'node-label',offset:[0,-12]});
    circle.on('click',function(){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'node_tap',node:n}));
    });
  });
}

function updateActiveRoute(route) {
  routeLayer.clearLayers();
  if(!route||!route.found||!route.path) return;
  var coords = [];
  route.path.forEach(function(nid){
    var n = graphNodes.find(function(x){return x.id===nid});
    if(n) coords.push([n.lat,n.lng]);
  });
  if(coords.length>1){
    L.polyline(coords,{color:'#facc15',weight:6,opacity:0.9}).addTo(routeLayer);
    // Start/end markers
    L.circleMarker(coords[0],{radius:14,fillColor:'#22c55e',color:'#fff',weight:3,fillOpacity:1}).addTo(routeLayer);
    L.circleMarker(coords[coords.length-1],{radius:14,fillColor:'#ef4444',color:'#fff',weight:3,fillOpacity:1}).addTo(routeLayer);
  }
}
</script>
</body></html>`;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Route Map</Text>
        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#22c55e' : '#ef4444' }]} />
      </View>

      {/* Vehicle selector */}
      <View style={styles.vehicleRow}>
        {(['truck', 'boat', 'drone'] as const).map(v => (
          <TouchableOpacity
            key={v}
            style={[styles.vehicleBtn, selectedVehicle === v && styles.vehicleBtnActive]}
            onPress={() => { setSelectedVehicle(v); setActiveRoute(null); }}
          >
            <Text style={[styles.vehicleText, selectedVehicle === v && styles.vehicleTextActive]}>
              {v === 'truck' ? 'Truck' : v === 'boat' ? 'Boat' : 'Drone'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Route info bar */}
      {activeRoute?.found && (
        <View style={styles.routeInfo}>
          <Text style={styles.routeInfoText}>
            {activeRoute.vehicle_type?.toUpperCase()}: {activeRoute.source} → {activeRoute.target}
          </Text>
          <Text style={styles.routeInfoText}>
            {activeRoute.total_distance_km}km | {activeRoute.total_travel_time_min}min | {activeRoute.computation_time_ms}ms
          </Text>
        </View>
      )}

      {/* Map */}
      <WebView
        ref={webViewRef}
        source={{ html: leafletHtml }}
        style={styles.map}
        onMessage={onWebViewMessage}
        javaScriptEnabled
        originWhitelist={['*']}
        onLoad={() => {
          if (nodes.length > 0 && webViewRef.current) {
            webViewRef.current.injectJavaScript(`
              updateGraph(${JSON.stringify(nodes)}, ${JSON.stringify(edges)});
              true;
            `);
          }
        }}
      />

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#6b7280' }]} /><Text style={styles.legendText}>Road</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#06b6d4' }]} /><Text style={styles.legendText}>Water</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#f97316' }]} /><Text style={styles.legendText}>Air</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} /><Text style={styles.legendText}>Failed</Text></View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#111827' },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  backText: { color: '#3b82f6', fontSize: 16 },
  title: { flex: 1, color: '#f9fafb', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  vehicleRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, padding: 8, backgroundColor: '#111827' },
  vehicleBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1f2937' },
  vehicleBtnActive: { backgroundColor: '#3b82f6' },
  vehicleText: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
  vehicleTextActive: { color: '#fff' },
  routeInfo: { backgroundColor: '#1e3a5f', padding: 8, alignItems: 'center' },
  routeInfoText: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  map: { flex: 1 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, padding: 8, backgroundColor: '#111827' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { color: '#9ca3af', fontSize: 12 },
});
