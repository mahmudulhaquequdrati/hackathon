import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Clipboard,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/useAuthStore';
import { useSupplyStore } from '../lib/useSupplyStore';
import { buildSyncPayload, applySyncPayload, type P2PSyncPayload } from '../lib/p2p-sync';
import { api } from '../lib/api';
import { log } from '../lib/debug';
import type { VectorClock } from '../lib/crdt';

interface SyncStats {
  bytesIn: number;
  bytesOut: number;
  totalBytes: number;
  deltaSync: boolean;
  recordsSent: number;
  recordsReceived: number;
}

export default function P2PSyncScreen({ onBack }: { onBack: () => void }) {
  const { deviceId } = useAuthStore();
  const { loadSupplies } = useSupplyStore();

  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [peerDeviceId, setPeerDeviceId] = useState('');

  const handleP2PSync = async () => {
    if (!deviceId) return;
    setStatus('syncing');
    setErrorMsg('');
    setStats(null);

    try {
      // Use the /p2p/exchange endpoint which handles both directions
      // Step 1: Get peer's clock to build delta
      const stateRes = await api.get<{ vectorClock: VectorClock }>('/p2p/state');
      const peerClock = stateRes.vectorClock || {};

      // Step 2: Build our delta payload
      const outgoing = await buildSyncPayload(deviceId, peerClock);
      log('info', `P2P: sending ${outgoing.changes.length} records`);

      // Step 3: Exchange via P2P endpoint
      const response = await api.post<{
        deviceId: string;
        vectorClock: VectorClock;
        changes: Array<{ id: string; crdtState: string }>;
        stats: SyncStats;
      }>('/p2p/exchange', outgoing);

      // Step 4: Apply incoming changes
      const incomingPayload: P2PSyncPayload = {
        deviceId: response.deviceId,
        vectorClock: response.vectorClock,
        changes: response.changes,
      };
      await applySyncPayload(incomingPayload);

      // Step 5: Reload supplies
      await loadSupplies();

      setStats(response.stats);
      setStatus('done');
      log('info', `P2P sync done: ${response.stats.totalBytes} bytes total`);
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
      log('error', 'P2P sync failed', (err as Error).message);
    }
  };

  // P2P via mailbox (device-to-device through relay)
  const handleMailboxSync = async () => {
    if (!deviceId || !peerDeviceId.trim()) return;
    setStatus('syncing');
    setErrorMsg('');

    try {
      // Build delta payload
      const outgoing = await buildSyncPayload(deviceId, {});

      // Post to mailbox for peer
      await api.post('/p2p/offer', {
        fromDeviceId: deviceId,
        toDeviceId: peerDeviceId.trim(),
        payload: outgoing,
      });

      // Try to pick up peer's mailbox for us
      const pickup = await api.get<{
        data: { available: boolean; payload?: P2PSyncPayload; bytes?: number };
      }>(`/p2p/pickup?fromDeviceId=${peerDeviceId.trim()}&toDeviceId=${deviceId}`);

      if (pickup.data.available && pickup.data.payload) {
        await applySyncPayload(pickup.data.payload);
        await loadSupplies();
        setStats({
          bytesIn: pickup.data.bytes || 0,
          bytesOut: JSON.stringify(outgoing).length,
          totalBytes: (pickup.data.bytes || 0) + JSON.stringify(outgoing).length,
          deltaSync: false,
          recordsSent: outgoing.changes.length,
          recordsReceived: pickup.data.payload.changes?.length || 0,
        });
      } else {
        setStats({
          bytesIn: 0,
          bytesOut: JSON.stringify(outgoing).length,
          totalBytes: JSON.stringify(outgoing).length,
          deltaSync: false,
          recordsSent: outgoing.changes.length,
          recordsReceived: 0,
        });
      }

      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <TouchableOpacity onPress={onBack}>
          <Text style={s.backBtn}>Back to Dashboard</Text>
        </TouchableOpacity>

        <Text style={s.title}>P2P Device Sync</Text>
        <Text style={s.subtitle}>M2.4: Direct device-to-device CRDT sync</Text>

        {/* Direct Exchange */}
        <View style={s.card}>
          <Text style={s.cardH}>DIRECT EXCHANGE</Text>
          <Text style={s.desc}>
            Exchange CRDT states with all connected devices via the relay.
            Uses delta-sync: only sends records the peer hasn't seen.
          </Text>
          <TouchableOpacity
            style={[s.syncBtn, status === 'syncing' && s.syncBtnDisabled]}
            onPress={handleP2PSync}
            disabled={status === 'syncing'}
          >
            <Text style={s.syncBtnText}>
              {status === 'syncing' ? 'Syncing...' : 'Exchange Now'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Mailbox (targeted device) */}
        <View style={s.card}>
          <Text style={s.cardH}>DEVICE-TO-DEVICE MAILBOX</Text>
          <Text style={s.desc}>
            Send your changes to a specific device. They pick up when online.
          </Text>
          <TextInput
            style={s.input}
            placeholder="Peer Device ID (first 12 chars)"
            placeholderTextColor="#6b7280"
            value={peerDeviceId}
            onChangeText={setPeerDeviceId}
          />
          <TouchableOpacity
            style={[s.syncBtn, (!peerDeviceId.trim() || status === 'syncing') && s.syncBtnDisabled]}
            onPress={handleMailboxSync}
            disabled={!peerDeviceId.trim() || status === 'syncing'}
          >
            <Text style={s.syncBtnText}>Send & Receive</Text>
          </TouchableOpacity>
        </View>

        {/* Your device info */}
        <View style={s.card}>
          <Text style={s.cardH}>YOUR DEVICE</Text>
          <TouchableOpacity onPress={() => {
            if (deviceId) {
              Clipboard.setString(deviceId);
              Alert.alert('Copied', 'Device ID copied to clipboard. Share with peer for mailbox sync.');
            }
          }}>
            <View style={s.stateRow}>
              <Text style={s.stateLabel}>Device ID</Text>
              <Text style={[s.stateValue, { color: '#60a5fa', textDecorationLine: 'underline' }]} numberOfLines={2} selectable>{deviceId || 'none'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={s.copyHint}>Tap to copy. Share with the other device for mailbox sync.</Text>
        </View>

        {/* Stats */}
        {stats && (
          <View style={s.card}>
            <Text style={s.cardH}>SYNC RESULT</Text>
            <Row label="Status" value={status === 'done' ? 'Success' : 'Error'} color={status === 'done' ? '#22c55e' : '#ef4444'} />
            <Row label="Records sent" value={String(stats.recordsSent)} />
            <Row label="Records received" value={String(stats.recordsReceived)} />
            <Row label="Bytes out" value={`${stats.bytesOut} B`} />
            <Row label="Bytes in" value={`${stats.bytesIn} B`} />
            <Row
              label="Total transfer"
              value={stats.totalBytes < 10240 ? `${stats.totalBytes} B (under 10KB)` : `${(stats.totalBytes / 1024).toFixed(1)} KB`}
              color={stats.totalBytes < 10240 ? '#22c55e' : '#f59e0b'}
            />
            <Row label="Delta sync" value={stats.deltaSync ? 'Yes' : 'Full sync'} />
          </View>
        )}

        {status === 'error' && (
          <View style={s.errorCard}>
            <Text style={s.errorText}>{errorMsg}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.stateRow}>
      <Text style={s.stateLabel}>{label}</Text>
      <Text style={[s.stateValue, color ? { color } : undefined]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 20, paddingTop: 16 },
  backBtn: { color: '#60a5fa', fontSize: 14, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 13, color: '#9ca3af', marginTop: 2, marginBottom: 20 },
  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 14, padding: 16, marginBottom: 16 },
  cardH: { fontSize: 11, fontWeight: 'bold', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  desc: { fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 18 },
  input: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 10 },
  syncBtn: { backgroundColor: '#7c3aed', borderRadius: 10, padding: 12, alignItems: 'center' },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#e9d5ff', fontSize: 14, fontWeight: '600' },
  stateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  stateLabel: { fontSize: 13, color: '#6b7280' },
  stateValue: { fontSize: 13, color: '#d1d5db', flex: 1, textAlign: 'right' },
  copyHint: { fontSize: 11, color: '#6b7280', marginTop: 6, fontStyle: 'italic' },
  errorCard: { backgroundColor: '#7f1d1d', borderRadius: 10, padding: 12, marginTop: 8 },
  errorText: { color: '#fca5a5', fontSize: 13 },
});
