import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { api } from '../lib/api';
import { importKeyBase64 } from '../lib/crypto';
import { getDatabase } from '../lib/database';
import { countersignPod, generatePodPayload, markNonceUsed, storePodReceipt, verifyPodPayload, type PodChallenge } from '../lib/pod';
import { useAuthStore } from '../lib/useAuthStore';
import { Card } from '../components/Card';
import { ActionButton } from '../components/ActionButton';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { InfoRow } from '../components/InfoRow';
import { EmptyState } from '../components/EmptyState';
import { ChipSelector } from '../components/ChipSelector';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

interface Delivery {
  id: string; supply_id: string; source_node_id: string; target_node_id: string;
  vehicle_type: string; status: string; priority: string; driver_id: string;
  route_data: string; created_at: string; _local?: boolean;
}

const STATUS_CONFIG: Record<string, { color: string; order: number }> = {
  in_transit: { color: colors.accent.blue, order: 0 },
  pending: { color: colors.status.warning, order: 1 },
  delivered: { color: colors.status.success, order: 2 },
  failed: { color: colors.status.error, order: 3 },
  preempted: { color: colors.module.auth, order: 4 },
};

export default function DeliveryScreen({ onBack: _onBack }: { onBack: () => void }) {
  const { user, token, deviceId } = useAuthStore();
  const isOnline = useOnlineStatus();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [nodes, setNodes] = useState<{ id: string; name: string; type: string }[]>([]);
  const [formSource, setFormSource] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [formVehicle, setFormVehicle] = useState<string>('truck');
  const [formPriority, setFormPriority] = useState<string>('P2');
  const [qrData, setQrData] = useState<PodChallenge | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [chainData, setChainData] = useState<any>(null);
  const [showChain, setShowChain] = useState(false);

  const fetchDeliveries = useCallback(async () => {
    const db = await getDatabase();
    const localRows = await db.getAllAsync<Delivery>('SELECT *, 1 as _local FROM local_deliveries ORDER BY created_at DESC');
    let serverRows: Delivery[] = [];
    try {
      const json = await api.get<{ data: { deliveries: Delivery[] } }>('/delivery/');
      serverRows = json.data.deliveries || [];
    } catch {}
    const serverIds = new Set(serverRows.map(d => d.id));
    const localOnly = localRows.filter(d => !serverIds.has(d.id));
    const all = [...serverRows, ...localOnly];
    all.sort((a, b) => (STATUS_CONFIG[a.status]?.order ?? 5) - (STATUS_CONFIG[b.status]?.order ?? 5));
    setDeliveries(all);
  }, []);

  useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      try {
        const json = await api.get<{ data: { nodes: any[] } }>('/routes/graph');
        const serverNodes = json.data.nodes || [];
        if (serverNodes.length > 0) {
          await db.execAsync('DELETE FROM cached_nodes');
          for (const n of serverNodes) {
            await db.runAsync('INSERT OR REPLACE INTO cached_nodes (id, name, type, lat, lng, status) VALUES (?, ?, ?, ?, ?, ?)', [n.id, n.name, n.type, n.lat ?? null, n.lng ?? null, n.status ?? 'active']);
          }
          setNodes(serverNodes);
          if (serverNodes.length >= 2) { setFormSource(serverNodes[0].id); setFormTarget(serverNodes[1].id); }
          return;
        }
      } catch {}
      const cached = await db.getAllAsync<any>('SELECT id, name, type FROM cached_nodes');
      if (cached.length > 0) { setNodes(cached); setFormSource(cached[0].id); setFormTarget(cached[1]?.id || cached[0].id); return; }
      const fallback = [
        { id: 'base-camp', name: 'Base Camp', type: 'hub' },
        { id: 'field-hospital', name: 'Field Hospital', type: 'camp' },
        { id: 'supply-depot', name: 'Supply Depot', type: 'hub' },
        { id: 'shelter-a', name: 'Shelter A', type: 'camp' },
        { id: 'shelter-b', name: 'Shelter B', type: 'camp' },
        { id: 'drone-base', name: 'Drone Base', type: 'drone_base' },
      ];
      setNodes(fallback); setFormSource(fallback[0].id); setFormTarget(fallback[1].id);
    })();
  }, []);

  // WebSocket listener
  const wsRef = useRef<WebSocket | null>(null);
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const apiUrl = api.getBaseUrl() || '';
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/api\/v1$/, '');
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl); wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (['POD_CONFIRMED', 'DELIVERY_CREATED', 'DELIVERY_STATUS_CHANGED', 'DELIVERY_DELETED'].includes(msg.type)) {
            const now = Date.now();
            if (now - lastRefreshRef.current > 2000) { lastRefreshRef.current = now; fetchDeliveries(); }
          }
        } catch {}
      };
      ws.onerror = () => {};
    } catch {}
    return () => { try { ws?.close(); } catch {} wsRef.current = null; };
  }, [fetchDeliveries]);

  const onRefresh = async () => { setRefreshing(true); await fetchDeliveries(); setRefreshing(false); };

  const createDelivery = async () => {
    if (!formSource || !formTarget) { Alert.alert('Error', 'Select source and target'); return; }
    if (formSource === formTarget) { Alert.alert('Error', 'Source and target must differ'); return; }
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const db = await getDatabase();
    await db.runAsync('INSERT INTO local_deliveries (id, source_node_id, target_node_id, vehicle_type, priority, status, driver_id) VALUES (?, ?, ?, ?, ?, \'pending\', ?)', [id, formSource, formTarget, formVehicle, formPriority, deviceId || null]);
    try {
      const json = await api.post<{ data: Delivery }>('/delivery/', { source_node_id: formSource, target_node_id: formTarget, vehicle_type: formVehicle, priority: formPriority });
      await db.runAsync('UPDATE local_deliveries SET id = ?, synced = 1 WHERE id = ?', [json.data.id, id]);
    } catch {}
    setShowNewForm(false); fetchDeliveries();
  };

  const deleteDelivery = async (id: string) => {
    Alert.alert('Delete', `Delete delivery ${id.slice(0, 8)}...?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api.delete(`/delivery/${id}`); } catch {}
        const db = await getDatabase();
        await db.runAsync('DELETE FROM local_deliveries WHERE id = ?', [id]);
        await db.runAsync('DELETE FROM pod_receipts WHERE delivery_id = ?', [id]);
        fetchDeliveries();
      }},
    ]);
  };

  const handleGenerateQr = async (delivery: Delivery) => {
    try {
      const store = useAuthStore.getState();
      if (!store.secretKey || !store.publicKey) { Alert.alert('Error', 'No signing keys'); return; }
      const secretKey = importKeyBase64(store.secretKey);
      const publicKey = importKeyBase64(store.publicKey);
      const challenge = generatePodPayload(delivery.id, deviceId!, publicKey, secretKey, `${delivery.supply_id || delivery.id}_${delivery.priority}`);
      setQrData(challenge); setShowQr(true);
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handleScanQr = async () => {
    if (!permission?.granted) { const result = await requestPermission(); if (!result.granted) { Alert.alert('Permission Denied', 'Camera required'); return; } }
    setScanned(false); setShowScanner(true);
  };

  const scanProcessingRef = useRef(false);
  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned || scanProcessingRef.current) return;
    scanProcessingRef.current = true; setScanned(true); setShowScanner(false);
    try {
      const challenge: PodChallenge = JSON.parse(data);
      const result = await verifyPodPayload(challenge);
      if (!result.valid) { Alert.alert('Rejected', `${result.code}: ${result.message}`); return; }
      const store = useAuthStore.getState();
      if (!store.secretKey) { Alert.alert('Error', 'No signing key'); return; }
      const receiverSig = countersignPod(challenge.canonical_string, importKeyBase64(store.secretKey));
      await markNonceUsed(challenge.pod_payload.nonce, challenge.pod_payload.delivery_id);
      await storePodReceipt({ id: `pod-${Date.now()}`, delivery_id: challenge.pod_payload.delivery_id, sender_device_id: challenge.pod_payload.sender_device_id, receiver_device_id: deviceId!, sender_signature: challenge.signature, receiver_signature: receiverSig, payload_hash: challenge.pod_payload.payload_hash, nonce: challenge.pod_payload.nonce, status: 'confirmed' });
      try { await api.post(`/delivery/${challenge.pod_payload.delivery_id}/pod`, { action: 'confirm', pod_payload: challenge.pod_payload, sender_signature: challenge.signature, receiver_device_id: deviceId, receiver_signature: receiverSig }); } catch {}
      Alert.alert('Confirmed', `Delivery verified and countersigned`); fetchDeliveries();
    } catch (err: any) { Alert.alert('Error', `Invalid QR: ${err.message}`); }
    finally { scanProcessingRef.current = false; }
  };

  const handleViewChain = async (deliveryId: string) => {
    try {
      const json = await api.get<{ data: any }>(`/delivery/${deliveryId}/chain`);
      setChainData(json.data); setShowChain(true);
    } catch {
      try {
        const db = await getDatabase();
        const localReceipts = await db.getAllAsync<any>('SELECT * FROM pod_receipts WHERE delivery_id = ? ORDER BY created_at ASC', [deliveryId]);
        const delivery = deliveries.find(d => d.id === deliveryId);
        setChainData({ delivery: { id: deliveryId, status: delivery?.status || 'unknown' }, chain_length: localReceipts.length, fully_verified: localReceipts.every((r: any) => r.status === 'confirmed'), receipts: localReceipts, audit_trail: [], _offline: true });
        setShowChain(true);
      } catch (localErr: any) { Alert.alert('Error', `No chain data offline: ${localErr.message}`); }
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    const db = await getDatabase();
    await db.runAsync('UPDATE local_deliveries SET status = ? WHERE id = ?', [newStatus, id]);
    try { await api.patch(`/delivery/${id}/status`, { status: newStatus }); } catch {}
    fetchDeliveries();
  };

  const getNodeName = (nodeId: string) => nodes.find(n => n.id === nodeId)?.name || nodeId;
  const statusCfg = (status: string) => STATUS_CONFIG[status] || { color: colors.text.muted, order: 5 };

  // Group by status
  const grouped = deliveries.reduce<Record<string, Delivery[]>>((acc, d) => {
    if (!d?.id) return acc;
    const key = d.status || 'pending';
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => (statusCfg(a).order) - (statusCfg(b).order));

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <View>
          <Text style={st.headerTitle}>Deliveries</Text>
          <Text style={st.headerSub}>{deliveries.length} total</Text>
        </View>
        <View style={st.headerRight}>
          <OnlineIndicator isOnline={isOnline} compact />
          <ActionButton title="Scan QR" onPress={handleScanQr} variant="success" size="sm" />
          <ActionButton title="+ New" onPress={() => setShowNewForm(true)} size="sm" />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent.blue} />}
        showsVerticalScrollIndicator={false}
      >
        {sortedGroups.length === 0 && (
          <EmptyState title="No deliveries yet" message="Create a delivery to start the proof-of-delivery flow" />
        )}

        {sortedGroups.map(([status, items]) => (
          <View key={status} style={st.statusGroup}>
            <View style={st.groupHeader}>
              <StatusBadge label={status.toUpperCase()} color={statusCfg(status).color} dot size="md" />
              <Text style={st.groupCount}>{items.length}</Text>
            </View>
            {items.map(d => (
              <Card key={d.id} style={st.deliveryCard}>
                <View style={st.deliveryHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.deliveryRoute}>{getNodeName(d.source_node_id)} {'\u2192'} {getNodeName(d.target_node_id)}</Text>
                    <View style={st.deliveryMeta}>
                      <Text style={st.deliveryId}>{d.id?.slice(0, 8)}...</Text>
                      <Text style={st.deliveryVehicle}>{d.vehicle_type}</Text>
                    </View>
                  </View>
                  <PriorityBadge priority={d.priority} showLabel />
                </View>

                {/* Timeline dots */}
                <View style={st.timeline}>
                  {['pending', 'in_transit', 'delivered'].map((step, i) => {
                    const stepOrder = STATUS_CONFIG[step]?.order ?? 5;
                    const currentOrder = STATUS_CONFIG[d.status]?.order ?? 5;
                    const isDone = currentOrder >= stepOrder && d.status !== 'failed';
                    return (
                      <React.Fragment key={step}>
                        {i > 0 && <View style={[st.timelineLine, isDone && st.timelineLineDone]} />}
                        <View style={[st.timelineDot, isDone && st.timelineDotDone]}>
                          {isDone && <Text style={st.timelineCheck}>{'\u2713'}</Text>}
                        </View>
                      </React.Fragment>
                    );
                  })}
                </View>

                <View style={st.deliveryActions}>
                  {d.status === 'pending' && (
                    <ActionButton title="Start Transit" onPress={() => handleStatusChange(d.id, 'in_transit')} variant="primary" size="sm" style={{ flex: 1 }} />
                  )}
                  {d.status === 'in_transit' && (
                    <ActionButton title="Generate QR" onPress={() => handleGenerateQr(d)} variant="success" size="sm" style={{ flex: 1 }} />
                  )}
                  <ActionButton title="Chain" onPress={() => handleViewChain(d.id)} variant="secondary" size="sm" />
                  <ActionButton title="Del" onPress={() => deleteDelivery(d.id)} variant="destructive" size="sm" />
                </View>
              </Card>
            ))}
          </View>
        ))}
        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>

      {/* New Delivery Modal */}
      <Modal visible={showNewForm} transparent animationType="slide">
        <View style={st.modalOverlay}>
          <View style={st.modalSheet}>
            <View style={st.modalHandle} />
            <Text style={st.modalTitle}>New Delivery</Text>

            <Text style={st.fieldLabel}>From</Text>
            <ChipSelector
              options={nodes.map(n => ({ key: n.id, label: n.name }))}
              selected={formSource}
              onSelect={setFormSource}
              size="sm"
            />

            <Text style={st.fieldLabel}>To</Text>
            <ChipSelector
              options={nodes.filter(n => n.id !== formSource).map(n => ({ key: n.id, label: n.name }))}
              selected={formTarget}
              onSelect={setFormTarget}
              size="sm"
            />

            <Text style={st.fieldLabel}>Vehicle</Text>
            <ChipSelector
              options={[{ key: 'truck', label: 'Truck' }, { key: 'boat', label: 'Boat' }, { key: 'drone', label: 'Drone' }]}
              selected={formVehicle}
              onSelect={setFormVehicle}
            />

            <Text style={st.fieldLabel}>Priority</Text>
            <ChipSelector
              options={[
                { key: 'P0', label: 'P0', color: colors.priority.p0 },
                { key: 'P1', label: 'P1', color: colors.priority.p1 },
                { key: 'P2', label: 'P2', color: colors.priority.p2 },
                { key: 'P3', label: 'P3', color: colors.priority.p3 },
              ]}
              selected={formPriority}
              onSelect={setFormPriority}
            />

            <View style={st.modalActions}>
              <ActionButton title="Cancel" onPress={() => setShowNewForm(false)} variant="ghost" style={{ flex: 1 }} />
              <ActionButton title="Create" onPress={createDelivery} style={{ flex: 2 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* QR Display Modal */}
      <Modal visible={showQr} animationType="slide" transparent>
        <View style={st.modalOverlay}>
          <View style={st.qrModal}>
            <Text style={st.qrModalTitle}>Proof of Delivery</Text>
            <Text style={st.qrModalSub}>Show this QR to the recipient</Text>
            {qrData && (
              <>
                <View style={st.qrFrame}>
                  <QRCode value={JSON.stringify(qrData)} size={220} backgroundColor="#fff" color="#000" />
                </View>
                <View style={st.qrMeta}>
                  <InfoRow label="Nonce" value={`${qrData.pod_payload.nonce.slice(0, 12)}...`} compact />
                  <InfoRow label="Delivery" value={`${qrData.pod_payload.delivery_id.slice(0, 12)}...`} compact />
                </View>
              </>
            )}
            <ActionButton title="Close" onPress={() => { setShowQr(false); fetchDeliveries(); }} variant="secondary" fullWidth />
          </View>
        </View>
      </Modal>

      {/* Scanner Modal */}
      <Modal visible={showScanner} animationType="slide">
        <SafeAreaView style={st.scannerWrap}>
          <View style={st.scannerHeader}>
            <Text style={st.scannerTitle}>Scan PoD QR Code</Text>
            <Text style={st.scannerHint}>Point at the driver's QR code to verify delivery</Text>
          </View>
          <View style={{ flex: 1, position: 'relative' }}>
            <CameraView style={st.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : onBarcodeScanned} />
            <View style={st.viewfinder}>
              <View style={[st.corner, st.cornerTL]} />
              <View style={[st.corner, st.cornerTR]} />
              <View style={[st.corner, st.cornerBL]} />
              <View style={[st.corner, st.cornerBR]} />
            </View>
          </View>
          <ActionButton title="Cancel" onPress={() => setShowScanner(false)} variant="secondary" fullWidth size="lg" style={{ margin: spacing.lg }} />
        </SafeAreaView>
      </Modal>

      {/* Chain of Custody Modal */}
      <Modal visible={showChain} animationType="slide" transparent>
        <View style={st.modalOverlay}>
          <View style={st.chainModal}>
            <View style={st.modalHandle} />
            <Text style={st.modalTitle}>Chain of Custody</Text>
            {chainData && (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                <View style={st.chainSummary}>
                  <InfoRow label="Delivery" value={chainData.delivery?.id?.slice(0, 12) + '...'} compact />
                  <InfoRow label="Status" value={chainData.delivery?.status} valueColor={statusCfg(chainData.delivery?.status).color} compact />
                  <InfoRow label="Receipts" value={String(chainData.chain_length)} compact />
                  <InfoRow label="Verified" value={chainData.fully_verified ? 'Yes' : 'No'} valueColor={chainData.fully_verified ? colors.status.success : colors.status.warning} compact />
                </View>

                {chainData.receipts?.map((r: any, i: number) => (
                  <Card key={r.id} style={st.receiptCard} variant="accent" accentColor={r.status === 'confirmed' ? colors.status.success : colors.status.warning}>
                    <View style={st.receiptHeader}>
                      <Text style={st.receiptTitle}>Receipt #{i + 1}</Text>
                      <StatusBadge label={r.status || 'pending'} color={r.status === 'confirmed' ? colors.status.success : colors.status.warning} />
                    </View>
                    <InfoRow label="Sender" value={r.sender_device_id?.slice(0, 14) + '...'} compact />
                    <InfoRow label="Receiver" value={r.receiver_device_id?.slice(0, 14) + '...'} compact />
                    <InfoRow label="Nonce" value={r.nonce?.slice(0, 12) + '...'} compact />
                    <View style={st.sigRow}>
                      <StatusBadge label={r.sender_signature ? 'Sender Sig' : 'No Sig'} color={r.sender_signature ? colors.status.success : colors.status.error} size="sm" />
                      <StatusBadge label={r.receiver_signature ? 'Receiver Sig' : 'No Sig'} color={r.receiver_signature ? colors.status.success : colors.status.error} size="sm" />
                    </View>
                  </Card>
                ))}

                {chainData.audit_trail?.length > 0 && (
                  <View style={{ marginTop: spacing.lg }}>
                    <Text style={st.chainSection}>Audit Trail ({chainData.audit_trail.length})</Text>
                    {chainData.audit_trail.map((a: any) => (
                      <Text key={a.id} style={st.auditEntry}>{a.action} - {a.created_at}</Text>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
            <ActionButton title="Close" onPress={() => setShowChain(false)} variant="secondary" fullWidth style={{ marginTop: spacing.lg }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border.default, backgroundColor: colors.bg.primary,
  },
  headerTitle: { ...textStyles.h3, color: colors.text.primary },
  headerSub: { fontSize: fontSize.sm, color: colors.text.muted },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  content: { padding: spacing.lg },

  // Status groups
  statusGroup: { marginBottom: spacing.lg },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  groupCount: { fontSize: fontSize.sm, color: colors.text.muted },

  // Delivery cards
  deliveryCard: { marginBottom: spacing.sm, padding: spacing.md },
  deliveryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  deliveryRoute: { ...textStyles.h4, color: colors.text.primary, marginBottom: spacing.xs },
  deliveryMeta: { flexDirection: 'row', gap: spacing.md },
  deliveryId: { fontSize: fontSize.xs, color: colors.text.muted },
  deliveryVehicle: { fontSize: fontSize.xs, color: colors.text.tertiary, textTransform: 'capitalize' },

  // Timeline
  timeline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md, paddingHorizontal: spacing.xl },
  timelineDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border.default, alignItems: 'center', justifyContent: 'center' },
  timelineDotDone: { borderColor: colors.status.success, backgroundColor: colors.status.successMuted },
  timelineCheck: { color: colors.status.success, fontSize: 10, fontWeight: '700' },
  timelineLine: { flex: 1, height: 2, backgroundColor: colors.border.default },
  timelineLineDone: { backgroundColor: colors.status.success },

  deliveryActions: { flexDirection: 'row', gap: spacing.sm },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.bg.overlay, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.bg.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing['2xl'], paddingBottom: spacing['4xl'], borderWidth: 1, borderColor: colors.border.default },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border.light, alignSelf: 'center', marginBottom: spacing.xl },
  modalTitle: { ...textStyles.h3, color: colors.text.primary, marginBottom: spacing.lg },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.secondary, marginBottom: spacing.sm, marginTop: spacing.md },

  // QR Modal
  qrModal: { backgroundColor: colors.bg.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing['2xl'], paddingBottom: spacing['4xl'], alignItems: 'center', borderWidth: 1, borderColor: colors.border.default },
  qrModalTitle: { ...textStyles.h3, color: colors.text.primary },
  qrModalSub: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: spacing.xs, marginBottom: spacing.xl },
  qrFrame: { backgroundColor: '#fff', padding: spacing.lg, borderRadius: radius.lg },
  qrMeta: { width: '100%', marginTop: spacing.lg, marginBottom: spacing.lg },

  // Scanner
  scannerWrap: { flex: 1, backgroundColor: colors.bg.primary },
  scannerHeader: { alignItems: 'center', paddingVertical: spacing.lg },
  scannerTitle: { ...textStyles.h3, color: colors.text.primary },
  scannerHint: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: spacing.xs },
  camera: { flex: 1 },
  viewfinder: { position: 'absolute', top: '25%', left: '15%', width: '70%', height: '50%' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: colors.accent.blue },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },

  // Chain modal
  chainModal: { backgroundColor: colors.bg.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing['2xl'], paddingBottom: spacing['4xl'], borderWidth: 1, borderColor: colors.border.default, maxHeight: '80%' },
  chainSummary: { marginBottom: spacing.lg },
  receiptCard: { marginBottom: spacing.sm },
  receiptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  receiptTitle: { ...textStyles.h4, color: colors.text.primary },
  sigRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chainSection: { ...textStyles.label, color: colors.text.muted, marginBottom: spacing.sm },
  auditEntry: { fontSize: fontSize.sm, color: colors.text.muted, marginBottom: spacing.xs },
});
