import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/useAuthStore';
import { useMeshStore } from '../lib/useMeshStore';
import { useSupplyStore } from '../lib/useSupplyStore';
import { transportManager } from '../lib/mesh-transport';
import { api } from '../lib/api';
import { buildSyncPayload, applySyncPayload, type P2PSyncPayload } from '../lib/p2p-sync';
import { log } from '../lib/debug';
import { Card } from '../components/Card';
import { ActionButton } from '../components/ActionButton';
import { StatusBadge } from '../components/StatusBadge';
import { InfoRow } from '../components/InfoRow';
import { EmptyState } from '../components/EmptyState';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';
import type { MeshMessage, MeshPeer } from '../types';
import type { VectorClock } from '../lib/crdt';

type Tab = 'sync' | 'mesh';

interface SyncStats {
  bytesIn: number;
  bytesOut: number;
  totalBytes: number;
  deltaSync: boolean;
  recordsSent: number;
  recordsReceived: number;
}

export default function MeshScreen({ onBack, onNavigate }: { onBack: () => void; onNavigate?: (screen: string) => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('mesh');
  const { deviceId } = useAuthStore();
  const { loadSupplies } = useSupplyStore();
  const {
    inbox, outbox, peers, nodeRole, batteryLevel, signalStrength,
    connectedPeers, isFlushingQueue, lastFlushAt, roleHistory,
    relayedCount, boxPublicKey, initialized,
    initialize, sendMessage, checkInbox, flushOutbox, decryptMsg,
    updateRoleHeuristics, fetchAndCachePeers,
  } = useMeshStore();

  // Sync state
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [syncError, setSyncError] = useState('');
  const [peerDeviceId, setPeerDeviceId] = useState('');

  // Mesh state
  const [messageText, setMessageText] = useState('');
  const [selectedPeer, setSelectedPeer] = useState<MeshPeer | null>(null);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [decryptedCache, setDecryptedCache] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [transportType, setTransportType] = useState<string>('http');

  useEffect(() => {
    const interval = setInterval(() => setTransportType(transportManager.activeType), 5000);
    setTransportType(transportManager.activeType);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (deviceId && !initialized) initialize(deviceId);
  }, [deviceId, initialized]);

  useEffect(() => {
    if (!initialized) return;
    const interval = setInterval(() => {
      const battery = 0.5 + Math.random() * 0.5;
      const signal = 0.3 + Math.random() * 0.7;
      updateRoleHeuristics(battery, signal, peers.length);
    }, 15_000);
    return () => clearInterval(interval);
  }, [initialized, peers.length]);

  // P2P Sync handlers
  const handleP2PSync = async () => {
    if (!deviceId) return;
    setSyncStatus('syncing'); setSyncError(''); setSyncStats(null);
    try {
      const stateRes = await api.get<{ vectorClock: VectorClock }>('/p2p/state');
      const outgoing = await buildSyncPayload(deviceId, stateRes.vectorClock || {});
      const response = await api.post<any>('/p2p/exchange', outgoing);
      const incomingPayload: P2PSyncPayload = { deviceId: response.deviceId, vectorClock: response.vectorClock, changes: response.changes };
      await applySyncPayload(incomingPayload);
      await loadSupplies();
      setSyncStats(response.stats); setSyncStatus('done');
    } catch (err) {
      setSyncStatus('error'); setSyncError((err as Error).message);
    }
  };

  const handleMailboxSync = async () => {
    if (!deviceId || !peerDeviceId.trim()) return;
    setSyncStatus('syncing'); setSyncError('');
    try {
      const outgoing = await buildSyncPayload(deviceId, {});
      await api.post('/p2p/offer', { fromDeviceId: deviceId, toDeviceId: peerDeviceId.trim(), payload: outgoing });
      const pickup = await api.get<any>(`/p2p/pickup?fromDeviceId=${peerDeviceId.trim()}&toDeviceId=${deviceId}`);
      if (pickup.data?.available && pickup.data.payload) {
        await applySyncPayload(pickup.data.payload);
        await loadSupplies();
        setSyncStats({ bytesIn: pickup.data.bytes || 0, bytesOut: JSON.stringify(outgoing).length, totalBytes: (pickup.data.bytes || 0) + JSON.stringify(outgoing).length, deltaSync: false, recordsSent: outgoing.changes.length, recordsReceived: pickup.data.payload.changes?.length || 0 });
      } else {
        setSyncStats({ bytesIn: 0, bytesOut: JSON.stringify(outgoing).length, totalBytes: JSON.stringify(outgoing).length, deltaSync: false, recordsSent: outgoing.changes.length, recordsReceived: 0 });
      }
      setSyncStatus('done');
    } catch (err) {
      setSyncStatus('error'); setSyncError((err as Error).message);
    }
  };

  // Mesh handlers
  const handleSend = async () => {
    if (!selectedPeer || !messageText.trim()) { Alert.alert('Error', 'Select a peer and type a message'); return; }
    setSending(true);
    try {
      await sendMessage(selectedPeer.deviceId, messageText.trim(), selectedPeer.boxPublicKey);
      setMessageText(''); Alert.alert('Sent', 'Message encrypted and queued');
    } catch (err) { Alert.alert('Error', (err as Error).message); }
    setSending(false);
  };

  const handleDecrypt = (msg: MeshMessage) => {
    if (decryptedCache[msg.id]) { setExpandedMsg(expandedMsg === msg.id ? null : msg.id); return; }
    const plaintext = decryptMsg(msg);
    if (plaintext) { setDecryptedCache(prev => ({ ...prev, [msg.id]: plaintext })); setExpandedMsg(msg.id); }
    else Alert.alert('Decryption Failed', 'Cannot decrypt. You may not be the intended recipient.');
  };

  const pendingOutbox = outbox.filter(m => m.status === 'pending');
  const deliveredInbox = inbox.filter(m => m.status === 'delivered' || m.status === 'pending');

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Network</Text>
          <Text style={s.headerSub}>Sync & Mesh Communication</Text>
        </View>
        <View style={s.headerRight}>
          <StatusBadge
            label={nodeRole.toUpperCase()}
            color={nodeRole === 'relay' ? colors.status.success : colors.accent.blue}
            dot
          />
        </View>
      </View>

      {/* Top Tabs */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'mesh' && s.tabActive]}
          onPress={() => setActiveTab('mesh')}
        >
          <Text style={[s.tabText, activeTab === 'mesh' && s.tabTextActive]}>Mesh</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'sync' && s.tabActive]}
          onPress={() => setActiveTab('sync')}
        >
          <Text style={[s.tabText, activeTab === 'sync' && s.tabTextActive]}>Sync</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'mesh' ? (
          <>
            {/* Node Status */}
            <Card style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>NODE STATUS</Text>
                <StatusBadge
                  label={transportType.toUpperCase()}
                  color={transportType === 'ble' ? colors.status.success : colors.accent.blue}
                />
              </View>
              <View style={s.nodeGrid}>
                <View style={s.nodeStatBox}>
                  <Text style={[s.nodeStatValue, { color: batteryLevel > 0.5 ? colors.status.success : colors.status.warning }]}>
                    {(batteryLevel * 100).toFixed(0)}%
                  </Text>
                  <Text style={s.nodeStatLabel}>Battery</Text>
                </View>
                <View style={s.nodeStatBox}>
                  <Text style={[s.nodeStatValue, { color: signalStrength > 0.6 ? colors.status.success : colors.status.warning }]}>
                    {(signalStrength * 100).toFixed(0)}%
                  </Text>
                  <Text style={s.nodeStatLabel}>Signal</Text>
                </View>
                <View style={s.nodeStatBox}>
                  <Text style={[s.nodeStatValue, { color: colors.accent.blue }]}>{connectedPeers}</Text>
                  <Text style={s.nodeStatLabel}>Peers</Text>
                </View>
                {nodeRole === 'relay' && (
                  <View style={s.nodeStatBox}>
                    <Text style={[s.nodeStatValue, { color: colors.module.auth }]}>{relayedCount}</Text>
                    <Text style={s.nodeStatLabel}>Relayed</Text>
                  </View>
                )}
              </View>
              <View style={s.transportRow}>
                <InfoRow label="Transport" value={transportType === 'ble' ? 'Bluetooth Direct' : 'Server Relay'} compact />
                <InfoRow label="Box Key" value={boxPublicKey ? `${boxPublicKey.substring(0, 20)}...` : 'Not set'} valueColor={colors.accent.blueLight} compact />
              </View>
            </Card>

            {/* Peers & Send */}
            <Card style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>SEND MESSAGE</Text>
                <TouchableOpacity onPress={fetchAndCachePeers}>
                  <Text style={s.refreshLink}>Refresh Peers</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.hint}>End-to-end encrypted with NaCl box. Only the recipient can decrypt.</Text>

              {/* Peer List */}
              {peers.length === 0 ? (
                <View style={s.noPeersWrap}>
                  <Text style={s.noPeersText}>No peers found</Text>
                  <ActionButton title="Add Peer via QR" onPress={() => onNavigate?.('qr-pair')} variant="outline" size="sm" />
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.peerList}>
                  {peers.map(peer => (
                    <TouchableOpacity
                      key={peer.deviceId}
                      style={[s.peerCard, selectedPeer?.deviceId === peer.deviceId && s.peerCardActive]}
                      onPress={() => setSelectedPeer(peer)}
                    >
                      <View style={[s.peerAvatar, selectedPeer?.deviceId === peer.deviceId && s.peerAvatarActive]}>
                        <Text style={s.peerAvatarText}>{(peer.name || peer.deviceId)[0].toUpperCase()}</Text>
                      </View>
                      <Text style={[s.peerName, selectedPeer?.deviceId === peer.deviceId && s.peerNameActive]} numberOfLines={1}>
                        {peer.name || peer.deviceId.substring(0, 10)}
                      </Text>
                      <Text style={s.peerRole}>{peer.role}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <TextInput
                style={s.msgInput}
                placeholder="Type your message..."
                placeholderTextColor={colors.text.muted}
                value={messageText}
                onChangeText={setMessageText}
                multiline
              />
              <ActionButton
                title={sending ? 'Encrypting...' : 'Send Encrypted'}
                onPress={handleSend}
                disabled={!selectedPeer || !messageText.trim() || sending}
                loading={sending}
                variant="primary"
                fullWidth
              />
            </Card>

            {/* Inbox */}
            <Card style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>INBOX ({deliveredInbox.length})</Text>
                <TouchableOpacity onPress={checkInbox}>
                  <Text style={s.refreshLink}>Refresh</Text>
                </TouchableOpacity>
              </View>
              {deliveredInbox.length === 0 ? (
                <EmptyState title="No messages" message="Incoming encrypted messages will appear here" />
              ) : (
                deliveredInbox.slice(0, 20).map(msg => (
                  <TouchableOpacity key={msg.id} style={s.msgCard} onPress={() => handleDecrypt(msg)}>
                    <View style={s.msgHeader}>
                      <View style={s.msgFrom}>
                        <View style={s.msgAvatar}>
                          <Text style={s.msgAvatarText}>{msg.sourceDeviceId[0].toUpperCase()}</Text>
                        </View>
                        <View>
                          <Text style={s.msgSender}>{msg.sourceDeviceId.substring(0, 14)}...</Text>
                          <Text style={s.msgTime}>{new Date(msg.createdAt).toLocaleTimeString()}</Text>
                        </View>
                      </View>
                      <StatusBadge label="E2E" color={colors.status.success} size="sm" />
                    </View>
                    <View style={s.msgContent}>
                      <Text style={s.msgText}>
                        {expandedMsg === msg.id && decryptedCache[msg.id] ? decryptedCache[msg.id] : 'Tap to decrypt'}
                      </Text>
                    </View>
                    <View style={s.msgMeta}>
                      <Text style={s.msgMetaText}>Hops: {msg.hopCount}</Text>
                      <Text style={s.msgMetaText}>TTL: {msg.ttl}</Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </Card>

            {/* Outbox */}
            <Card style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>OUTBOX ({outbox.length})</Text>
                <TouchableOpacity onPress={flushOutbox}>
                  <Text style={s.refreshLink}>{isFlushingQueue ? 'Flushing...' : 'Flush'}</Text>
                </TouchableOpacity>
              </View>
              {pendingOutbox.length > 0 && (
                <View style={s.queueBanner}>
                  <Text style={s.queueText}>{pendingOutbox.length} message(s) queued</Text>
                </View>
              )}
              {outbox.length === 0 ? (
                <EmptyState title="No sent messages" />
              ) : (
                outbox.slice(0, 10).map(msg => (
                  <View key={msg.id} style={s.msgCard}>
                    <View style={s.msgHeader}>
                      <Text style={s.msgSender}>To: {msg.targetDeviceId.substring(0, 14)}...</Text>
                      <StatusBadge
                        label={msg.status}
                        color={msg.status === 'delivered' ? colors.status.success : msg.status === 'relayed' ? colors.accent.blue : msg.status === 'expired' ? colors.status.error : colors.status.warning}
                      />
                    </View>
                    <View style={s.msgMeta}>
                      <Text style={s.msgMetaText}>TTL: {msg.ttl}</Text>
                      <Text style={s.msgMetaText}>Hops: {msg.hopCount}</Text>
                    </View>
                  </View>
                ))
              )}
              {lastFlushAt && <Text style={s.lastFlush}>Last flush: {new Date(lastFlushAt).toLocaleTimeString()}</Text>}
            </Card>

            {/* Role History */}
            {roleHistory.length > 0 && (
              <Card style={s.section}>
                <Text style={s.sectionLabel}>ROLE HISTORY</Text>
                {roleHistory.slice(0, 5).map((sw, i) => (
                  <View key={i} style={s.historyItem}>
                    <View style={s.historyHeader}>
                      <View style={s.historyBadges}>
                        <StatusBadge label={sw.from} color={colors.text.muted} size="sm" />
                        <Text style={s.historyArrow}>{'\u2192'}</Text>
                        <StatusBadge
                          label={sw.to}
                          color={sw.to === 'relay' ? colors.status.success : colors.accent.blue}
                          size="sm"
                        />
                      </View>
                      <Text style={s.historyTime}>{new Date(sw.timestamp).toLocaleTimeString()}</Text>
                    </View>
                    <Text style={s.historyReason}>{sw.reason}</Text>
                  </View>
                ))}
              </Card>
            )}
          </>
        ) : (
          /* SYNC TAB */
          <>
            {/* Your Device */}
            <Card style={s.section}>
              <Text style={s.sectionLabel}>YOUR DEVICE</Text>
              <TouchableOpacity onPress={() => {
                if (deviceId) { Clipboard.setString(deviceId); Alert.alert('Copied', 'Device ID copied. Share with peer.'); }
              }}>
                <View style={s.deviceIdBox}>
                  <Text style={s.deviceIdIcon}>{'\u2B22'}</Text>
                  <Text style={s.deviceIdText} numberOfLines={2} selectable>{deviceId || 'none'}</Text>
                </View>
              </TouchableOpacity>
              <Text style={s.hint}>Tap to copy. Share with the other device for sync.</Text>
            </Card>

            {/* Direct Exchange */}
            <Card style={s.section}>
              <Text style={s.sectionLabel}>DIRECT EXCHANGE</Text>
              <Text style={s.hint}>Exchange CRDT states with all connected devices via relay. Uses delta-sync: only sends records the peer hasn't seen.</Text>
              <ActionButton
                title={syncStatus === 'syncing' ? 'Syncing...' : 'Exchange Now'}
                onPress={handleP2PSync}
                loading={syncStatus === 'syncing'}
                variant="primary"
                fullWidth
                style={{ marginTop: spacing.md }}
              />
            </Card>

            {/* Device Mailbox */}
            <Card style={s.section}>
              <Text style={s.sectionLabel}>DEVICE-TO-DEVICE MAILBOX</Text>
              <Text style={s.hint}>Send changes to a specific device. They pick up when online.</Text>
              <TextInput
                style={s.input}
                placeholder="Peer Device ID"
                placeholderTextColor={colors.text.muted}
                value={peerDeviceId}
                onChangeText={setPeerDeviceId}
              />
              <ActionButton
                title="Send & Receive"
                onPress={handleMailboxSync}
                disabled={!peerDeviceId.trim() || syncStatus === 'syncing'}
                loading={syncStatus === 'syncing'}
                variant="secondary"
                fullWidth
              />
            </Card>

            {/* Sync Stats */}
            {syncStats && (
              <Card style={s.section} variant="accent" accentColor={syncStatus === 'done' ? colors.status.success : colors.status.error}>
                <Text style={s.sectionLabel}>SYNC RESULT</Text>
                <InfoRow label="Status" value={syncStatus === 'done' ? 'Success' : 'Error'} valueColor={syncStatus === 'done' ? colors.status.success : colors.status.error} />
                <InfoRow label="Records sent" value={String(syncStats.recordsSent)} />
                <InfoRow label="Records received" value={String(syncStats.recordsReceived)} />
                <InfoRow label="Bytes out" value={`${syncStats.bytesOut} B`} />
                <InfoRow label="Bytes in" value={`${syncStats.bytesIn} B`} />
                <InfoRow
                  label="Total transfer"
                  value={syncStats.totalBytes < 10240 ? `${syncStats.totalBytes} B (< 10KB)` : `${(syncStats.totalBytes / 1024).toFixed(1)} KB`}
                  valueColor={syncStats.totalBytes < 10240 ? colors.status.success : colors.status.warning}
                />
                <InfoRow label="Delta sync" value={syncStats.deltaSync ? 'Yes' : 'Full sync'} />
              </Card>
            )}

            {syncStatus === 'error' && syncError && (
              <Card variant="accent" accentColor={colors.status.error}>
                <Text style={s.errorText}>{syncError}</Text>
              </Card>
            )}
          </>
        )}

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  headerTitle: { ...textStyles.h3, color: colors.text.primary },
  headerSub: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // Tabs
  tabBar: {
    flexDirection: 'row', backgroundColor: colors.bg.card,
    borderBottomWidth: 1, borderBottomColor: colors.border.default,
    paddingHorizontal: spacing.lg,
  },
  tab: {
    flex: 1, paddingVertical: spacing.md,
    alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.accent.blue },
  tabText: { fontSize: fontSize.base, fontWeight: fontWeight.medium, color: colors.text.muted },
  tabTextActive: { color: colors.accent.blue, fontWeight: fontWeight.semibold },

  // Content
  content: { padding: spacing.lg },

  // Sections
  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sectionLabel: { ...textStyles.label, color: colors.text.muted, marginBottom: spacing.sm },
  hint: { fontSize: fontSize.sm, color: colors.text.muted, marginBottom: spacing.md, lineHeight: 18 },
  refreshLink: { color: colors.accent.blue, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  // Node stats
  nodeGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  nodeStatBox: {
    flex: 1, backgroundColor: colors.bg.elevated,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center',
  },
  nodeStatValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  nodeStatLabel: { fontSize: fontSize.xs, color: colors.text.muted, marginTop: spacing.xs },
  transportRow: {},

  // Peers
  peerList: { marginBottom: spacing.md },
  noPeersWrap: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  noPeersText: { color: colors.text.muted, fontSize: fontSize.md },
  peerCard: {
    alignItems: 'center', padding: spacing.md,
    backgroundColor: colors.bg.elevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border.default,
    marginRight: spacing.sm, minWidth: 90,
  },
  peerCardActive: { borderColor: colors.accent.blue, backgroundColor: colors.accent.blueMuted },
  peerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.border.default,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  peerAvatarActive: { backgroundColor: colors.accent.blue },
  peerAvatarText: { color: colors.text.primary, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  peerName: { fontSize: fontSize.sm, color: colors.text.secondary, fontWeight: fontWeight.medium },
  peerNameActive: { color: colors.accent.blueLight },
  peerRole: { fontSize: fontSize.xs, color: colors.text.muted, marginTop: 2 },

  // Message input
  msgInput: {
    backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, padding: spacing.md, color: colors.text.primary,
    fontSize: fontSize.base, marginBottom: spacing.md, minHeight: 60, textAlignVertical: 'top',
  },
  input: {
    backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, padding: spacing.md, color: colors.text.primary,
    fontSize: fontSize.base, marginBottom: spacing.md,
  },

  // Messages
  msgCard: {
    backgroundColor: colors.bg.elevated, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.sm,
    borderWidth: 1, borderColor: colors.border.default,
  },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  msgFrom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  msgAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.accent.blueMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  msgAvatarText: { color: colors.accent.blue, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  msgSender: { fontSize: fontSize.md, color: colors.text.secondary, fontWeight: fontWeight.medium },
  msgTime: { fontSize: fontSize.xs, color: colors.text.muted },
  msgContent: {
    backgroundColor: colors.bg.card, borderRadius: radius.sm,
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  msgText: { fontSize: fontSize.md, color: colors.text.tertiary },
  msgMeta: { flexDirection: 'row', gap: spacing.lg },
  msgMetaText: { fontSize: fontSize.xs, color: colors.text.muted },

  // Queue
  queueBanner: {
    backgroundColor: colors.status.warningMuted,
    borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm,
  },
  queueText: { color: colors.status.warning, fontSize: fontSize.sm, textAlign: 'center', fontWeight: fontWeight.medium },
  lastFlush: { color: colors.text.muted, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.sm },

  // Role history
  historyItem: { borderTopWidth: 1, borderTopColor: colors.border.default, paddingTop: spacing.sm, marginTop: spacing.sm },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  historyArrow: { color: colors.text.muted, fontSize: 14 },
  historyTime: { fontSize: fontSize.xs, color: colors.text.muted },
  historyReason: { fontSize: fontSize.sm, color: colors.text.tertiary, marginTop: spacing.xs },

  // Device ID
  deviceIdBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.elevated, borderRadius: radius.md,
    padding: spacing.md, gap: spacing.sm,
  },
  deviceIdIcon: { fontSize: 14, color: colors.accent.blue },
  deviceIdText: { color: colors.text.tertiary, fontSize: fontSize.sm, flex: 1 },

  // Error
  errorText: { color: colors.status.error, fontSize: fontSize.md },
});
