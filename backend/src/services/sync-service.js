const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const { createMap, updateFields, mergeMaps, materialize, VectorClock } = require('../../../shared/crdt/src/index');

/**
 * Get the server's current vector clock for a given device
 */
function getDeviceSyncState(deviceId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sync_state WHERE node_id = ?').get(deviceId);
  if (!row) return null;
  return {
    id: row.id,
    nodeId: row.node_id,
    vectorClock: JSON.parse(row.vector_clock),
    lastSync: row.last_sync,
    syncType: row.sync_type,
  };
}

/**
 * Get the server's aggregate vector clock (merged from all devices)
 */
function getServerClock() {
  const db = getDb();
  const rows = db.prepare('SELECT vector_clock FROM sync_state').all();
  let merged = VectorClock.create();
  for (const row of rows) {
    merged = VectorClock.merge(merged, JSON.parse(row.vector_clock));
  }
  return merged;
}

/**
 * Upsert a device's sync state (vector clock + last sync time)
 */
function upsertSyncState(deviceId, vectorClock) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sync_state WHERE node_id = ?').get(deviceId);
  if (existing) {
    db.prepare(
      "UPDATE sync_state SET vector_clock = ?, last_sync = datetime('now') WHERE node_id = ?"
    ).run(JSON.stringify(vectorClock), deviceId);
  } else {
    db.prepare(
      "INSERT INTO sync_state (id, node_id, vector_clock, sync_type) VALUES (?, ?, ?, 'delta')"
    ).run(uuidv4(), deviceId, JSON.stringify(vectorClock));
  }
}

/**
 * Push changes from a device. Merges each supply's CRDT state with the server's copy.
 * Returns the list of merged supply IDs and the updated server clock.
 */
function pushChanges(deviceId, clientClock, changes) {
  const db = getDb();
  const results = [];

  const insertSupply = db.prepare(`
    INSERT INTO supplies (id, name, category, quantity, unit, priority, node_id, crdt_state, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateSupply = db.prepare(`
    UPDATE supplies SET name = ?, category = ?, quantity = ?, unit = ?, priority = ?, node_id = ?, crdt_state = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const pushTx = db.transaction(() => {
    for (const change of changes) {
      const { id, crdtState } = change;
      const remoteCrdt = typeof crdtState === 'string' ? JSON.parse(crdtState) : crdtState;

      // Load server's current state for this supply
      const row = db.prepare('SELECT * FROM supplies WHERE id = ?').get(id);

      let mergedCrdt;
      if (row && row.crdt_state) {
        // Merge with existing server state
        const serverCrdt = JSON.parse(row.crdt_state);
        const { merged } = mergeMaps(serverCrdt, remoteCrdt);
        mergedCrdt = merged;
      } else if (row) {
        // Row exists but no CRDT state yet — initialize from remote
        mergedCrdt = remoteCrdt;
      } else {
        // New supply — take remote state as-is
        mergedCrdt = remoteCrdt;
      }

      // Materialize to update denormalized columns
      const plain = materialize(mergedCrdt);
      const serialized = JSON.stringify(mergedCrdt);

      if (row) {
        updateSupply.run(
          plain.name || row.name,
          plain.category || row.category,
          plain.quantity != null ? plain.quantity : row.quantity,
          plain.unit || row.unit,
          plain.priority || row.priority,
          plain.nodeId || plain.node_id || row.node_id,
          serialized,
          id
        );
      } else {
        insertSupply.run(
          id,
          plain.name || 'Unknown',
          plain.category || 'equipment',
          plain.quantity || 0,
          plain.unit || 'units',
          plain.priority || 'P2',
          plain.nodeId || plain.node_id || null,
          serialized
        );
      }

      results.push({ id, merged: true });
    }

    // Update the device's vector clock on the server
    const existingState = getDeviceSyncState(deviceId);
    const serverClock = existingState ? existingState.vectorClock : VectorClock.create();
    const mergedClock = VectorClock.merge(serverClock, clientClock);
    upsertSyncState(deviceId, mergedClock);

    return mergedClock;
  });

  const finalClock = pushTx();
  return { results, serverClock: finalClock };
}

/**
 * Pull changes for a device. M2.2: Delta-sync — only return records whose
 * vector clock is concurrent with or after the client's known clock.
 * Falls back to full sync if client has no clock.
 */
function pullChanges(deviceId, clientClock) {
  const db = getDb();

  const rows = db.prepare(
    'SELECT id, crdt_state FROM supplies WHERE crdt_state IS NOT NULL'
  ).all();

  const hasClientClock = clientClock && Object.keys(clientClock).length > 0;
  const changes = [];

  for (const row of rows) {
    if (!row.crdt_state) continue;
    const crdt = JSON.parse(row.crdt_state);

    if (!hasClientClock) {
      // Full sync — client has no clock, send everything
      changes.push({ id: row.id, crdtState: row.crdt_state });
    } else {
      // Delta-sync: only send if the record's vector clock is concurrent or after client's
      const recordClock = crdt.vectorClock || {};
      const relation = VectorClock.compare(recordClock, clientClock);
      if (relation === 'after' || relation === 'concurrent') {
        changes.push({
          id: row.id,
          crdtState: row.crdt_state,
          causalRelation: relation,
        });
      }
    }
  }

  // Update last sync time for this device
  upsertSyncState(deviceId, clientClock || VectorClock.create());

  return {
    changes,
    serverClock: getServerClock(),
    deltaSync: hasClientClock,
  };
}

/**
 * Get all supplies (materialized from CRDT state where available)
 */
function getAllSupplies() {
  const db = getDb();
  return db.prepare('SELECT * FROM supplies').all();
}

module.exports = {
  getDeviceSyncState,
  getServerClock,
  upsertSyncState,
  pushChanges,
  pullChanges,
  getAllSupplies,
};
