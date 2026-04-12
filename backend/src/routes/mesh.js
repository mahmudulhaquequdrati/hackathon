const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/rbac');

// M3: Mesh Network — all mesh operations require authentication

// POST /api/v1/mesh/send — any authenticated user can send messages
router.post('/send', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M3' });
});

// GET /api/v1/mesh/inbox/:deviceId — any authenticated user can check inbox
router.get('/inbox/:deviceId', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M3' });
});

// POST /api/v1/mesh/relay — any authenticated user can relay
router.post('/relay', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M3' });
});

module.exports = router;
