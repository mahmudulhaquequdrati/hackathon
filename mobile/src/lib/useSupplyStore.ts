import { create } from 'zustand';
import type { Priority, SupplyCategory } from '../types';
import { useAuthStore } from './useAuthStore';
import { api } from './api';
import { log } from './debug';
import * as db from './database';
import {
  createMap,
  updateFields,
  updateField as crdtUpdateField,
  mergeMaps,
  materialize,
  VC,
  type CrdtSupplyState,
  type VectorClock,
  type ConflictEntry,
} from './crdt';

export interface Supply {
  id: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  unit: string;
  priority: Priority;
  nodeId: string | null;
}

/** A pending conflict that needs user resolution */
export interface PendingConflict {
  supplyId: string;
  supplyName: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  winner: 'local' | 'remote';
  autoResolved: boolean;
}

interface SupplyState {
  supplies: Supply[];
  pendingCount: number;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastSyncAt: string | null;
  conflicts: ConflictEntry[];
  pendingConflicts: PendingConflict[];

  // Actions
  loadSupplies: () => Promise<void>;
  createSupply: (supply: Omit<Supply, 'id'>) => Promise<void>;
  updateSupply: (id: string, updates: Partial<Supply>) => Promise<void>;
  syncWithServer: () => Promise<void>;
  resolveConflict: (supplyId: string, field: string, chosenValue: unknown, choice: 'local' | 'remote') => Promise<void>;
  dismissConflicts: () => void;
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function rowToSupply(row: db.SupplyRow): Supply {
  return {
    id: row.id,
    name: row.name,
    category: row.category as SupplyCategory,
    quantity: row.quantity,
    unit: row.unit,
    priority: row.priority as Priority,
    nodeId: row.node_id,
  };
}

export const useSupplyStore = create<SupplyState>((set, get) => ({
  supplies: [],
  pendingCount: 0,
  syncStatus: 'idle',
  lastSyncAt: null,
  conflicts: [],
  pendingConflicts: [],

  loadSupplies: async () => {
    try {
      const rows = await db.getAllSupplies();
      const supplies = rows.map(rowToSupply);
      const unsynced = rows.filter((r) => r.synced === 0 && r.crdt_state).length;
      set({ supplies, pendingCount: unsynced });
      log('info', 'Supplies loaded from local DB', `count=${supplies.length}`);
    } catch (err) {
      log('error', 'Failed to load supplies', (err as Error).message);
    }
  },

  createSupply: async (supply) => {
    const deviceId = useAuthStore.getState().deviceId;
    if (!deviceId) {
      log('error', 'Cannot create supply: no deviceId');
      return;
    }

    const id = generateId();
    const crdtState = createMap(id, { ...supply }, deviceId);
    const serialized = JSON.stringify(crdtState);

    await db.upsertSupply(id, { ...supply }, serialized, false);

    // Update vector clock
    let clock = await db.getVectorClock();
    clock = VC.increment(clock, deviceId);
    await db.saveVectorClock(clock);

    // Update store
    const newSupply: Supply = { id, ...supply };
    set((state) => ({
      supplies: [newSupply, ...state.supplies],
      pendingCount: state.pendingCount + 1,
    }));
    log('info', 'Supply created (offline)', `id=${id}, name=${supply.name}`);
  },

  updateSupply: async (id, updates) => {
    const deviceId = useAuthStore.getState().deviceId;
    if (!deviceId) return;

    // Load current CRDT state from DB
    const row = await db.getSupplyById(id);
    if (!row) {
      log('error', 'Supply not found for update', id);
      return;
    }

    let crdtState: CrdtSupplyState;
    if (row.crdt_state) {
      crdtState = JSON.parse(row.crdt_state);
    } else {
      // Initialize CRDT from existing plain data
      crdtState = createMap(id, {
        name: row.name,
        category: row.category,
        quantity: row.quantity,
        unit: row.unit,
        priority: row.priority,
        nodeId: row.node_id,
      }, deviceId);
    }

    // Apply updates through CRDT
    crdtState = updateFields(crdtState, updates, deviceId);
    const plain = materialize(crdtState);
    const serialized = JSON.stringify(crdtState);

    await db.upsertSupply(id, plain, serialized, false);

    // Update vector clock
    let clock = await db.getVectorClock();
    clock = VC.increment(clock, deviceId);
    await db.saveVectorClock(clock);

    // Update store
    set((state) => ({
      supplies: state.supplies.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      ),
      pendingCount: state.pendingCount + (row.synced === 1 ? 1 : 0),
    }));
    log('info', 'Supply updated (CRDT)', `id=${id}, fields=${Object.keys(updates).join(',')}`);
  },

  syncWithServer: async () => {
    const deviceId = useAuthStore.getState().deviceId;
    if (!deviceId) return;

    set({ syncStatus: 'syncing' });
    log('info', 'Starting sync...');

    try {
      // Phase 1: Push local changes
      const unsyncedRows = await db.getUnsyncedSupplies();
      const localClock = await db.getVectorClock();

      if (unsyncedRows.length > 0) {
        const changes = unsyncedRows.map((row) => ({
          id: row.id,
          crdtState: row.crdt_state!,
        }));

        const pushResult = await api.post<{
          data: { results: Array<{ id: string; merged: boolean }>; serverClock: VectorClock };
        }>('/sync/push', { deviceId, vectorClock: localClock, changes });

        const pushedIds = pushResult.data.results.map((r) => r.id);
        await db.markSynced(pushedIds);
        log('info', `Pushed ${pushedIds.length} changes`);
      }

      // Phase 2: Pull remote changes
      const pullResult = await api.post<{
        data: { changes: Array<{ id: string; crdtState: string }>; serverClock: VectorClock; count: number };
      }>('/sync/pull', { deviceId, vectorClock: localClock });

      const allConflicts: ConflictEntry[] = [];
      const allPendingConflicts: PendingConflict[] = [];

      for (const change of pullResult.data.changes) {
        const remoteCrdt: CrdtSupplyState =
          typeof change.crdtState === 'string'
            ? JSON.parse(change.crdtState)
            : change.crdtState;

        const existingRow = await db.getSupplyById(change.id);

        if (existingRow && existingRow.crdt_state) {
          // Merge local and remote
          const localCrdt: CrdtSupplyState = JSON.parse(existingRow.crdt_state);
          const { merged, conflicts, causalRelation } = mergeMaps(localCrdt, remoteCrdt);
          const plain = materialize(merged);
          await db.upsertSupply(change.id, plain, JSON.stringify(merged), true);

          if (conflicts.length > 0) {
            allConflicts.push(...conflicts);
            // Surface as pending conflicts for UI when concurrent (genuine conflicts)
            for (const c of conflicts) {
              allPendingConflicts.push({
                supplyId: change.id,
                supplyName: (plain.name as string) || existingRow.name || 'Unknown',
                field: c.field,
                localValue: c.localValue,
                remoteValue: c.remoteValue,
                winner: c.winner,
                autoResolved: causalRelation !== 'concurrent', // only true conflicts are concurrent
              });
            }
          }
        } else {
          // No local state — take remote as-is
          const plain = materialize(remoteCrdt);
          await db.upsertSupply(change.id, plain, JSON.stringify(remoteCrdt), true);
        }
      }

      // Save merged server clock
      const serverClock = pullResult.data.serverClock;
      const mergedClock = VC.merge(localClock, serverClock);
      await db.saveVectorClock(mergedClock);

      // Reload from DB
      await get().loadSupplies();

      set({
        syncStatus: 'synced',
        lastSyncAt: new Date().toISOString(),
        conflicts: allConflicts,
        pendingConflicts: allPendingConflicts.filter((c) => !c.autoResolved),
      });
      log('info', `Sync complete. Pulled ${pullResult.data.count} items, ${allConflicts.length} conflicts (${allPendingConflicts.filter(c => !c.autoResolved).length} need resolution)`);
    } catch (err) {
      set({ syncStatus: 'error' });
      log('error', 'Sync failed', (err as Error).message);
    }
  },

  resolveConflict: async (supplyId, field, chosenValue, choice) => {
    const deviceId = useAuthStore.getState().deviceId;
    if (!deviceId) return;

    // Apply the user's chosen value as a new CRDT write
    const row = await db.getSupplyById(supplyId);
    if (!row || !row.crdt_state) return;

    let crdtState: CrdtSupplyState = JSON.parse(row.crdt_state);
    crdtState = crdtUpdateField(crdtState, field, chosenValue, deviceId);
    const plain = materialize(crdtState);
    await db.upsertSupply(supplyId, plain, JSON.stringify(crdtState), false);

    // Update vector clock
    let clock = await db.getVectorClock();
    clock = VC.increment(clock, deviceId);
    await db.saveVectorClock(clock);

    // Log resolution to audit trail on server (best-effort)
    try {
      await api.post('/auth/audit/log', {
        action: 'CONFLICT_RESOLVED',
        resource: 'supply',
        payload: {
          supplyId,
          field,
          choice,
          chosenValue,
          deviceId,
          resolvedAt: new Date().toISOString(),
        },
      });
    } catch {
      // Offline — resolution will sync later via CRDT
      log('info', 'Audit log offline, resolution saved in CRDT');
    }

    // Remove this conflict from pending list
    set((state) => ({
      pendingConflicts: state.pendingConflicts.filter(
        (c) => !(c.supplyId === supplyId && c.field === field),
      ),
      supplies: state.supplies.map((s) =>
        s.id === supplyId ? { ...s, [field]: chosenValue } : s,
      ),
      pendingCount: state.pendingCount + 1,
    }));
    log('info', `Conflict resolved: ${field} → ${choice} (${chosenValue})`);
  },

  dismissConflicts: () => {
    set({ pendingConflicts: [] });
  },
}));
