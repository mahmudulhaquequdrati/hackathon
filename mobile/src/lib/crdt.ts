/**
 * CRDT library for mobile.
 * Pure TypeScript — LWW-Register, LWW-Map with M2.2 vector clocks + causal history.
 * Identical semantics to shared/crdt/.
 */

// ─── Vector Clock ──────────────────────────────────────────────────────────

export type VectorClock = Record<string, number>;

export const VC = {
  create: (): VectorClock => ({}),

  increment: (clock: VectorClock, nodeId: string): VectorClock => ({
    ...clock,
    [nodeId]: (clock[nodeId] || 0) + 1,
  }),

  merge: (a: VectorClock, b: VectorClock): VectorClock => {
    const result = { ...a };
    for (const [nodeId, count] of Object.entries(b)) {
      result[nodeId] = Math.max(result[nodeId] || 0, count);
    }
    return result;
  },

  compare: (a: VectorClock, b: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' => {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let aGreater = false;
    let bGreater = false;
    for (const key of allKeys) {
      const aVal = a[key] || 0;
      const bVal = b[key] || 0;
      if (aVal > bVal) aGreater = true;
      if (bVal > aVal) bGreater = true;
    }
    if (aGreater && bGreater) return 'concurrent';
    if (aGreater) return 'after';
    if (bGreater) return 'before';
    return 'equal';
  },
};

// ─── LWW-Register ──────────────────────────────────────────────────────────

export interface LWWRegisterState<T = unknown> {
  value: T;
  timestamp: number;
  nodeId: string;
}

export function createRegister<T>(value: T, nodeId: string, timestamp?: number): LWWRegisterState<T> {
  return { value, timestamp: timestamp || Date.now(), nodeId };
}

export function updateRegister<T>(
  reg: LWWRegisterState<T>,
  value: T,
  nodeId: string,
  timestamp?: number,
): LWWRegisterState<T> {
  const ts = timestamp || Date.now();
  if (ts > reg.timestamp || (ts === reg.timestamp && nodeId >= reg.nodeId)) {
    return { value, timestamp: ts, nodeId };
  }
  return reg;
}

export function mergeRegisters<T>(
  local: LWWRegisterState<T>,
  remote: LWWRegisterState<T>,
): LWWRegisterState<T> {
  if (remote.timestamp > local.timestamp) return remote;
  if (local.timestamp > remote.timestamp) return local;
  if (remote.nodeId > local.nodeId) return remote;
  return local;
}

// ─── Causal History (M2.2) ────────────────────────────────────────────────

export interface CausalEntry {
  nodeId: string;
  clock: VectorClock;
  timestamp: number;
  fieldsChanged: string[];
}

// ─── LWW-Map (CRDT supply state) ──────────────────────────────────────────

export interface CrdtSupplyState {
  id: string;
  fields: Record<string, LWWRegisterState>;
  tombstoned: boolean;
  version: number;
  vectorClock: VectorClock;
  causalHistory: CausalEntry[];
}

export interface ConflictEntry {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  winner: 'local' | 'remote';
}

export function createMap(
  id: string,
  fields: Record<string, unknown>,
  nodeId: string,
  timestamp?: number,
  clock?: VectorClock,
): CrdtSupplyState {
  const ts = timestamp || Date.now();
  const crdtFields: Record<string, LWWRegisterState> = {};
  const fieldNames: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id' || key === 'crdtState' || key === 'crdt_state') continue;
    crdtFields[key] = createRegister(value, nodeId, ts);
    fieldNames.push(key);
  }
  const initClock = VC.increment(clock || VC.create(), nodeId);
  return {
    id,
    fields: crdtFields,
    tombstoned: false,
    version: 1,
    vectorClock: initClock,
    causalHistory: [{ nodeId, clock: initClock, timestamp: ts, fieldsChanged: fieldNames }],
  };
}

export function updateField(
  state: CrdtSupplyState,
  field: string,
  value: unknown,
  nodeId: string,
  timestamp?: number,
): CrdtSupplyState {
  const ts = timestamp || Date.now();
  const existing = state.fields[field];
  const updated = existing
    ? updateRegister(existing, value, nodeId, ts)
    : createRegister(value, nodeId, ts);

  const newClock = VC.increment(state.vectorClock || VC.create(), nodeId);
  const entry: CausalEntry = { nodeId, clock: newClock, timestamp: ts, fieldsChanged: [field] };

  return {
    ...state,
    fields: { ...state.fields, [field]: updated },
    version: state.version + 1,
    vectorClock: newClock,
    causalHistory: [...(state.causalHistory || []), entry],
  };
}

export function updateFields(
  state: CrdtSupplyState,
  updates: Record<string, unknown>,
  nodeId: string,
  timestamp?: number,
): CrdtSupplyState {
  const ts = timestamp || Date.now();
  const newFields = { ...state.fields };
  const changedFields: string[] = [];

  for (const [field, value] of Object.entries(updates)) {
    if (field === 'id' || field === 'crdtState' || field === 'crdt_state') continue;
    const existing = newFields[field];
    newFields[field] = existing
      ? updateRegister(existing, value, nodeId, ts)
      : createRegister(value, nodeId, ts);
    changedFields.push(field);
  }

  const newClock = VC.increment(state.vectorClock || VC.create(), nodeId);
  const entry: CausalEntry = { nodeId, clock: newClock, timestamp: ts, fieldsChanged: changedFields };

  return {
    ...state,
    fields: newFields,
    version: state.version + 1,
    vectorClock: newClock,
    causalHistory: [...(state.causalHistory || []), entry],
  };
}

export function mergeMaps(
  local: CrdtSupplyState,
  remote: CrdtSupplyState,
): { merged: CrdtSupplyState; conflicts: ConflictEntry[]; causalRelation: string } {
  const allKeys = new Set([
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  const mergedFields: Record<string, LWWRegisterState> = {};
  const conflicts: ConflictEntry[] = [];

  for (const key of allKeys) {
    const localReg = local.fields[key];
    const remoteReg = remote.fields[key];

    if (localReg && remoteReg) {
      const merged = mergeRegisters(localReg, remoteReg);
      mergedFields[key] = merged;

      if (merged === remoteReg && localReg.value !== remoteReg.value) {
        conflicts.push({ field: key, localValue: localReg.value, remoteValue: remoteReg.value, winner: 'remote' });
      } else if (merged === localReg && localReg.value !== remoteReg.value) {
        conflicts.push({ field: key, localValue: localReg.value, remoteValue: remoteReg.value, winner: 'local' });
      }
    } else {
      mergedFields[key] = (localReg || remoteReg)!;
    }
  }

  // M2.2: Merge vector clocks
  const mergedClock = VC.merge(
    local.vectorClock || VC.create(),
    remote.vectorClock || VC.create(),
  );

  // M2.2: Merge causal histories (deduplicate, sort by timestamp)
  const localHistory = local.causalHistory || [];
  const remoteHistory = remote.causalHistory || [];
  const seen = new Set<string>();
  const mergedHistory: CausalEntry[] = [];
  for (const entry of [...localHistory, ...remoteHistory]) {
    const key = `${entry.nodeId}:${JSON.stringify(entry.clock)}`;
    if (!seen.has(key)) {
      seen.add(key);
      mergedHistory.push(entry);
    }
  }
  mergedHistory.sort((a, b) => a.timestamp - b.timestamp);

  const causalRelation = VC.compare(
    local.vectorClock || VC.create(),
    remote.vectorClock || VC.create(),
  );

  return {
    merged: {
      id: local.id,
      fields: mergedFields,
      tombstoned: local.tombstoned || remote.tombstoned,
      version: Math.max(local.version, remote.version) + 1,
      vectorClock: mergedClock,
      causalHistory: mergedHistory,
    },
    conflicts,
    causalRelation,
  };
}

export function materialize(state: CrdtSupplyState): Record<string, unknown> & { id: string } {
  const result: Record<string, unknown> = { id: state.id };
  for (const [key, reg] of Object.entries(state.fields)) {
    result[key] = reg.value;
  }
  return result as Record<string, unknown> & { id: string };
}
