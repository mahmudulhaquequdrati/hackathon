import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Clipboard,
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
import ConflictModal from './ConflictModal';

export default function DashboardScreen({ navigation }: any) {
  const { user, logout, resetDevice, token, deviceId } = useAuthStore();
  const isOnline = useOnlineStatus();
  const {
    supplies,
    pendingCount,
    syncStatus,
    lastSyncAt,
    conflicts,
    pendingConflicts,
    loadSupplies,
    createSupply,
    updateSupply,
    syncWithServer,
    resolveConflict,
    dismissConflicts,
  } = useSupplyStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // New supply form state
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('water');
  const [newQty, setNewQty] = useState('');
  const [newPriority, setNewPriority] = useState('P2');

  // Load supplies on mount
  useEffect(() => {
    loadSupplies();
  }, []);

  // Auto-sync when coming back online
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline && isOnline) {
      setWasOffline(false);
      syncWithServer();
    }
  }, [isOnline]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) {
      await syncWithServer();
    } else {
      await loadSupplies();
    }
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
    setNewName('');
    setNewQty('');
    setShowAddForm(false);
  };

  const handleUpdateQty = async (id: string) => {
    const qty = parseInt(editQty, 10);
    if (isNaN(qty)) return;
    await updateSupply(id, { quantity: qty });
    setEditingId(null);
    setEditQty('');
  };

  const handleLogout = async () => {
    await logout();
    navigation.replace('Login');
  };

  const handleResetDevice = () => {
    Alert.alert(
      'Reset Device',
      'This will delete ALL device data (keys, TOTP, identity). You will need to re-register as a new device. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetDevice();
            navigation.replace('Login');
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
      >
        {/* Header */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.title}>Digital Delta</Text>
            <Text style={s.sub}>Disaster relief operations</Text>
          </View>
          <View style={[s.badge, isOnline ? s.badgeOnline : s.badgeOffline]}>
            <View style={[s.dot, { backgroundColor: isOnline ? '#22c55e' : '#ef4444' }]} />
            <Text style={[s.badgeTxt, { color: isOnline ? '#22c55e' : '#ef4444' }]}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Connection Status — show when offline so user knows why */}
        {!isOnline && (
          <OfflineCard navigation={navigation} />
        )}

        {/* Identity Card */}
        {user ? (
          <View style={s.card}>
            <Text style={s.cardH}>IDENTITY</Text>
            <Row label="Name" value={user.name || user.deviceId} />
            <Row label="Role" value={user.role} />
            <Row label="Auth" value={token ? 'JWT (online)' : 'TOTP (offline)'} color={token ? '#22c55e' : '#f59e0b'} />
            <TouchableOpacity onPress={() => {
              if (deviceId) {
                Clipboard.setString(deviceId);
                Alert.alert('Copied', 'Device ID copied to clipboard');
              }
            }}>
              <View style={s.stateRow}>
                <Text style={s.stateLabel}>Device</Text>
                <Text style={[s.stateValue, { color: '#60a5fa', textDecorationLine: 'underline' }]} numberOfLines={1}>{deviceId || 'none'}</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Sync Status */}
        <View style={s.card}>
          <Text style={s.cardH}>SYNC STATUS</Text>
          <Row
            label="Status"
            value={syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'synced' ? 'Synced' : syncStatus === 'error' ? 'Error' : 'Idle'}
            color={syncStatus === 'synced' ? '#22c55e' : syncStatus === 'error' ? '#ef4444' : syncStatus === 'syncing' ? '#3b82f6' : '#9ca3af'}
          />
          <Row label="Pending" value={`${pendingCount} changes`} color={pendingCount > 0 ? '#f59e0b' : '#9ca3af'} />
          {lastSyncAt && <Row label="Last sync" value={new Date(lastSyncAt).toLocaleTimeString()} />}
          {conflicts.length > 0 && (
            <Row label="Conflicts" value={`${conflicts.length} resolved`} color="#a855f7" />
          )}

          <TouchableOpacity
            style={[s.syncBtn, syncStatus === 'syncing' && s.syncBtnDisabled]}
            onPress={syncWithServer}
            disabled={syncStatus === 'syncing'}
          >
            <Text style={s.syncBtnText}>
              {syncStatus === 'syncing' ? 'Syncing...' : isOnline ? 'Sync Now' : 'Sync Now (try LAN)'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={s.row}>
          <StatTile label="Supplies" value={supplies.length} />
          <StatTile label="Pending" value={pendingCount} />
        </View>

        {/* Add Supply Button */}
        <TouchableOpacity style={s.addBtn} onPress={() => setShowAddForm(!showAddForm)}>
          <Text style={s.addBtnText}>{showAddForm ? 'Cancel' : '+ Add Supply'}</Text>
        </TouchableOpacity>

        {/* Add Supply Form */}
        {showAddForm && (
          <View style={s.card}>
            <Text style={s.cardH}>NEW SUPPLY</Text>
            <TextInput style={s.input} placeholder="Name" placeholderTextColor="#6b7280" value={newName} onChangeText={setNewName} />
            <TextInput style={s.input} placeholder="Quantity" placeholderTextColor="#6b7280" value={newQty} onChangeText={setNewQty} keyboardType="numeric" />
            <View style={s.chipRow}>
              {(['water', 'food', 'medical', 'equipment', 'shelter'] as const).map((cat) => (
                <TouchableOpacity key={cat} style={[s.chip, newCategory === cat && s.chipActive]} onPress={() => setNewCategory(cat)}>
                  <Text style={[s.chipText, newCategory === cat && s.chipTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.chipRow}>
              {(['P0', 'P1', 'P2', 'P3'] as const).map((p) => (
                <TouchableOpacity key={p} style={[s.chip, newPriority === p && s.chipActive]} onPress={() => setNewPriority(p)}>
                  <Text style={[s.chipText, newPriority === p && s.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.submitBtn} onPress={handleAddSupply}>
              <Text style={s.submitBtnText}>Create Supply</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Supply List */}
        {supplies.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[s.cardH, { marginBottom: 8 }]}>SUPPLIES ({supplies.length})</Text>
            {supplies.map((supply) => (
              <View key={supply.id} style={s.supplyCard}>
                <View style={s.supplyHeader}>
                  <Text style={s.supplyName}>{supply.name}</Text>
                  <View style={[s.priorityBadge, priorityColor(supply.priority)]}>
                    <Text style={s.priorityText}>{supply.priority}</Text>
                  </View>
                </View>
                <View style={s.supplyBody}>
                  <Text style={s.supplyDetail}>{supply.category}</Text>
                  <Text style={s.supplySep}>|</Text>
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
                        <Text style={s.editSave}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingId(null)}>
                        <Text style={s.editCancel}>X</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => {
                        setEditingId(supply.id);
                        setEditQty(String(supply.quantity));
                      }}
                    >
                      <Text style={s.supplyQty}>
                        {supply.quantity} {supply.unit}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {supplies.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyText}>No supplies yet. Add one or sync with the server.</Text>
          </View>
        )}

        {/* P2P Sync */}
        <TouchableOpacity style={s.p2pBtn} onPress={() => navigation.replace('p2p')}>
          <Text style={s.p2pBtnText}>P2P Device Sync</Text>
        </TouchableOpacity>

        {/* Mesh Network */}
        <TouchableOpacity style={s.meshBtn} onPress={() => navigation.replace('mesh')}>
          <Text style={s.meshBtnText}>Mesh Network</Text>
        </TouchableOpacity>

        {/* QR Pair / LAN Setup */}
        <TouchableOpacity style={s.qrPairBtn} onPress={() => navigation.replace('qr-pair')}>
          <Text style={s.qrPairBtnText}>QR Pair & LAN Setup</Text>
        </TouchableOpacity>

        {/* Route Map */}
        <TouchableOpacity style={s.routeBtn} onPress={() => navigation.replace('routes')}>
          <Text style={s.routeBtnText}>Route Map</Text>
        </TouchableOpacity>

        {/* Deliveries & PoD */}
        <TouchableOpacity style={s.deliveryBtn} onPress={() => navigation.replace('delivery')}>
          <Text style={s.deliveryBtnText}>Deliveries & PoD</Text>
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={s.logoutText}>Logout</Text>
        </TouchableOpacity>

        {/* Reset Device */}
        <TouchableOpacity style={s.resetBtn} onPress={handleResetDevice}>
          <Text style={s.resetText}>Reset Device (Re-register)</Text>
        </TouchableOpacity>
      </ScrollView>

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

function OfflineCard({ navigation }: { navigation: any }) {
  const [fallbackUrl, setFallbackUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.getSavedFallbackUrl().then(setFallbackUrl);
  }, []);

  const switchToFallback = async () => {
    if (fallbackUrl) {
      await api.saveBaseUrl(fallbackUrl);
      Alert.alert('Switched', `Now connecting to: ${fallbackUrl}`);
    }
  };

  return (
    <View style={[s.card, { borderColor: '#ef4444' }]}>
      <Text style={s.cardH}>NO SERVER CONNECTION</Text>
      <Row label="Trying" value={api.getBaseUrl()} color="#ef4444" />
      <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 6, lineHeight: 18 }}>
        Server not reachable. You can:{'\n'}
        • Start your laptop server (npm start){'\n'}
        • Start Hub Mode on a phone{'\n'}
        • Connect to another phone's Hub
      </Text>

      {/* {fallbackUrl && fallbackUrl !== api.getBaseUrl() && (
        <TouchableOpacity
          style={{ backgroundColor: '#065f46', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 }}
          onPress={switchToFallback}
        >
          <Text style={{ color: '#6ee7b7', fontSize: 13, fontWeight: '600' }}>
            Switch to last Hub: {fallbackUrl}
          </Text>
        </TouchableOpacity>
      )} */}

      <TouchableOpacity
        style={{ backgroundColor: '#713f12', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 }}
        onPress={() => navigation.replace('qr-pair')}
      >
        <Text style={{ color: '#fbbf24', fontSize: 14, fontWeight: '600' }}>QR Pair & LAN Setup</Text>
      </TouchableOpacity>
    </View>
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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.stat}>
      <Text style={s.statNum}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function priorityColor(p: string): { backgroundColor: string; borderColor: string } {
  switch (p) {
    case 'P0': return { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: '#dc2626' };
    case 'P1': return { backgroundColor: 'rgba(249,115,22,0.15)', borderColor: '#ea580c' };
    case 'P2': return { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#2563eb' };
    default: return { backgroundColor: 'rgba(156,163,175,0.15)', borderColor: '#6b7280' };
  }
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 20, paddingTop: 16 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  sub: { fontSize: 13, color: '#9ca3af', marginTop: 2 },

  badge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 },
  badgeOnline: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: '#166534' },
  badgeOffline: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: '#991b1b' },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  badgeTxt: { fontSize: 12, fontWeight: '600' },

  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 14, padding: 16, marginBottom: 16 },
  cardH: { fontSize: 11, fontWeight: 'bold', color: '#9ca3af', letterSpacing: 1, marginBottom: 10 },

  stateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  stateLabel: { fontSize: 13, color: '#6b7280' },
  stateValue: { fontSize: 13, color: '#d1d5db', flex: 1, textAlign: 'right' },

  row: { flexDirection: 'row', marginBottom: 12 },
  stat: { flex: 1, backgroundColor: '#111827', borderRadius: 14, padding: 16, marginRight: 12, borderWidth: 1, borderColor: '#374151' },
  statNum: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 13, color: '#9ca3af', marginTop: 2 },

  // Sync button
  syncBtn: { backgroundColor: '#1e40af', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 12 },
  syncBtnDisabled: { backgroundColor: '#374151', opacity: 0.5 },
  syncBtnText: { color: '#93c5fd', fontSize: 14, fontWeight: '600' },

  // Add button
  addBtn: { backgroundColor: '#065f46', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  addBtnText: { color: '#6ee7b7', fontSize: 14, fontWeight: '600' },

  // Form
  input: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, gap: 6 },
  chip: { borderWidth: 1, borderColor: '#374151', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)' },
  chipText: { color: '#9ca3af', fontSize: 12 },
  chipTextActive: { color: '#93c5fd' },
  submitBtn: { backgroundColor: '#1e40af', borderRadius: 10, padding: 12, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Supply list
  supplyCard: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 12, padding: 14, marginBottom: 10 },
  supplyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  supplyName: { color: '#f3f4f6', fontSize: 15, fontWeight: '600', flex: 1 },
  priorityBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  priorityText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  supplyBody: { flexDirection: 'row', alignItems: 'center' },
  supplyDetail: { color: '#9ca3af', fontSize: 13 },
  supplySep: { color: '#4b5563', marginHorizontal: 8 },
  supplyQty: { color: '#60a5fa', fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  // Edit inline
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#3b82f6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, color: '#fff', width: 70, fontSize: 13 },
  editSave: { color: '#22c55e', fontSize: 13, fontWeight: '600' },
  editCancel: { color: '#ef4444', fontSize: 13, fontWeight: '600' },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { color: '#6b7280', fontSize: 14 },

  p2pBtn: { backgroundColor: '#4c1d95', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16 },
  p2pBtnText: { color: '#c4b5fd', fontSize: 14, fontWeight: '600' },

  meshBtn: { backgroundColor: '#065f46', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  meshBtnText: { color: '#6ee7b7', fontSize: 14, fontWeight: '600' },

  qrPairBtn: { backgroundColor: '#713f12', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  qrPairBtnText: { color: '#fbbf24', fontSize: 14, fontWeight: '600' },

  routeBtn: { backgroundColor: '#1e3a5f', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  routeBtnText: { color: '#93c5fd', fontSize: 14, fontWeight: '600' },

  deliveryBtn: { backgroundColor: '#78350f', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  deliveryBtnText: { color: '#fbbf24', fontSize: 14, fontWeight: '600' },

  logoutBtn: { backgroundColor: '#7f1d1d', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  logoutText: { color: '#fca5a5', fontSize: 14, fontWeight: '600' },

  resetBtn: { backgroundColor: '#451a03', borderWidth: 1, borderColor: '#92400e', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 30 },
  resetText: { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
});
