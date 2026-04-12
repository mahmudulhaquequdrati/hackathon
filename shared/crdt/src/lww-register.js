/**
 * LWW-Register (Last-Writer-Wins Register)
 * A CRDT where the value with the highest timestamp wins.
 * Ties are broken deterministically by nodeId (lexicographic comparison).
 */

/**
 * @typedef {Object} LWWRegisterState
 * @property {*} value - The stored value
 * @property {number} timestamp - Millisecond timestamp of the write
 * @property {string} nodeId - Device/node that performed the write
 */

/**
 * Create a new LWW-Register
 * @param {*} value
 * @param {string} nodeId
 * @param {number} [timestamp]
 * @returns {LWWRegisterState}
 */
function createRegister(value, nodeId, timestamp) {
  return {
    value,
    timestamp: timestamp || Date.now(),
    nodeId,
  };
}

/**
 * Update an LWW-Register with a new value
 * @param {LWWRegisterState} reg
 * @param {*} value
 * @param {string} nodeId
 * @param {number} [timestamp]
 * @returns {LWWRegisterState}
 */
function updateRegister(reg, value, nodeId, timestamp) {
  const ts = timestamp || Date.now();
  // Only update if new timestamp is >= current (allow same-device overwrites)
  if (ts > reg.timestamp || (ts === reg.timestamp && nodeId >= reg.nodeId)) {
    return { value, timestamp: ts, nodeId };
  }
  return reg;
}

/**
 * Merge two LWW-Registers. The one with the higher timestamp wins.
 * On tie, the higher nodeId (lexicographic) wins.
 * This function is commutative, associative, and idempotent.
 * @param {LWWRegisterState} local
 * @param {LWWRegisterState} remote
 * @returns {LWWRegisterState}
 */
function mergeRegisters(local, remote) {
  if (remote.timestamp > local.timestamp) return remote;
  if (local.timestamp > remote.timestamp) return local;
  // Timestamp tie — deterministic tiebreak by nodeId
  if (remote.nodeId > local.nodeId) return remote;
  return local;
}

module.exports = { createRegister, updateRegister, mergeRegisters };
