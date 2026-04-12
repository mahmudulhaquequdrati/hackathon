const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission, requireRole } = require('../middleware/rbac');

// M8: Drone Handoff & Fleet Management

// GET /api/v1/fleet/vehicles — any authenticated user
router.get('/vehicles', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M8' });
});

// POST /api/v1/fleet/dispatch — requires 'fleet' execute permission
router.post('/dispatch', requirePermission('fleet', 'execute'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M8' });
});

// GET /api/v1/fleet/reachability — any authenticated user
router.get('/reachability', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M8' });
});

// POST /api/v1/fleet/rendezvous — commander and drone_pilot only
router.post('/rendezvous', requireRole('commander', 'drone_pilot'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M8' });
});

module.exports = router;
