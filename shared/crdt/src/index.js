/**
 * @digital-delta/crdt — Shared CRDT library
 * Pure JS, zero dependencies. Used by backend (require) and mobile (import).
 */

const lwwRegister = require('./lww-register');
const lwwMap = require('./lww-map');
const vectorClock = require('./vector-clock');

module.exports = {
  // LWW-Register
  createRegister: lwwRegister.createRegister,
  updateRegister: lwwRegister.updateRegister,
  mergeRegisters: lwwRegister.mergeRegisters,

  // LWW-Map
  createMap: lwwMap.createMap,
  updateField: lwwMap.updateField,
  updateFields: lwwMap.updateFields,
  mergeMaps: lwwMap.mergeMaps,
  materialize: lwwMap.materialize,

  // Vector Clock
  VectorClock: vectorClock,
};
