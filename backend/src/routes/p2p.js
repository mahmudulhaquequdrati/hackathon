const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/rbac');
const { VectorClock, mergeMaps, materialize } = require('../../../shared/crdt/src/index');

/**
 * M2.4: Peer-to-peer sync relay endpoints.
 *
 * These endpoints allow two devices to exchange CRDT delta-sync payloads
 * directly through the server acting as a dumb relay (not merging).
 * The server holds a temporary "mailbox" per device for P2P exchanges.
 */

// In-memory P2P mailboxes: deviceId -> { payload, timestamp }
const mailboxes = new Map();

// POST /api/v1/p2p/offer — Device A posts its delta payload for Device B
router.post('/offer', requireAuth, (req, res) => {
  try {
    const { fromDeviceId, toDeviceId, payload } = req.body;
    if (!fromDeviceId || !toDeviceId || !payload) {
      return res.status(400).json({ error: 'Required: fromDeviceId, toDeviceId, payload' });
    }

    const key = `${fromDeviceId}->${toDeviceId}`;
    mailboxes.set(key, {
      payload,
      timestamp: Date.now(),
      bytesStored: JSON.stringify(payload).length,
    });

    // Clean old mailboxes (> 5 min)
    for (const [k, v] of mailboxes) {
      if (Date.now() - v.timestamp > 300000) mailboxes.delete(k);
    }

    res.json({
      data: {
        stored: true,
        key,
        bytes: mailboxes.get(key).bytesStored,
        timestamp: new Date().toISOString(),
      },
    });

    // Notify via WebSocket
    if (req.broadcast) {
      req.broadcast('p2p:offer', { from: fromDeviceId, to: toDeviceId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/p2p/pickup?fromDeviceId=X&toDeviceId=Y — Device B picks up A's payload
router.get('/pickup', requireAuth, (req, res) => {
  try {
    const { fromDeviceId, toDeviceId } = req.query;
    if (!fromDeviceId || !toDeviceId) {
      return res.status(400).json({ error: 'Required query: fromDeviceId, toDeviceId' });
    }

    const key = `${fromDeviceId}->${toDeviceId}`;
    const entry = mailboxes.get(key);

    if (!entry) {
      return res.json({ data: { available: false } });
    }

    // Deliver and delete
    mailboxes.delete(key);

    res.json({
      data: {
        available: true,
        payload: entry.payload,
        bytes: entry.bytesStored,
        storedAt: new Date(entry.timestamp).toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/p2p/exchange — Direct exchange: send yours, get theirs in one call
// Body: { deviceId, vectorClock, changes[] }
// Returns the server's perspective of what the OTHER devices have that this one doesn't
router.post('/exchange', requireAuth, (req, res) => {
  try {
    const { deviceId, vectorClock, changes } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Required: deviceId' });
    }

    const clientClock = vectorClock || {};
    const bytesIn = JSON.stringify(req.body).length;

    // Store/merge the incoming changes on the server (server acts as relay peer)
    const { getDb } = require('../db/connection');
    const db = getDb();

    for (const change of (changes || [])) {
      const remoteCrdt = typeof change.crdtState === 'string'
        ? JSON.parse(change.crdtState) : change.crdtState;

      const row = db.prepare('SELECT crdt_state FROM supplies WHERE id = ?').get(change.id);
      if (row && row.crdt_state) {
        const serverCrdt = JSON.parse(row.crdt_state);
        const { merged } = mergeMaps(serverCrdt, remoteCrdt);
        const plain = materialize(merged);
        db.prepare(
          "UPDATE supplies SET name=?, category=?, quantity=?, unit=?, priority=?, node_id=?, crdt_state=?, updated_at=datetime('now') WHERE id=?"
        ).run(plain.name, plain.category, plain.quantity, plain.unit, plain.priority, plain.nodeId || plain.node_id, JSON.stringify(merged), change.id);
      } else if (!row) {
        const plain = materialize(remoteCrdt);
        db.prepare(
          "INSERT INTO supplies (id,name,category,quantity,unit,priority,node_id,crdt_state) VALUES (?,?,?,?,?,?,?,?)"
        ).run(change.id, plain.name||'Unknown', plain.category||'equipment', plain.quantity||0, plain.unit||'units', plain.priority||'P2', plain.nodeId||plain.node_id||null, JSON.stringify(remoteCrdt));
      }
    }

    // Now build delta response — what this device hasn't seen
    const rows = db.prepare('SELECT id, crdt_state FROM supplies WHERE crdt_state IS NOT NULL').all();
    const responseChanges = [];
    const hasClientClock = Object.keys(clientClock).length > 0;

    for (const row of rows) {
      if (!row.crdt_state) continue;
      const crdt = JSON.parse(row.crdt_state);
      if (!hasClientClock) {
        responseChanges.push({ id: row.id, crdtState: row.crdt_state });
      } else {
        const relation = VectorClock.compare(crdt.vectorClock || {}, clientClock);
        if (relation === 'after' || relation === 'concurrent') {
          responseChanges.push({ id: row.id, crdtState: row.crdt_state });
        }
      }
    }

    const bytesOut = JSON.stringify(responseChanges).length;

    res.json({
      deviceId: 'server',
      vectorClock: (() => {
        const allClocks = db.prepare('SELECT vector_clock FROM sync_state').all();
        let merged = VectorClock.create();
        for (const r of allClocks) merged = VectorClock.merge(merged, JSON.parse(r.vector_clock));
        return merged;
      })(),
      changes: responseChanges,
      stats: {
        bytesIn,
        bytesOut,
        totalBytes: bytesIn + bytesOut,
        deltaSync: hasClientClock,
        recordsSent: responseChanges.length,
        recordsReceived: (changes || []).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/p2p/state — Return this peer's vector clock (for delta calculation)
router.get('/state', requireAuth, (req, res) => {
  const { getDb } = require('../db/connection');
  const db = getDb();
  const rows = db.prepare('SELECT vector_clock FROM sync_state').all();
  let merged = VectorClock.create();
  for (const r of rows) merged = VectorClock.merge(merged, JSON.parse(r.vector_clock));
  res.json({ vectorClock: merged });
});

module.exports = router;
