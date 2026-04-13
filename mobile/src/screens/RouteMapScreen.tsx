import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAuthStore } from '../lib/useAuthStore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { api } from '../lib/api';
import { getDatabase } from '../lib/database';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { ActionButton } from '../components/ActionButton';
import { StatusBadge } from '../components/StatusBadge';
import { InfoRow } from '../components/InfoRow';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

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

const VEHICLES = [
  { key: 'truck', label: 'Truck', icon: '\uD83D\uDE9A', edgeType: 'Road', color: colors.map.road, activeBg: 'rgba(156,163,175,0.2)' },
  { key: 'boat', label: 'Boat', icon: '\u26F5', edgeType: 'Water', color: colors.map.waterway, activeBg: 'rgba(6,182,212,0.2)' },
  { key: 'drone', label: 'Drone', icon: '\uD83D\uDEE9\uFE0F', edgeType: 'Air', color: colors.map.airway, activeBg: 'rgba(245,158,11,0.2)' },
] as const;

export default function RouteMapScreen({ onBack }: { onBack: () => void }) {
  const { token } = useAuthStore();
  const isOnline = useOnlineStatus();
  const webViewRef = useRef<WebView>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoute, setActiveRoute] = useState<RouteResult | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<'truck' | 'boat' | 'drone'>('truck');
  const [showLegend, setShowLegend] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const fetchGraph = useCallback(async () => {
    const db = await getDatabase();
    try {
      const json = await api.get<{ data: { nodes: GraphNode[]; edges: GraphEdge[] } }>('/routes/graph');
      if (json.data) {
        setNodes(json.data.nodes); setEdges(json.data.edges);
        await db.execAsync('DELETE FROM cached_nodes');
        await db.execAsync('DELETE FROM cached_edges');
        for (const n of json.data.nodes) {
          await db.runAsync('INSERT OR REPLACE INTO cached_nodes (id, name, type, lat, lng, status) VALUES (?, ?, ?, ?, ?, ?)', [n.id, n.name, n.type, n.lat, n.lng, n.status]);
        }
        for (const e of json.data.edges) {
          await db.runAsync('INSERT OR REPLACE INTO cached_edges (id, source_id, target_id, type, distance, travel_time, risk_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [e.id, e.source_id, e.target_id, e.type, e.distance, e.travel_time, e.risk_score, e.status]);
        }
      }
    } catch {
      const cachedNodes = await db.getAllAsync<GraphNode>('SELECT * FROM cached_nodes');
      const cachedEdges = await db.getAllAsync<GraphEdge>('SELECT * FROM cached_edges');
      if (cachedNodes.length > 0) { setNodes(cachedNodes); setEdges(cachedEdges); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    if (nodes.length > 0 && webViewRef.current) {
      webViewRef.current.injectJavaScript(`updateGraph(${JSON.stringify(nodes)}, ${JSON.stringify(edges)}); true;`);
    }
  }, [nodes, edges]);

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`updateActiveRoute(${JSON.stringify(activeRoute)}); true;`);
    }
  }, [activeRoute]);

  const findRoute = async (source: string, target: string) => {
    try {
      const json = await api.post<{ data: RouteResult }>('/routes/find-path', { source, target, vehicle_type: selectedVehicle });
      setActiveRoute(json.data);
      setSelectedNode(null);
      if (!json.data.found) Alert.alert('No Route', json.data.message || 'No route found');
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const toggleEdgeStatus = async (edgeId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'open' ? 'washed_out' : 'open';
    try {
      const json = await api.patch<{ data: any }>(`/routes/edges/${edgeId}/status`, { status: newStatus });
      if (json.data) {
        await fetchGraph();
        setSelectedEdge(null);
        if (json.data.affected_deliveries?.length > 0) {
          Alert.alert('Rerouted', `${json.data.affected_deliveries.length} deliveries rerouted in ${json.data.computation_time_ms}ms`);
        }
      }
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const onWebViewMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'node_tap') {
        if (activeRoute) { setActiveRoute(null); return; }
        setSelectedNode(msg.node);
        setSelectedEdge(null);
      } else if (msg.type === 'edge_tap') {
        setSelectedEdge(msg.edge);
        setSelectedNode(null);
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
  body{margin:0;padding:0;background:#0f172a}
  #map{width:100%;height:100vh}
  .node-label{font-size:11px;font-weight:bold;color:#fff;text-shadow:1px 1px 3px #000,0 0 8px rgba(0,0,0,0.8)}
  .leaflet-tile-pane{opacity:0.7}
</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map',{zoomControl:false}).setView([24.95,91.75],10);
try {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'OSM',maxZoom:18,errorTileUrl:'',
  }).addTo(map);
} catch(e) {}

var nodeLayer = L.layerGroup().addTo(map);
var edgeLayer = L.layerGroup().addTo(map);
var routeLayer = L.layerGroup().addTo(map);
var graphNodes = [], graphEdges = [];

var nodeColors = {hub:'#3b82f6',camp:'#22c55e',waypoint:'#9ca3af',drone_base:'#f97316'};
var edgeColors = {road:'#6b7280',waterway:'#06b6d4',airway:'#f97316'};

function updateGraph(nodes, edges) {
  graphNodes = nodes; graphEdges = edges;
  nodeLayer.clearLayers(); edgeLayer.clearLayers();

  edges.forEach(function(e) {
    var src = nodes.find(function(n){return n.id===e.source_id});
    var tgt = nodes.find(function(n){return n.id===e.target_id});
    if(!src||!tgt) return;
    var isFailed = e.status==='washed_out'||e.status==='closed';
    var line = L.polyline([[src.lat,src.lng],[tgt.lat,tgt.lng]],{
      color: isFailed ? '#ef4444' : (edgeColors[e.type]||'#6b7280'),
      weight: isFailed ? 6 : 4,
      dashArray: isFailed ? '10,6' : null,
      opacity: isFailed ? 0.9 : 0.6,
    }).addTo(edgeLayer);
    var hitLine = L.polyline([[src.lat,src.lng],[tgt.lat,tgt.lng]],{
      color:'transparent', weight:25, opacity:0,
    }).addTo(edgeLayer);
    var mid = [(src.lat+tgt.lat)/2,(src.lng+tgt.lng)/2];
    L.marker(mid,{icon:L.divIcon({className:'node-label',
      html:'<span style="color:'+(isFailed?'#ef4444':'#94a3b8')+';font-size:10px">'+e.travel_time+'m</span>',
      iconSize:[40,14],iconAnchor:[20,7]})}).addTo(edgeLayer);
    function tapEdge(){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'edge_tap',edge:e}));
    }
    line.on('click',tapEdge); hitLine.on('click',tapEdge);
  });

  nodes.forEach(function(n) {
    var color = nodeColors[n.type]||'#9ca3af';
    var circle = L.circleMarker([n.lat,n.lng],{
      radius:10, fillColor:color, color:'#1e293b', weight:2, fillOpacity:0.9
    }).addTo(nodeLayer);
    circle.bindTooltip(n.name,{permanent:true,direction:'top',className:'node-label',offset:[0,-14]});
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
    L.polyline(coords,{color:'#facc15',weight:6,opacity:0.95}).addTo(routeLayer);
    L.circleMarker(coords[0],{radius:14,fillColor:'#22c55e',color:'#fff',weight:3,fillOpacity:1}).addTo(routeLayer);
    L.circleMarker(coords[coords.length-1],{radius:14,fillColor:'#ef4444',color:'#fff',weight:3,fillOpacity:1}).addTo(routeLayer);
  }
}

</script>
</body></html>`;

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent.blue} />
          <Text style={s.loadingText}>Loading graph data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerTitle}>Route Map</Text>
          <Text style={s.headerSub}>{nodes.length} nodes {'\u2022'} {edges.length} edges</Text>
        </View>
        <View style={s.headerRight}>
          <OnlineIndicator isOnline={isOnline} compact />
          <TouchableOpacity onPress={() => setShowLegend(!showLegend)} style={s.legendBtn}>
            <Text style={s.legendBtnText}>{'i'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Vehicle selector */}
      <View style={s.vehicleBar}>
        {VEHICLES.map(v => {
          const active = selectedVehicle === v.key;
          return (
            <TouchableOpacity
              key={v.key}
              style={[s.vehicleChip, active && { backgroundColor: v.activeBg, borderColor: v.color }]}
              onPress={() => { setSelectedVehicle(v.key); setActiveRoute(null); }}
              activeOpacity={0.7}
            >
              <Text style={s.vehicleEmoji}>{v.icon}</Text>
              <Text style={[s.vehicleLabel, active && { color: v.color, fontWeight: fontWeight.semibold }]}>{v.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Route info card */}
      {activeRoute?.found && (
        <View style={s.routeCard}>
          <View style={s.routeCardHeader}>
            <StatusBadge label={activeRoute.vehicle_type?.toUpperCase() || 'ROUTE'} color={colors.accent.blue} />
            <TouchableOpacity onPress={() => setActiveRoute(null)}>
              <Text style={s.routeClose}>{'\u2717'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.routePath}>
            {activeRoute.source} {'\u2192'} {activeRoute.target}
          </Text>
          <View style={s.routeStats}>
            <View style={s.routeStat}>
              <Text style={s.routeStatValue}>{activeRoute.total_distance_km}</Text>
              <Text style={s.routeStatLabel}>km</Text>
            </View>
            <View style={s.routeStatDivider} />
            <View style={s.routeStat}>
              <Text style={s.routeStatValue}>{activeRoute.total_travel_time_min}</Text>
              <Text style={s.routeStatLabel}>min</Text>
            </View>
            <View style={s.routeStatDivider} />
            <View style={s.routeStat}>
              <Text style={s.routeStatValue}>{activeRoute.computation_time_ms}</Text>
              <Text style={s.routeStatLabel}>ms</Text>
            </View>
          </View>
        </View>
      )}

      {/* Map */}
      <WebView
        ref={webViewRef}
        source={{ html: leafletHtml }}
        style={s.map}
        onMessage={onWebViewMessage}
        javaScriptEnabled
        originWhitelist={['*']}
        onLoad={() => {
          if (nodes.length > 0 && webViewRef.current) {
            webViewRef.current.injectJavaScript(`updateGraph(${JSON.stringify(nodes)}, ${JSON.stringify(edges)}); true;`);
          }
        }}
      />

      {/* Legend overlay */}
      {showLegend && (
        <View style={s.legendOverlay}>
          <Card style={s.legendCard}>
            <Text style={s.legendTitle}>Legend</Text>
            <Text style={s.legendSection}>EDGES</Text>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.road }]} /><Text style={s.legendLabel}>Road</Text></View>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.waterway }]} /><Text style={s.legendLabel}>Waterway</Text></View>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.airway }]} /><Text style={s.legendLabel}>Airway</Text></View>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.failure }]} /><Text style={s.legendLabel}>Failed</Text></View>
            <Text style={[s.legendSection, { marginTop: spacing.sm }]}>NODES</Text>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.hub }]} /><Text style={s.legendLabel}>Hub</Text></View>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.camp }]} /><Text style={s.legendLabel}>Camp</Text></View>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.waypoint }]} /><Text style={s.legendLabel}>Waypoint</Text></View>
            <View style={s.legendRow}><View style={[s.legendDot, { backgroundColor: colors.map.droneBase }]} /><Text style={s.legendLabel}>Drone Base</Text></View>
            <ActionButton title="Close" onPress={() => setShowLegend(false)} variant="ghost" size="sm" />
          </Card>
        </View>
      )}

      {/* Node selection bottom sheet */}
      {selectedNode && (
        <View style={s.bottomSheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View>
              <Text style={s.sheetTitle}>{selectedNode.name}</Text>
              <Text style={s.sheetSub}>{selectedNode.type} node</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedNode(null)}>
              <Text style={s.sheetClose}>{'\u2717'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.sheetLabel}>Route to destination ({selectedVehicle})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.destScroll}>
            {nodes.filter(n => n.id !== selectedNode.id).map(n => (
              <TouchableOpacity key={n.id} style={s.destCard} onPress={() => findRoute(selectedNode.id, n.id)}>
                <View style={[s.destDot, { backgroundColor: (colors.map as any)[n.type] || colors.map.waypoint }]} />
                <Text style={s.destName}>{n.name}</Text>
                <Text style={s.destType}>{n.type}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Edge detail bottom sheet */}
      {selectedEdge && (
        <View style={s.bottomSheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View>
              <Text style={s.sheetTitle}>Edge Details</Text>
              <StatusBadge
                label={selectedEdge.status}
                color={selectedEdge.status === 'open' ? colors.status.success : colors.status.error}
                dot
              />
            </View>
            <TouchableOpacity onPress={() => setSelectedEdge(null)}>
              <Text style={s.sheetClose}>{'\u2717'}</Text>
            </TouchableOpacity>
          </View>
          <InfoRow label="Type" value={selectedEdge.type} />
          <InfoRow label="Travel Time" value={`${selectedEdge.travel_time} min`} />
          <InfoRow label="Distance" value={`${selectedEdge.distance} km`} />
          <InfoRow label="Risk Score" value={String(selectedEdge.risk_score)} valueColor={selectedEdge.risk_score > 0.5 ? colors.status.error : colors.status.success} />
          <InfoRow label="Status" value={selectedEdge.status} valueColor={selectedEdge.status === 'open' ? colors.status.success : colors.status.error} />

          <ActionButton
            title={selectedEdge.status === 'open' ? 'Mark Washed Out' : 'Reopen Edge'}
            onPress={() => toggleEdgeStatus(selectedEdge.id, selectedEdge.status)}
            variant={selectedEdge.status === 'open' ? 'destructive' : 'success'}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  loadingText: { color: colors.text.muted, fontSize: fontSize.md },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.bg.card, borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  headerLeft: {},
  headerTitle: { ...textStyles.h4, color: colors.text.primary },
  headerSub: { fontSize: fontSize.xs, color: colors.text.muted, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center',
  },
  legendBtnText: { color: colors.text.tertiary, fontSize: 14, fontWeight: '600' },

  // Vehicle bar
  vehicleBar: {
    flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg.primary,
  },
  vehicleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.full, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
  },
  vehicleEmoji: { fontSize: 14 },
  vehicleLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.text.muted },

  // Route card
  routeCard: {
    position: 'absolute', top: 100, left: spacing.lg, right: spacing.lg, zIndex: 10,
    backgroundColor: `${colors.bg.card}f0`, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border.default,
  },
  routeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  routeClose: { color: colors.text.muted, fontSize: 18 },
  routePath: { ...textStyles.h4, color: colors.text.primary, marginBottom: spacing.sm },
  routeStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  routeStat: { flex: 1, alignItems: 'center' },
  routeStatValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.map.route },
  routeStatLabel: { fontSize: fontSize.xs, color: colors.text.muted },
  routeStatDivider: { width: 1, height: 30, backgroundColor: colors.border.default },

  // Map
  map: { flex: 1, backgroundColor: '#0f172a' },

  // Legend overlay
  legendOverlay: { position: 'absolute', top: 80, right: spacing.lg, zIndex: 20 },
  legendCard: { padding: spacing.md, minWidth: 160 },
  legendTitle: { ...textStyles.h4, color: colors.text.primary, marginBottom: spacing.md },
  legendSection: { ...textStyles.label, color: colors.text.muted, marginBottom: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { fontSize: fontSize.sm, color: colors.text.secondary },

  // Bottom sheet
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.bg.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing['3xl'],
    borderWidth: 1, borderColor: colors.border.default, borderBottomWidth: 0,
    zIndex: 30,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border.light, alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  sheetTitle: { ...textStyles.h3, color: colors.text.primary },
  sheetSub: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: 2 },
  sheetClose: { color: colors.text.muted, fontSize: 22, padding: spacing.xs },
  sheetLabel: { ...textStyles.label, color: colors.text.muted, marginBottom: spacing.sm },

  // Destination cards
  destScroll: { marginBottom: spacing.sm },
  destCard: {
    backgroundColor: colors.bg.elevated, borderRadius: radius.md,
    padding: spacing.md, marginRight: spacing.sm,
    borderWidth: 1, borderColor: colors.border.default,
    minWidth: 100, alignItems: 'center',
  },
  destDot: { width: 10, height: 10, borderRadius: 5, marginBottom: spacing.xs },
  destName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.primary, textAlign: 'center' },
  destType: { fontSize: fontSize.xs, color: colors.text.muted, marginTop: 2 },
});
