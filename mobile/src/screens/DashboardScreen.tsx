import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Clipboard,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { api } from '../lib/api';
import { useAuthStore } from '../lib/useAuthStore';
import { useSupplyStore } from '../lib/useSupplyStore';
import { useTriageStore } from '../lib/useTriageStore';
import { useMeshStore } from '../lib/useMeshStore';
import { clearAllTables } from '../lib/database';
import { Card } from '../components/Card';
import { ActionButton } from '../components/ActionButton';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { StatCard } from '../components/StatCard';
import { InfoRow } from '../components/InfoRow';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { EmptyState } from '../components/EmptyState';
import { ChipSelector } from '../components/ChipSelector';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';
import ConflictModal from './ConflictModal';

const CATEGORIES = [
  { key: 'water', label: 'Water' },
  { key: 'food', label: 'Food' },
  { key: 'medical', label: 'Medical' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'shelter', label: 'Shelter' },
];

const PRIORITIES = [
  { key: 'P0', label: 'P0', color: colors.priority.p0 },
  { key: 'P1', label: 'P1', color: colors.priority.p1 },
  { key: 'P2', label: 'P2', color: colors.priority.p2 },
  { key: 'P3', label: 'P3', color: colors.priority.p3 },
];

export default function DashboardScreen({ navigation }: any) {
  const { user, logout, resetDevice, initialize, token, deviceId, publicKey } = useAuthStore();
  const isOnline = useOnlineStatus();
  const {
    supplies, pendingCount, syncStatus, lastSyncAt,
    conflicts, pendingConflicts,
    loadSupplies, createSupply, updateSupply,
    syncWithServer, resolveConflict, dismissConflicts,
    resetState: resetSupplyState,
  } = useSupplyStore();
  const { resetState: resetTriageState } = useTriageStore();
  const { resetState: resetMeshState } = useMeshStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // New supply form state
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('water');
  const [newQty, setNewQty] = useState('');
  const [newPriority, setNewPriority] = useState('P2');

  useEffect(() => { loadSupplies(); }, []);

  // WebSocket auto-refresh
  useEffect(() => {
    const apiUrl = api.getBaseUrl() || '';
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/api\/v1$/, '');
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (['sync:push', 'DELIVERY_CREATED', 'DELIVERY_STATUS_CHANGED', 'POD_CONFIRMED', 'TRIAGE_EVALUATED', 'PREEMPTION_EXECUTED'].includes(msg.type)) {
            loadSupplies();
          }
        } catch {}
      };
      ws.onerror = () => {};
    } catch {}
    return () => { try { ws?.close(); } catch {} };
  }, []);

  // Auto-sync on reconnect
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (!isOnline) { setWasOffline(true); }
    else if (wasOffline && isOnline) { setWasOffline(false); syncWithServer(); }
  }, [isOnline]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) await syncWithServer();
    else await loadSupplies();
    setRefreshing(false);
  }, [isOnline]);

  const handleAddSupply = async () => {
    if (!newName.trim() || !newQty.trim()) {
      Alert.alert('Error', 'Name and quantity are required');
      return;
    }
    await createSupply({
      name: newName.trim(),
      category: newCategory as any,
      quantity: parseInt(newQty, 10) || 0,
      unit: 'units',
      priority: newPriority as any,
      nodeId: null,
    });
    setNewName(''); setNewQty(''); setShowAddForm(false);
  };

  const handleUpdateQty = async (id: string) => {
    const qty = parseInt(editQty, 10);
    if (isNaN(qty)) return;
    await updateSupply(id, { quantity: qty });
    setEditingId(null); setEditQty('');
  };

  const handleLogout = async () => {
    await logout();
    navigation.replace('Login');
  };

  const handleResetDevice = () => {
    Alert.alert(
      'Reset Device',
      'This will delete ALL device data (keys, TOTP, identity). You will need to re-register. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: async () => { await resetDevice(); await initialize(); navigation.replace('Login'); } },
      ],
    );
  };

  const handleDeleteAllData = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete ALL app data including supplies, messages, deliveries, sync state, keys, and identity. You will need to re-register. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllTables();
              resetSupplyState();
              resetTriageState();
              resetMeshState();
              await resetDevice();
              await initialize();
              navigation.replace('Login');
            } catch (err) {
              Alert.alert('Error', 'Failed to delete data: ' + (err as Error).message);
            }
          },
        },
      ],
    );
  };

  // Group supplies by category
  const filteredSupplies = supplies.filter((s) =>
    !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedSupplies = filteredSupplies.reduce<Record<string, typeof supplies>>((acc, s) => {
    const cat = s.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const syncColor = syncStatus === 'synced' ? colors.status.success : syncStatus === 'error' ? colors.status.error : syncStatus === 'syncing' ? colors.accent.blue : colors.text.muted;
  const syncLabel = syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'synced' ? 'Synced' : syncStatus === 'error' ? 'Error' : 'Idle';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent.blue} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.logoSmall}>
              <Text style={s.logoSmallText}>{'\u0394'}</Text>
            </View>
            <View>
              <Text style={s.headerTitle}>Digital Delta</Text>
              <Text style={s.headerSub}>
                {user?.name || 'Operator'} {'\u2022'} {user?.role || 'unknown'}
              </Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <OnlineIndicator isOnline={isOnline} />
            <TouchableOpacity onPress={() => setShowSettings(true)} style={s.settingsBtn}>
              <Text style={s.settingsIcon}>{'\u2699'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sync Status Bar */}
        <View style={s.syncBar}>
          <View style={s.syncBarLeft}>
            <View style={[s.syncDot, { backgroundColor: syncColor }]} />
            <Text style={[s.syncText, { color: syncColor }]}>{syncLabel}</Text>
            {lastSyncAt && <Text style={s.syncTime}>{'\u2022'} {new Date(lastSyncAt).toLocaleTimeString()}</Text>}
          </View>
          <View style={s.syncBarRight}>
            {pendingCount > 0 && (
              <StatusBadge label={`${pendingCount} pending`} color={colors.status.warning} size="sm" />
            )}
            <TouchableOpacity onPress={syncWithServer} disabled={syncStatus === 'syncing'} style={s.syncNowBtn}>
              <Text style={s.syncNowText}>{syncStatus === 'syncing' ? '...' : 'Sync'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Offline Alert */}
        {!isOnline && (
          <Card style={s.offlineCard} variant="accent" accentColor={colors.status.error}>
            <View style={s.offlineContent}>
              <Text style={s.offlineTitle}>No Server Connection</Text>
              <Text style={s.offlineMsg}>Operating in offline mode. Data syncs automatically when connection is restored.</Text>
              <ActionButton
                title="QR Pair & LAN Setup"
                onPress={() => navigation.replace('qr-pair')}
                variant="outline"
                size="sm"
                style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
              />
            </View>
          </Card>
        )}

        {/* Quick Stats */}
        <View style={s.statsRow}>
          <StatCard value={supplies.length} label="Supplies" color={colors.accent.blue} />
          <View style={{ width: spacing.sm }} />
          <StatCard value={pendingCount} label="Pending" color={pendingCount > 0 ? colors.status.warning : colors.text.muted} />
          <View style={{ width: spacing.sm }} />
          <StatCard
            value={conflicts.length}
            label="Conflicts"
            color={conflicts.length > 0 ? colors.module.auth : colors.text.muted}
          />
        </View>

        {/* Search + Add */}
        <View style={s.actionBar}>
          <View style={s.searchWrap}>
            <Text style={s.searchIcon}>{'\u2315'}</Text>
            <TextInput
              style={s.searchInput}
              placeholder="Search supplies..."
              placeholderTextColor={colors.text.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <ActionButton
            title="+ Add"
            onPress={() => setShowAddForm(true)}
            variant="success"
            size="sm"
          />
        </View>

        {/* Supply List by Category */}
        {Object.keys(groupedSupplies).length > 0 ? (
          Object.entries(groupedSupplies).map(([category, items]) => (
            <View key={category} style={s.categorySection}>
              <View style={s.categoryHeader}>
                <Text style={s.categoryLabel}>{category.toUpperCase()}</Text>
                <Text style={s.categoryCount}>{items.length}</Text>
              </View>
              {items.map((supply) => (
                <Card key={supply.id} style={s.supplyCard}>
                  <View style={s.supplyRow}>
                    <View style={s.supplyInfo}>
                      <View style={s.supplyNameRow}>
                        <Text style={s.supplyName}>{supply.name}</Text>
                        <PriorityBadge priority={supply.priority} />
                      </View>
                      <View style={s.supplyMeta}>
                        {editingId === supply.id ? (
                          <View style={s.editRow}>
                            <TextInput
                              style={s.editInput}
                              value={editQty}
                              onChangeText={setEditQty}
                              keyboardType="numeric"
                              autoFocus
                            />
                            <TouchableOpacity onPress={() => handleUpdateQty(supply.id)}>
                              <Text style={s.editSave}>{'\u2713'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setEditingId(null)}>
                              <Text style={s.editCancel}>{'\u2717'}</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => { setEditingId(supply.id); setEditQty(String(supply.quantity)); }}
                            style={s.qtyWrap}
                          >
                            <Text style={s.supplyQty}>{supply.quantity}</Text>
                            <Text style={s.supplyUnit}>{supply.unit}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          ))
        ) : (
          <EmptyState
            title="No supplies found"
            message={searchQuery ? 'Try a different search term' : 'Add supplies or sync with the server to get started'}
          />
        )}

        <View style={{ height: spacing['2xl'] }} />
      </ScrollView>

      {/* Settings Modal */}
      <Modal visible={showSettings} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Settings</Text>
            {user && (
              <>
                <InfoRow label="Name" value={user.name || 'Not set'} />
                <InfoRow label="Role" value={user.role} />
              </>
            )}
            <TouchableOpacity onPress={() => {
              if (deviceId) { Clipboard.setString(deviceId); Alert.alert('Copied', 'Device ID copied'); }
            }}>
              <InfoRow label="Device ID" value={deviceId || 'none'} valueColor={colors.accent.blueLight} />
            </TouchableOpacity>
            <InfoRow label="Auth" value={token ? 'JWT (online)' : 'TOTP (offline)'} valueColor={token ? colors.status.success : colors.status.warning} />
            <InfoRow label="Status" value={isOnline ? 'Online' : 'Offline'} valueColor={isOnline ? colors.status.success : colors.status.error} />
            <InfoRow label="Supplies" value={`${supplies.length} items (${pendingCount} pending)`} />
            {publicKey && (
              <TouchableOpacity onPress={() => { Clipboard.setString(publicKey); Alert.alert('Copied', 'Public key copied'); }}>
                <InfoRow label="Public Key" value={publicKey.substring(0, 16) + '...'} valueColor={colors.accent.blueLight} />
              </TouchableOpacity>
            )}
            <InfoRow label="Sync" value={syncLabel} valueColor={syncColor} />
            {lastSyncAt && <InfoRow label="Last Sync" value={new Date(lastSyncAt).toLocaleString()} />}

            <ActionButton
              title="Refresh"
              onPress={async () => {
                await initialize();
                await loadSupplies();
                Alert.alert('Refreshed', 'App state has been refreshed.');
              }}
              variant="outline"
              size="sm"
              fullWidth
              style={{ marginTop: spacing.lg }}
            />
            <View style={[s.settingsBtns, { marginTop: spacing.sm }]}>
              <ActionButton title="Logout" onPress={handleLogout} variant="secondary" size="sm" style={{ flex: 1 }} />
              <View style={{ width: spacing.sm }} />
              <ActionButton title="Reset Device" onPress={handleResetDevice} variant="destructive" size="sm" style={{ flex: 1 }} />
            </View>
            <ActionButton title="Delete All Data" onPress={handleDeleteAllData} variant="destructive" style={{ marginTop: spacing.sm }} fullWidth />
            <ActionButton title="Close" onPress={() => setShowSettings(false)} variant="ghost" style={{ marginTop: spacing.md }} />
          </View>
        </View>
      </Modal>

      {/* Add Supply Modal */}
      <Modal visible={showAddForm} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Add New Supply</Text>

            <Text style={s.fieldLabel}>Name</Text>
            <TextInput
              style={s.input}
              placeholder="Supply name"
              placeholderTextColor={colors.text.muted}
              value={newName}
              onChangeText={setNewName}
            />

            <Text style={s.fieldLabel}>Quantity</Text>
            <TextInput
              style={s.input}
              placeholder="0"
              placeholderTextColor={colors.text.muted}
              value={newQty}
              onChangeText={setNewQty}
              keyboardType="numeric"
            />

            <Text style={s.fieldLabel}>Category</Text>
            <ChipSelector
              options={CATEGORIES}
              selected={newCategory}
              onSelect={setNewCategory}
              accentColor={colors.module.sync}
            />

            <Text style={s.fieldLabel}>Priority</Text>
            <ChipSelector
              options={PRIORITIES}
              selected={newPriority}
              onSelect={setNewPriority}
            />

            <View style={s.modalActions}>
              <ActionButton title="Cancel" onPress={() => setShowAddForm(false)} variant="ghost" style={{ flex: 1 }} />
              <ActionButton title="Create Supply" onPress={handleAddSupply} variant="primary" style={{ flex: 2 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* M2.3: Conflict Resolution Modal */}
      <ConflictModal
        visible={pendingConflicts.length > 0}
        conflicts={pendingConflicts}
        onResolve={resolveConflict}
        onDismiss={dismissConflicts}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.lg, paddingTop: spacing.sm },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoSmall: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.accent.blueMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  logoSmallText: { fontSize: 20, fontWeight: '800', color: colors.accent.blue },
  headerTitle: { ...textStyles.h4, color: colors.text.primary },
  headerSub: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center', justifyContent: 'center',
  },
  settingsIcon: { fontSize: 18, color: colors.text.tertiary },

  // Sync Bar
  syncBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.bg.card, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border.default,
  },
  syncBarLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  syncDot: { width: 6, height: 6, borderRadius: 3 },
  syncText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  syncTime: { fontSize: fontSize.xs, color: colors.text.muted },
  syncBarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  syncNowBtn: {
    backgroundColor: colors.accent.blueMuted, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  syncNowText: { color: colors.accent.blue, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  // Offline
  offlineCard: { marginBottom: spacing.lg },
  offlineContent: { gap: spacing.xs },
  offlineTitle: { ...textStyles.h4, color: colors.status.error },
  offlineMsg: { fontSize: fontSize.sm, color: colors.text.muted, lineHeight: 18 },

  // Stats
  statsRow: { flexDirection: 'row', marginBottom: spacing.lg },

  // Search + Action bar
  actionBar: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, alignItems: 'center' },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border.default,
    paddingHorizontal: spacing.md,
  },
  searchIcon: { fontSize: 16, color: colors.text.muted, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.text.primary, fontSize: fontSize.base, paddingVertical: spacing.sm },

  // Category sections
  categorySection: { marginBottom: spacing.lg },
  categoryHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm, paddingHorizontal: spacing.xs,
  },
  categoryLabel: {
    fontSize: fontSize.xs, fontWeight: fontWeight.bold,
    color: colors.text.muted, letterSpacing: 1.5,
  },
  categoryCount: {
    fontSize: fontSize.xs, color: colors.text.muted,
    backgroundColor: colors.bg.elevated, paddingHorizontal: spacing.sm,
    paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden',
  },

  // Supply cards
  supplyCard: { marginBottom: spacing.sm, padding: spacing.md },
  supplyRow: { flexDirection: 'row', alignItems: 'center' },
  supplyInfo: { flex: 1 },
  supplyNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  supplyName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text.primary, flex: 1 },
  supplyMeta: { flexDirection: 'row', alignItems: 'center' },
  qtyWrap: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  supplyQty: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.accent.blueLight },
  supplyUnit: { fontSize: fontSize.sm, color: colors.text.muted },

  // Edit inline
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editInput: {
    backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.accent.blue,
    borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    color: colors.text.primary, width: 70, fontSize: fontSize.base,
  },
  editSave: { color: colors.status.success, fontSize: 18, fontWeight: '700' },
  editCancel: { color: colors.status.error, fontSize: 18, fontWeight: '700' },

  // Settings
  settingsBtns: { flexDirection: 'row', marginTop: spacing.lg },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: colors.bg.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.bg.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing['2xl'], paddingBottom: spacing['4xl'],
    borderWidth: 1, borderColor: colors.border.default,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border.light,
    alignSelf: 'center', marginBottom: spacing.xl,
  },
  modalTitle: { ...textStyles.h3, color: colors.text.primary, marginBottom: spacing.lg },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },

  // Form fields
  fieldLabel: {
    fontSize: fontSize.sm, fontWeight: fontWeight.semibold,
    color: colors.text.secondary, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    color: colors.text.primary, fontSize: fontSize.base,
  },
});
