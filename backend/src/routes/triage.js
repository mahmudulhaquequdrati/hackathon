const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/rbac');

// M6: Triage Engine — priority evaluation requires elevated access

// GET /api/v1/triage/priorities — any authenticated user can view priorities
router.get('/priorities', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M6' });
});

// POST /api/v1/triage/evaluate — requires 'triage' write permission
router.post('/evaluate', requirePermission('triage', 'write'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M6' });
});

// POST /api/v1/triage/preempt — commander and dispatcher only
router.post('/preempt', requireRole('commander', 'dispatcher'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M6' });
});

module.exports = router;
