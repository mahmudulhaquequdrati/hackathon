import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Modal,
    RefreshControl,
    ScrollView, StyleSheet,
    Text, TouchableOpacity,
    View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { api } from '../lib/api';
import { importKeyBase64 } from '../lib/crypto';
import { getDatabase } from '../lib/database';
import {
    countersignPod,
    generatePodPayload,
    markNonceUsed, storePodReceipt,
    verifyPodPayload,
    type PodChallenge
} from '../lib/pod';
import { useAuthStore } from '../lib/useAuthStore';

interface Delivery {
  id: string; supply_id: string; source_node_id: string; target_node_id: string;
  vehicle_type: string; status: string; priority: string; driver_id: string;
  route_data: string; created_at: string; _local?: boolean;
}

export default function DeliveryScreen({ onBack }: { onBack: () => void }) {
  const { user, token, deviceId } = useAuthStore();
  const isOnline = useOnlineStatus();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // New delivery form
  const [showNewForm, setShowNewForm] = useState(false);
  const [nodes, setNodes] = useState<{ id: string; name: string; type: string }[]>([]);
  const [formSource, setFormSource] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [formVehicle, setFormVehicle] = useState<'truck' | 'boat' | 'drone'>('truck');
  const [formPriority, setFormPriority] = useState<'P0' | 'P1' | 'P2' | 'P3'>('P2');

  // QR state
  const [qrData, setQrData] = useState<PodChallenge | null>(null);
  const [showQr, setShowQr] = useState(false);

  // Scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  // Chain view
  const [chainData, setChainData] = useState<any>(null);
  const [showChain, setShowChain] = useState(false);

  const fetchDeliveries = useCallback(async () => {
    // Always load local deliveries
    const db = await getDatabase();
    const localRows = await db.getAllAsync<Delivery>(
      'SELECT *, 1 as _local FROM local_deliveries ORDER BY created_at DESC'
    );

    // Try server deliveries if online
    let serverRows: Delivery[] = [];
    try {
      const json = await api.get<{ data: { deliveries: Delivery[] } }>('/delivery/');
      serverRows = json.data.deliveries || [];
    } catch {
      // Offline — just use local
    }

    // Merge: server overrides local for same ID, then add local-only ones
    const serverIds = new Set(serverRows.map(d => d.id));
    const localOnly = localRows.filter(d => !serverIds.has(d.id));
    setDeliveries([...serverRows, ...localOnly]);
  }, []);

  useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);

  // Auto-refresh deliveries every 5s so other devices' changes appear
//   useEffect(() => {
//     const interval = setInterval(fetchDeliveries, 5000);
//     return () => clearInterval(interval);
//   }, [fetchDeliveries]);

  // Fetch graph nodes — cache to local DB, load from cache when offline
  useEffect(() => {
    (async () => {
      const db = await getDatabase();

      try {
        const json = await api.get<{ data: { nodes: { id: string; name: string; type: string; lat?: number; lng?: number; status?: string }[] } }>('/routes/graph');
        const serverNodes = json.data.nodes || [];
        if (serverNodes.length > 0) {
          // Cache to local DB
          await db.execAsync('DELETE FROM cached_nodes');
          for (const n of serverNodes) {
            await db.runAsync(
              'INSERT OR REPLACE INTO cached_nodes (id, name, type, lat, lng, status) VALUES (?, ?, ?, ?, ?, ?)',
              [n.id, n.name, n.type, n.lat ?? null, n.lng ?? null, n.status ?? 'active']
            );
          }
          setNodes(serverNodes);
          if (serverNodes.length >= 2) { setFormSource(serverNodes[0].id); setFormTarget(serverNodes[1].id); }
          return;
        }
      } catch {
        // Offline — fall through to local cache
      }

      // Load from local cache
      const cached = await db.getAllAsync<{ id: string; name: string; type: string }>('SELECT id, name, type FROM cached_nodes');
      if (cached.length > 0) {
        setNodes(cached);
        setFormSource(cached[0].id);
        setFormTarget(cached[1]?.id || cached[0].id);
        return;
      }

      // No cache either — use static fallback nodes for offline use
      const fallback = [
        { id: 'base-camp', name: 'Base Camp', type: 'hub' },
        { id: 'field-hospital', name: 'Field Hospital', type: 'camp' },
        { id: 'supply-depot', name: 'Supply Depot', type: 'hub' },
        { id: 'shelter-a', name: 'Shelter A', type: 'camp' },
        { id: 'shelter-b', name: 'Shelter B', type: 'camp' },
        { id: 'drone-base', name: 'Drone Base', type: 'drone_base' },
      ];
      setNodes(fallback);
      setFormSource(fallback[0].id);
      setFormTarget(fallback[1].id);
    })();
  }, []);

  // WebSocket listener — silently refresh delivery list in background
  const wsRef = useRef<WebSocket | null>(null);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/api\/v1$/, '');
    if (!wsUrl) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (['POD_CONFIRMED', 'DELIVERY_CREATED', 'DELIVERY_STATUS_CHANGED'].includes(msg.type)) {
            // Debounce: skip if we refreshed within the last 2 seconds
            const now = Date.now();
            if (now - lastRefreshRef.current > 2000) {
              lastRefreshRef.current = now;
              fetchDeliveries();
            }
          }
        } catch {}
      };
    } catch {}

    return () => { wsRef.current?.close(); };
  }, [fetchDeliveries]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDeliveries();
    setRefreshing(false);
  };

  // ── Create Delivery (works offline) ──────────────────────
  const createDelivery = async () => {
    if (!formSource || !formTarget) {
      Alert.alert('Error', 'Select source and target');
      return;
    }
    if (formSource === formTarget) {
      Alert.alert('Error', 'Source and target must be different');
      return;
    }

    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Always save locally first (offline-first)
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO local_deliveries (id, source_node_id, target_node_id, vehicle_type, priority, status, driver_id)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, formSource, formTarget, formVehicle, formPriority, deviceId || null]
    );

    // Always try to sync to server (don't wait for isOnline flag)
    try {
      const json = await api.post<{ data: Delivery }>('/delivery/', {
        source_node_id: formSource,
        target_node_id: formTarget,
        vehicle_type: formVehicle,
        priority: formPriority,
      });
      // Update local with server ID
      await db.runAsync('UPDATE local_deliveries SET id = ?, synced = 1 WHERE id = ?', [json.data.id, id]);
    } catch {
      // Server unreachable — local copy is fine, will sync later
    }

    Alert.alert('Created', `Delivery ${id.slice(0, 12)}...`);
    setShowNewForm(false);
    fetchDeliveries();
  };

  // ── Delete single delivery ──────────────────────────────
  const deleteDelivery = async (id: string) => {
    Alert.alert('Delete', `Delete delivery ${id.slice(0, 8)}...?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const db = await getDatabase();
          await db.runAsync('DELETE FROM local_deliveries WHERE id = ?', [id]);
          await db.runAsync('DELETE FROM pod_receipts WHERE delivery_id = ?', [id]);
          fetchDeliveries();
        },
      },
    ]);
  };

  // ── Clear all deliveries ────────────────────────────────
  const clearAllDeliveries = async () => {
    Alert.alert('Clear All', 'Delete all local deliveries and receipts?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All', style: 'destructive', onPress: async () => {
          const db = await getDatabase();
          await db.execAsync('DELETE FROM local_deliveries');
          await db.execAsync('DELETE FROM pod_receipts');
          await db.execAsync('DELETE FROM used_nonces');
          setDeliveries([]);
        },
      },
    ]);
  };

  // ── Generate QR (Driver side — M5.1) ─────────────────────
  const handleGenerateQr = async (delivery: Delivery) => {
    try {
      const store = useAuthStore.getState();
      const secretKeyB64 = store.secretKey;
      const publicKeyB64 = store.publicKey;

      if (!secretKeyB64 || !publicKeyB64) {
        Alert.alert('Error', 'No signing keys found — re-register device');
        return;
      }

      const secretKey = importKeyBase64(secretKeyB64);
      const publicKey = importKeyBase64(publicKeyB64);

      const challenge = generatePodPayload(
        delivery.id,
        deviceId!,
        publicKey,
        secretKey,
        `${delivery.supply_id || delivery.id}_${delivery.priority}`,
      );

      setQrData(challenge);
      setShowQr(true);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // ── Scan QR (Recipient side — M5.1 + M5.2) ──────────────
  const handleScanQr = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permission Denied', 'Camera access is needed to scan QR codes');
        return;
      }
    }
    setScanned(false);
    setShowScanner(true);
  };

  const scanProcessingRef = useRef(false);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    // Guard against multiple firings
    if (scanned || scanProcessingRef.current) return;
    scanProcessingRef.current = true;
    setScanned(true);
    setShowScanner(false);

    try {
      const challenge: PodChallenge = JSON.parse(data);

      // M5.1 + M5.2: Verify signature, check nonce, check expiry
      const result = await verifyPodPayload(challenge);

      if (!result.valid) {
        Alert.alert('Rejected', `${result.code}: ${result.message}`);
        return;
      }

      // M5.1: Countersign
      const store = useAuthStore.getState();
      if (!store.secretKey) {
        Alert.alert('Error', 'No signing key');
        return;
      }
      const receiverSig = countersignPod(challenge.canonical_string, importKeyBase64(store.secretKey));

      // M5.2: Mark nonce as used locally
      await markNonceUsed(challenge.pod_payload.nonce, challenge.pod_payload.delivery_id);

      // Store receipt locally (M5.3)
      const receiptId = `pod-${Date.now()}`;
      await storePodReceipt({
        id: receiptId,
        delivery_id: challenge.pod_payload.delivery_id,
        sender_device_id: challenge.pod_payload.sender_device_id,
        receiver_device_id: deviceId!,
        sender_signature: challenge.signature,
        receiver_signature: receiverSig,
        payload_hash: challenge.pod_payload.payload_hash,
        nonce: challenge.pod_payload.nonce,
        status: 'confirmed',
      });

      // Always try to sync to server
      try {
        await api.post(`/delivery/${challenge.pod_payload.delivery_id}/pod`, {
          action: 'confirm',
          pod_payload: challenge.pod_payload,
          sender_signature: challenge.signature,
          receiver_device_id: deviceId,
          receiver_signature: receiverSig,
        });
      } catch {
        // Server unreachable — local receipt is saved, will sync later
      }

      Alert.alert('Confirmed', `Delivery ${challenge.pod_payload.delivery_id.slice(0, 8)}... verified and countersigned`);
      fetchDeliveries();
    } catch (err: any) {
      Alert.alert('Error', `Invalid QR: ${err.message}`);
    } finally {
      scanProcessingRef.current = false;
    }
  };

  // ── View Chain of Custody (M5.3) ─────────────────────────
  const handleViewChain = async (deliveryId: string) => {
    try {
      const json = await api.get<{ data: any }>(`/delivery/${deliveryId}/chain`);
      setChainData(json.data);
      setShowChain(true);
    } catch {
      // Offline fallback — build chain from local pod_receipts
      try {
        const db = await getDatabase();
        const localReceipts = await db.getAllAsync<any>(
          'SELECT * FROM pod_receipts WHERE delivery_id = ? ORDER BY created_at ASC',
          [deliveryId],
        );
        const delivery = deliveries.find(d => d.id === deliveryId);
        setChainData({
          delivery: { id: deliveryId, status: delivery?.status || 'unknown' },
          chain_length: localReceipts.length,
          fully_verified: localReceipts.every((r: any) => r.status === 'confirmed'),
          receipts: localReceipts,
          audit_trail: [],
          _offline: true,
        });
        setShowChain(true);
      } catch (localErr: any) {
        Alert.alert('Error', `No chain data available offline: ${localErr.message}`);
      }
    }
  };

  // ── Update Status (works offline) ────────────────────────
  const handleStatusChange = async (id: string, newStatus: string) => {
    // Update locally first
    const db = await getDatabase();
    await db.runAsync('UPDATE local_deliveries SET status = ? WHERE id = ?', [newStatus, id]);

    // Always try server (don't wait for isOnline flag)
    try {
      await api.patch(`/delivery/${id}/status`, { status: newStatus });
    } catch {
      // Server unreachable — local is updated
    }
    fetchDeliveries();
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'pending': return '#f59e0b';
      case 'in_transit': return '#3b82f6';
      case 'delivered': return '#22c55e';
      case 'failed': return '#ef4444';
      default: return '#9ca3af';
    }
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Deliveries</Text>
        <View style={[s.statusDot, { backgroundColor: isOnline ? '#22c55e' : '#ef4444' }]} />
      </View>

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity style={s.actionBtn} onPress={() => setShowNewForm(true)}>
          <Text style={s.actionText}>+ New Delivery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#065f46' }]} onPress={handleScanQr}>
          <Text style={s.actionText}>Scan QR</Text>
        </TouchableOpacity>
        {deliveries.length > 0 && (
          <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#7f1d1d' }]} onPress={clearAllDeliveries}>
            <Text style={s.actionText}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* New Delivery Form */}
      {showNewForm && (
        <View style={s.formCard}>
          <Text style={s.formTitle}>New Delivery</Text>

          <Text style={s.formLabel}>From</Text>
          <View style={s.pickerRow}>
            {nodes.map(n => (
              <TouchableOpacity key={n.id} style={[s.pickerBtn, formSource === n.id && s.pickerBtnActive]}
                onPress={() => setFormSource(n.id)}>
                <Text style={[s.pickerText, formSource === n.id && s.pickerTextActive]}>{n.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.formLabel}>To</Text>
          <View style={s.pickerRow}>
            {nodes.filter(n => n.id !== formSource).map(n => (
              <TouchableOpacity key={n.id} style={[s.pickerBtn, formTarget === n.id && s.pickerBtnActive]}
                onPress={() => setFormTarget(n.id)}>
                <Text style={[s.pickerText, formTarget === n.id && s.pickerTextActive]}>{n.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.formLabel}>Vehicle</Text>
          <View style={s.pickerRow}>
            {(['truck', 'boat', 'drone'] as const).map(v => (
              <TouchableOpacity key={v} style={[s.pickerBtn, formVehicle === v && s.pickerBtnActive]}
                onPress={() => setFormVehicle(v)}>
                <Text style={[s.pickerText, formVehicle === v && s.pickerTextActive]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.formLabel}>Priority</Text>
          <View style={s.pickerRow}>
            {(['P0', 'P1', 'P2', 'P3'] as const).map(p => (
              <TouchableOpacity key={p} style={[s.pickerBtn, formPriority === p && s.pickerBtnActive]}
                onPress={() => setFormPriority(p)}>
                <Text style={[s.pickerText, formPriority === p && s.pickerTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.formActions}>
            <TouchableOpacity style={[s.actionBtn, { flex: 1 }]} onPress={createDelivery}>
              <Text style={s.actionText}>Create</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: '#374151' }]} onPress={() => setShowNewForm(false)}>
              <Text style={s.actionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Delivery List */}
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}>
        {deliveries.length === 0 && (
          <Text style={s.emptyText}>No deliveries yet. Tap "+ New Delivery" to create one.</Text>
        )}
        {deliveries.filter(d => d && d.id).map(d => (
          <View key={d.id} style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardId}>{d.id?.slice(0, 8)}...</Text>
              <View style={[s.badge, { backgroundColor: statusColor(d.status || 'pending') }]}>
                <Text style={s.badgeText}>{(d.status || 'pending').toUpperCase()}</Text>
              </View>
            </View>
            <Text style={s.cardDetail}>{d.source_node_id} → {d.target_node_id}</Text>
            <Text style={s.cardDetail}>{d.vehicle_type} | {d.priority}</Text>

            <View style={s.cardActions}>
              {d.status === 'pending' && (
                <TouchableOpacity style={s.smallBtn} onPress={() => handleStatusChange(d.id, 'in_transit')}>
                  <Text style={s.smallBtnText}>Start Transit</Text>
                </TouchableOpacity>
              )}
              {d.status === 'in_transit' && (
                <TouchableOpacity style={[s.smallBtn, { backgroundColor: '#065f46' }]} onPress={() => handleGenerateQr(d)}>
                  <Text style={s.smallBtnText}>Generate QR</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: '#1e3a5f' }]} onPress={() => handleViewChain(d.id)}>
                <Text style={s.smallBtnText}>Chain</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: '#7f1d1d' }]} onPress={() => deleteDelivery(d.id)}>
                <Text style={s.smallBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* QR Display Modal */}
      <Modal visible={showQr} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Proof of Delivery QR</Text>
            <Text style={s.modalSub}>Show this to the recipient to scan</Text>
            {qrData && (
              <View style={s.qrContainer}>
                <QRCode value={JSON.stringify(qrData)} size={250} backgroundColor="#fff" color="#000" />
              </View>
            )}
            {qrData && (
              <Text style={s.nonceText}>Nonce: {qrData.pod_payload.nonce.slice(0, 8)}...</Text>
            )}
            <TouchableOpacity style={s.closeBtn} onPress={() => { setShowQr(false); fetchDeliveries(); }}>
              <Text style={s.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Camera Scanner Modal */}
      <Modal visible={showScanner} animationType="slide">
        <SafeAreaView style={s.scannerContainer}>
          <Text style={s.scannerTitle}>Scan PoD QR Code</Text>
          <CameraView
            style={s.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
          />
          <TouchableOpacity style={s.closeBtn} onPress={() => setShowScanner(false)}>
            <Text style={s.closeBtnText}>Cancel</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* Chain of Custody Modal */}
      <Modal visible={showChain} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Chain of Custody</Text>
            {chainData && (
              <ScrollView style={{ maxHeight: 400 }}>
                <Text style={s.chainLabel}>Delivery: {chainData.delivery?.id?.slice(0, 8)}...</Text>
                <Text style={s.chainLabel}>Status: {chainData.delivery?.status}</Text>
                <Text style={s.chainLabel}>Receipts: {chainData.chain_length}</Text>
                <Text style={s.chainLabel}>Fully Verified: {chainData.fully_verified ? 'Yes' : 'No'}</Text>

                {chainData.receipts?.map((r: any, i: number) => (
                  <View key={r.id} style={s.receiptCard}>
                    <Text style={s.receiptTitle}>Receipt #{i + 1}</Text>
                    <Text style={s.receiptDetail}>Sender: {r.sender_device_id}</Text>
                    <Text style={s.receiptDetail}>Receiver: {r.receiver_device_id}</Text>
                    <Text style={s.receiptDetail}>Nonce: {r.nonce?.slice(0, 8)}...</Text>
                    <Text style={s.receiptDetail}>Sender Sig: {r.sender_signature ? 'Yes' : 'No'}</Text>
                    <Text style={s.receiptDetail}>Receiver Sig: {r.receiver_signature ? 'Yes' : 'No'}</Text>
                    <Text style={[s.receiptDetail, { color: r.status === 'confirmed' ? '#22c55e' : '#f59e0b' }]}>
                      {r.status?.toUpperCase()}
                    </Text>
                  </View>
                ))}

                {chainData.audit_trail?.length > 0 && (
                  <>
                    <Text style={[s.chainLabel, { marginTop: 12 }]}>Audit Trail ({chainData.audit_trail.length} entries)</Text>
                    {chainData.audit_trail.map((a: any) => (
                      <Text key={a.id} style={s.receiptDetail}>{a.action} — {a.created_at}</Text>
                    ))}
                  </>
                )}
              </ScrollView>
            )}
            <TouchableOpacity style={s.closeBtn} onPress={() => setShowChain(false)}>
              <Text style={s.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#111827' },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  backText: { color: '#3b82f6', fontSize: 16 },
  title: { flex: 1, color: '#f9fafb', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },

  actions: { flexDirection: 'row', gap: 8, padding: 12 },
  actionBtn: { flex: 1, backgroundColor: '#4c1d95', borderRadius: 12, padding: 12, alignItems: 'center' },
  actionText: { color: '#e0d4ff', fontSize: 14, fontWeight: '600' },

  formCard: { backgroundColor: '#111827', borderRadius: 12, padding: 14, marginHorizontal: 12, marginTop: 8 },
  formTitle: { color: '#f9fafb', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  formLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickerBtn: { backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  pickerBtnActive: { backgroundColor: '#3b82f6' },
  pickerText: { color: '#9ca3af', fontSize: 12 },
  pickerTextActive: { color: '#fff' },
  formActions: { flexDirection: 'row', gap: 8, marginTop: 12 },

  emptyText: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontSize: 14 },

  card: { backgroundColor: '#111827', borderRadius: 12, padding: 14, marginHorizontal: 12, marginTop: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardId: { color: '#f9fafb', fontSize: 16, fontWeight: '700' },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardDetail: { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallBtn: { backgroundColor: '#4c1d95', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  smallBtnText: { color: '#e0d4ff', fontSize: 12, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#1f2937', borderRadius: 16, padding: 24, width: '90%', alignItems: 'center' },
  modalTitle: { color: '#f9fafb', fontSize: 20, fontWeight: '700' },
  modalSub: { color: '#9ca3af', fontSize: 13, marginTop: 4, marginBottom: 16 },
  qrContainer: { backgroundColor: '#fff', padding: 16, borderRadius: 12 },
  nonceText: { color: '#6b7280', fontSize: 12, marginTop: 12 },
  closeBtn: { backgroundColor: '#374151', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10, marginTop: 16 },
  closeBtnText: { color: '#f9fafb', fontSize: 14, fontWeight: '600' },

  scannerContainer: { flex: 1, backgroundColor: '#030712' },
  scannerTitle: { color: '#f9fafb', fontSize: 18, fontWeight: '700', textAlign: 'center', padding: 16 },
  camera: { flex: 1, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },

  chainLabel: { color: '#93c5fd', fontSize: 14, fontWeight: '600', marginTop: 4 },
  receiptCard: { backgroundColor: '#0f172a', borderRadius: 8, padding: 10, marginTop: 8 },
  receiptTitle: { color: '#f9fafb', fontSize: 14, fontWeight: '700' },
  receiptDetail: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
});
