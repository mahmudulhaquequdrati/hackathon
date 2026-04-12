import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/useAuthStore';
import { useMeshStore } from '../lib/useMeshStore';
import { transportManager } from '../lib/mesh-transport';
import { api } from '../lib/api';
import type { MeshMessage, MeshPeer } from '../types';

export default function MeshScreen({ onBack, onNavigate }: { onBack: () => void; onNavigate?: (screen: string) => void }) {
  const { deviceId } = useAuthStore();
  const {
    inbox,
    outbox,
    peers,
    nodeRole,
    batteryLevel,
    signalStrength,
    connectedPeers,
    isFlushingQueue,
    lastFlushAt,
    roleHistory,
    relayedCount,
    boxPublicKey,
    initialized,
    initialize,
    sendMessage,
    checkInbox,
    flushOutbox,
    decryptMsg,
    updateRoleHeuristics,
    fetchAndCachePeers,
  } = useMeshStore();

  const [messageText, setMessageText] = useState('');
  const [selectedPeer, setSelectedPeer] = useState<MeshPeer | null>(null);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [decryptedCache, setDecryptedCache] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [transportType, setTransportType] = useState<string>('http');
  const [backendUrl, setBackendUrl] = useState(api.getBaseUrl());

  // Poll transport status
  useEffect(() => {
    const interval = setInterval(() => {
      setTransportType(transportManager.activeType);
      setBackendUrl(api.getBaseUrl());
    }, 5000);
    setTransportType(transportManager.activeType);
    setBackendUrl(api.getBaseUrl());
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (deviceId && !initialized) {
      initialize(deviceId);
    }
  }, [deviceId, initialized]);

  // Simulate role heuristics with semi-random values (expo-battery can be added later)
  useEffect(() => {
    if (!initialized) return;
    const interval = setInterval(() => {
      const battery = 0.5 + Math.random() * 0.5; // 50-100%
      const signal = 0.3 + Math.random() * 0.7;  // 30-100%
      const peerCount = peers.length;
      updateRoleHeuristics(battery, signal, peerCount);
    }, 15_000);
    return () => clearInterval(interval);
  }, [initialized, peers.length]);

  const handleSend = async () => {
    if (!selectedPeer || !messageText.trim()) {
      Alert.alert('Error', 'Select a peer and type a message');
      return;
    }
    setSending(true);
    try {
      await sendMessage(selectedPeer.deviceId, messageText.trim(), selectedPeer.boxPublicKey);
      setMessageText('');
      Alert.alert('Sent', 'Message encrypted and queued');
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
    setSending(false);
  };

  const handleDecrypt = (msg: MeshMessage) => {
    if (decryptedCache[msg.id]) {
      setExpandedMsg(expandedMsg === msg.id ? null : msg.id);
      return;
    }
    const plaintext = decryptMsg(msg);
    if (plaintext) {
      setDecryptedCache(prev => ({ ...prev, [msg.id]: plaintext }));
      setExpandedMsg(msg.id);
    } else {
      Alert.alert('Decryption Failed', 'Cannot decrypt this message. You may not be the intended recipient.');
    }
  };

  const pendingOutbox = outbox.filter(m => m.status === 'pending');
  const deliveredInbox = inbox.filter(m => m.status === 'delivered' || m.status === 'pending');

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <TouchableOpacity onPress={onBack}>
          <Text style={s.backBtn}>Back to Dashboard</Text>
        </TouchableOpacity>

        <Text style={s.title}>Mesh Network</Text>
        <Text style={s.subtitle}>M3: Store-and-forward encrypted relay</Text>

        {/* Node Status */}
        <View style={s.card}>
          <Text style={s.cardH}>NODE STATUS</Text>
          <View style={s.roleRow}>
            <View style={[s.roleBadge, nodeRole === 'relay' ? s.relayBadge : s.clientBadge]}>
              <Text style={[s.roleBadgeText, nodeRole === 'relay' ? s.relayText : s.clientText]}>
                {nodeRole.toUpperCase()}
              </Text>
            </View>
            <Text style={s.roleSub}>
              {nodeRole === 'relay' ? 'Forwarding messages for peers' : 'Sending/receiving only'}
            </Text>
          </View>
          <Row label="Battery" value={`${(batteryLevel * 100).toFixed(0)}%`} color={batteryLevel > 0.5 ? '#22c55e' : '#f59e0b'} />
          <Row label="Signal" value={`${(signalStrength * 100).toFixed(0)}%`} color={signalStrength > 0.6 ? '#22c55e' : '#f59e0b'} />
          <Row label="Connected Peers" value={String(connectedPeers)} />
          {nodeRole === 'relay' && <Row label="Messages Relayed" value={String(relayedCount)} color="#a855f7" />}
          <Row label="Box Key" value={boxPublicKey ? `${boxPublicKey.substring(0, 16)}...` : 'Not set'} color="#60a5fa" />
        </View>

        {/* Transport Status */}
        <View style={s.card}>
          <Text style={s.cardH}>TRANSPORT</Text>
          <View style={s.roleRow}>
            <View style={[s.roleBadge, transportType === 'ble' ? s.relayBadge : s.clientBadge]}>
              <Text style={[s.roleBadgeText, transportType === 'ble' ? s.relayText : s.clientText]}>
                {transportType.toUpperCase()}
              </Text>
            </View>
            <Text style={s.roleSub}>
              {transportType === 'ble'
                ? 'Direct Bluetooth — no internet needed'
                : 'Server relay (simulator / fallback)'}
            </Text>
          </View>
          <Row label="BLE Available" value={transportManager.isBleActive ? 'Yes' : 'No'} color={transportManager.isBleActive ? '#22c55e' : '#6b7280'} />
          <Row label="HTTP Fallback" value="Available" color="#60a5fa" />
          <Row
            label="Backend"
            value={backendUrl}
            color={/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(backendUrl) ? '#22c55e' : '#f59e0b'}
          />
          <Row
            label="Network"
            value={/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(backendUrl) ? 'Local LAN' : 'Remote'}
            color={/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(backendUrl) ? '#22c55e' : '#f59e0b'}
          />
          {onNavigate && (
            <TouchableOpacity style={{ marginTop: 8, borderWidth: 1, borderColor: '#374151', borderRadius: 8, padding: 8, alignItems: 'center' }} onPress={() => onNavigate('qr-pair')}>
              <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '600' }}>QR Pair & LAN Setup</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Send Message */}
        <View style={s.card}>
          <Text style={s.cardH}>SEND ENCRYPTED MESSAGE</Text>
          <Text style={s.desc}>Select a peer and type your message. Encrypted with nacl.box — only the recipient can read it.</Text>

          {/* Peer selector */}
          <Text style={s.labelSmall}>Recipient</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.peerScroll}>
            {peers.length === 0 ? (
              <Text style={s.noPeers}>No peers found. Pull to refresh.</Text>
            ) : (
              peers.map(peer => (
                <TouchableOpacity
                  key={peer.deviceId}
                  style={[s.peerChip, selectedPeer?.deviceId === peer.deviceId && s.peerChipActive]}
                  onPress={() => setSelectedPeer(peer)}
                >
                  <Text style={[s.peerChipText, selectedPeer?.deviceId === peer.deviceId && s.peerChipTextActive]}>
                    {peer.name || peer.deviceId.substring(0, 12)}
                  </Text>
                  <Text style={s.peerRole}>{peer.role}</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          <TextInput
            style={s.input}
            placeholder="Type your message..."
            placeholderTextColor="#6b7280"
            value={messageText}
            onChangeText={setMessageText}
            multiline
          />

          <TouchableOpacity
            style={[s.sendBtn, (!selectedPeer || !messageText.trim() || sending) && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!selectedPeer || !messageText.trim() || sending}
          >
            <Text style={s.sendBtnText}>{sending ? 'Encrypting & Sending...' : 'Send Encrypted'}</Text>
          </TouchableOpacity>
        </View>

        {/* Inbox */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <Text style={s.cardH}>INBOX ({deliveredInbox.length})</Text>
            <TouchableOpacity onPress={checkInbox}>
              <Text style={s.refreshLink}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {deliveredInbox.length === 0 ? (
            <Text style={s.emptyText}>No messages yet</Text>
          ) : (
            deliveredInbox.slice(0, 20).map(msg => (
              <TouchableOpacity key={msg.id} style={s.msgCard} onPress={() => handleDecrypt(msg)}>
                <View style={s.msgHeader}>
                  <Text style={s.msgFrom}>From: {msg.sourceDeviceId.substring(0, 16)}...</Text>
                  <Text style={s.msgTime}>{new Date(msg.createdAt).toLocaleTimeString()}</Text>
                </View>
                <View style={s.msgBody}>
                  <View style={s.encBadge}>
                    <Text style={s.encBadgeText}>E2E</Text>
                  </View>
                  <Text style={s.msgPreview}>
                    {expandedMsg === msg.id && decryptedCache[msg.id]
                      ? decryptedCache[msg.id]
                      : 'Tap to decrypt'}
                  </Text>
                </View>
                <Row label="Hops" value={String(msg.hopCount)} />
                <Row label="TTL" value={String(msg.ttl)} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Outbox / Queue */}
        <View style={s.card}>
          <View style={s.cardHeaderRow}>
            <Text style={s.cardH}>OUTBOX ({outbox.length})</Text>
            <TouchableOpacity onPress={flushOutbox}>
              <Text style={s.refreshLink}>{isFlushingQueue ? 'Flushing...' : 'Flush'}</Text>
            </TouchableOpacity>
          </View>
          {pendingOutbox.length > 0 && (
            <View style={s.queueBanner}>
              <Text style={s.queueText}>{pendingOutbox.length} message(s) queued for delivery</Text>
            </View>
          )}
          {outbox.length === 0 ? (
            <Text style={s.emptyText}>No sent messages</Text>
          ) : (
            outbox.slice(0, 10).map(msg => (
              <View key={msg.id} style={s.msgCard}>
                <View style={s.msgHeader}>
                  <Text style={s.msgFrom}>To: {msg.targetDeviceId.substring(0, 16)}...</Text>
                  <View style={[s.statusBadge, statusColor(msg.status)]}>
                    <Text style={s.statusText}>{msg.status}</Text>
                  </View>
                </View>
                <Row label="TTL" value={String(msg.ttl)} />
                <Row label="Hops" value={String(msg.hopCount)} />
              </View>
            ))
          )}
          {lastFlushAt && <Text style={s.lastFlush}>Last flush: {new Date(lastFlushAt).toLocaleTimeString()}</Text>}
        </View>

        {/* Role History */}
        {roleHistory.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardH}>ROLE HISTORY</Text>
            {roleHistory.slice(0, 5).map((sw, i) => (
              <View key={i} style={s.historyRow}>
                <View style={s.historyHeader}>
                  <Text style={s.historySwitch}>{sw.from} {'->'} {sw.to}</Text>
                  <Text style={s.historyTime}>{new Date(sw.timestamp).toLocaleTimeString()}</Text>
                </View>
                <Text style={s.historyReason}>{sw.reason}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Refresh Peers */}
        <TouchableOpacity style={s.refreshBtn} onPress={fetchAndCachePeers}>
          <Text style={s.refreshBtnText}>Refresh Peers</Text>
        </TouchableOpacity>
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

function statusColor(status: string): { backgroundColor: string; borderColor: string } {
  switch (status) {
    case 'delivered': return { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: '#166534' };
    case 'relayed': return { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#2563eb' };
    case 'expired': return { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: '#991b1b' };
    default: return { backgroundColor: 'rgba(249,115,22,0.15)', borderColor: '#ea580c' };
  }
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  backBtn: { color: '#60a5fa', fontSize: 14, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 13, color: '#9ca3af', marginTop: 2, marginBottom: 20 },

  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 14, padding: 16, marginBottom: 16 },
  cardH: { fontSize: 11, fontWeight: 'bold', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  desc: { fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 18 },

  // Node status
  roleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  roleBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginRight: 10 },
  relayBadge: { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: '#166534' },
  clientBadge: { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#2563eb' },
  roleBadgeText: { fontSize: 12, fontWeight: 'bold' },
  relayText: { color: '#22c55e' },
  clientText: { color: '#60a5fa' },
  roleSub: { fontSize: 12, color: '#6b7280', flex: 1 },

  // Peer selector
  labelSmall: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  peerScroll: { marginBottom: 10 },
  peerChip: { borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, minWidth: 100 },
  peerChipActive: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.15)' },
  peerChipText: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  peerChipTextActive: { color: '#c4b5fd' },
  peerRole: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  noPeers: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },

  // Input & send
  input: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 10, minHeight: 60, textAlignVertical: 'top' },
  sendBtn: { backgroundColor: '#7c3aed', borderRadius: 10, padding: 12, alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#e9d5ff', fontSize: 14, fontWeight: '600' },

  // Messages
  msgCard: { backgroundColor: '#1f2937', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#374151' },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  msgFrom: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  msgTime: { color: '#6b7280', fontSize: 11 },
  msgBody: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  encBadge: { backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: '#166534', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginRight: 8 },
  encBadgeText: { color: '#22c55e', fontSize: 10, fontWeight: 'bold' },
  msgPreview: { color: '#9ca3af', fontSize: 13, flex: 1 },

  // Status badges
  statusBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  // Queue
  queueBanner: { backgroundColor: 'rgba(249,115,22,0.1)', borderRadius: 8, padding: 8, marginBottom: 8 },
  queueText: { color: '#fb923c', fontSize: 12, textAlign: 'center' },

  // Shared
  stateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  stateLabel: { fontSize: 13, color: '#6b7280' },
  stateValue: { fontSize: 13, color: '#d1d5db', flex: 1, textAlign: 'right' },

  refreshLink: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },
  emptyText: { color: '#6b7280', fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  lastFlush: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 8 },

  // Role history
  historyRow: { borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 8, marginTop: 8 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  historySwitch: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  historyTime: { color: '#6b7280', fontSize: 11 },
  historyReason: { color: '#9ca3af', fontSize: 12, marginTop: 2 },

  // Bottom buttons
  refreshBtn: { backgroundColor: '#1e3a5f', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 16 },
  refreshBtnText: { color: '#93c5fd', fontSize: 14, fontWeight: '600' },
});
