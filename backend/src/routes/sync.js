const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/rbac');
const syncService = require('../services/sync-service');

// M2: CRDT Sync — all sync operations require authentication

// GET /api/v1/sync/state — any authenticated user can read sync state
router.get('/state', requireAuth, (req, res) => {
  try {
    const serverClock = syncService.getServerClock();
    const deviceId = req.user?.device_id || req.query.deviceId;
    const deviceState = deviceId ? syncService.getDeviceSyncState(deviceId) : null;

    res.json({
      data: {
        serverClock,
        deviceState,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/sync/push — commander, dispatcher, field_agent can push
// Body: { deviceId, vectorClock, changes: [{ id, crdtState }] }
router.post('/push', requireRole('commander', 'dispatcher', 'field_agent'), (req, res) => {
  try {
    const { deviceId, vectorClock, changes } = req.body;

    if (!deviceId || !vectorClock || !Array.isArray(changes)) {
      return res.status(400).json({
        error: 'Required: deviceId, vectorClock, changes[]',
      });
    }

    const { results, serverClock } = syncService.pushChanges(deviceId, vectorClock, changes);

    // Broadcast sync event to all connected WebSocket clients
    if (req.broadcast) {
      req.broadcast('sync:push', {
        deviceId,
        count: results.length,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      data: {
        results,
        serverClock,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/sync/pull — any authenticated user can pull
// Body: { deviceId, vectorClock }
router.post('/pull', requireAuth, (req, res) => {
  try {
    const { deviceId, vectorClock } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Required: deviceId' });
    }

    const { changes, serverClock, deltaSync } = syncService.pullChanges(
      deviceId,
      vectorClock || {}
    );

    res.json({
      data: {
        changes,
        serverClock,
        count: changes.length,
        deltaSync,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
