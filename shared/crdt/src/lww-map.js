/**
 * LWW-Map: a map of field names to LWW-Registers.
 * Represents a full CRDT-wrapped record (e.g., a supply item).
 * Each mutable field is independently tracked with its own timestamp.
 *
 * M2.2: Each state carries a vector clock for causal ordering,
 * plus a causal history log to prove ordering relationships.
 */

const { createRegister, updateRegister, mergeRegisters } = require('./lww-register');
const VC = require('./vector-clock');

/**
 * @typedef {Object} CausalEntry
 * @property {string} nodeId - Device that performed the mutation
 * @property {Object<string, number>} clock - Vector clock at time of mutation
 * @property {number} timestamp - Wall-clock timestamp
 * @property {string[]} fieldsChanged - Which fields were modified
 */

/**
 * @typedef {Object} CrdtSupplyState
 * @property {string} id - Record ID
 * @property {Object<string, import('./lww-register').LWWRegisterState>} fields - Field name to LWW-Register
 * @property {boolean} tombstoned - Soft-delete flag
 * @property {number} version - Monotonic local version for change detection
 * @property {Object<string, number>} vectorClock - Current vector clock for this record
 * @property {CausalEntry[]} causalHistory - Ordered log of mutations with their clocks
 */

/**
 * Create a new CRDT map from a plain object
 * @param {string} id - Record ID
 * @param {Object} fields - Plain key-value pairs to wrap
 * @param {string} nodeId - Device that created this
 * @param {number} [timestamp]
 * @param {Object<string, number>} [clock] - Initial vector clock (optional)
 * @returns {CrdtSupplyState}
 */
function createMap(id, fields, nodeId, timestamp, clock) {
  const ts = timestamp || Date.now();
  const crdtFields = {};
  const fieldNames = [];
  for (const [key, value] of Object.entries(fields)) {
    // Skip metadata fields
    if (key === 'id' || key === 'crdtState' || key === 'crdt_state') continue;
    crdtFields[key] = createRegister(value, nodeId, ts);
    fieldNames.push(key);
  }
  const initClock = clock ? VC.increment(clock, nodeId) : VC.increment(VC.create(), nodeId);
  return {
    id,
    fields: crdtFields,
    tombstoned: false,
    version: 1,
    vectorClock: initClock,
    causalHistory: [{
      nodeId,
      clock: initClock,
      timestamp: ts,
      fieldsChanged: fieldNames,
    }],
  };
}

/**
 * Update a single field in the CRDT map.
 * M2.2: Increments the vector clock and appends to causal history.
 * @param {CrdtSupplyState} state
 * @param {string} field
 * @param {*} value
 * @param {string} nodeId
 * @param {number} [timestamp]
 * @returns {CrdtSupplyState}
 */
function updateField(state, field, value, nodeId, timestamp) {
  const ts = timestamp || Date.now();
  const existing = state.fields[field];
  const updated = existing
    ? updateRegister(existing, value, nodeId, ts)
    : createRegister(value, nodeId, ts);

  const newClock = VC.increment(state.vectorClock || VC.create(), nodeId);
  const entry = { nodeId, clock: newClock, timestamp: ts, fieldsChanged: [field] };

  return {
    ...state,
    fields: { ...state.fields, [field]: updated },
    version: state.version + 1,
    vectorClock: newClock,
    causalHistory: [...(state.causalHistory || []), entry],
  };
}

/**
 * Update multiple fields at once (single causal event).
 * M2.2: One vector clock increment for the batch, one causal history entry.
 * @param {CrdtSupplyState} state
 * @param {Object} updates - Key-value pairs to update
 * @param {string} nodeId
 * @param {number} [timestamp]
 * @returns {CrdtSupplyState}
 */
function updateFields(state, updates, nodeId, timestamp) {
  const ts = timestamp || Date.now();
  const newFields = { ...state.fields };
  const changedFields = [];

  for (const [field, value] of Object.entries(updates)) {
    if (field === 'id' || field === 'crdtState' || field === 'crdt_state') continue;
    const existing = newFields[field];
    newFields[field] = existing
      ? updateRegister(existing, value, nodeId, ts)
      : createRegister(value, nodeId, ts);
    changedFields.push(field);
  }

  const newClock = VC.increment(state.vectorClock || VC.create(), nodeId);
  const entry = { nodeId, clock: newClock, timestamp: ts, fieldsChanged: changedFields };

  return {
    ...state,
    fields: newFields,
    version: state.version + 1,
    vectorClock: newClock,
    causalHistory: [...(state.causalHistory || []), entry],
  };
}

/**
 * Merge two CRDT maps. For each field, merges the LWW-Registers.
 * Returns the merged state and a list of conflicts (fields where remote won).
 * This is commutative, associative, and idempotent.
 * @param {CrdtSupplyState} local
 * @param {CrdtSupplyState} remote
 * @returns {{ merged: CrdtSupplyState, conflicts: Array<{ field: string, localValue: *, remoteValue: *, winner: string }> }}
 */
function mergeMaps(local, remote) {
  const allKeys = new Set([
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);

  const mergedFields = {};
  const conflicts = [];

  for (const key of allKeys) {
    const localReg = local.fields[key];
    const remoteReg = remote.fields[key];

    if (localReg && remoteReg) {
      const merged = mergeRegisters(localReg, remoteReg);
      mergedFields[key] = merged;

      // Track if remote won and values actually differ
      if (merged === remoteReg && localReg.value !== remoteReg.value) {
        conflicts.push({
          field: key,
          localValue: localReg.value,
          remoteValue: remoteReg.value,
          winner: 'remote',
        });
      } else if (merged === localReg && localReg.value !== remoteReg.value) {
        conflicts.push({
          field: key,
          localValue: localReg.value,
          remoteValue: remoteReg.value,
          winner: 'local',
        });
      }
    } else {
      // Only one side has the field — take whichever exists
      mergedFields[key] = localReg || remoteReg;
    }
  }

  // Tombstone: treat as an LWW flag — if either is tombstoned with a later write, it stays
  const tombstoned = local.tombstoned || remote.tombstoned;

  // M2.2: Merge vector clocks
  const mergedClock = VC.merge(
    local.vectorClock || VC.create(),
    remote.vectorClock || VC.create()
  );

  // M2.2: Merge causal histories (union, deduplicate by clock identity, sort by timestamp)
  const localHistory = local.causalHistory || [];
  const remoteHistory = remote.causalHistory || [];
  const seen = new Set();
  const mergedHistory = [];
  for (const entry of [...localHistory, ...remoteHistory]) {
    const key = `${entry.nodeId}:${JSON.stringify(entry.clock)}`;
    if (!seen.has(key)) {
      seen.add(key);
      mergedHistory.push(entry);
    }
  }
  mergedHistory.sort((a, b) => a.timestamp - b.timestamp);

  // M2.2: Determine causal relationship between the two states
  const causalRelation = VC.compare(
    local.vectorClock || VC.create(),
    remote.vectorClock || VC.create()
  );

  return {
    merged: {
      id: local.id,
      fields: mergedFields,
      tombstoned,
      version: Math.max(local.version, remote.version) + 1,
      vectorClock: mergedClock,
      causalHistory: mergedHistory,
    },
    conflicts,
    causalRelation, // 'before' | 'after' | 'concurrent' | 'equal'
  };
}

/**
 * Materialize a CRDT map into a plain object (extract current values)
 * @param {CrdtSupplyState} state
 * @returns {Object}
 */
function materialize(state) {
  const result = { id: state.id };
  for (const [key, reg] of Object.entries(state.fields)) {
    result[key] = reg.value;
  }
  return result;
}

module.exports = { createMap, updateField, updateFields, mergeMaps, materialize };
