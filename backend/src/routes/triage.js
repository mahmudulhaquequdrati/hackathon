const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/rbac');
const triageService = require('../services/triage-service');

// M6.1: GET /api/v1/triage/priorities — any authenticated user can view
router.get('/priorities', requireAuth, (req, res) => {
  try {
    const data = triageService.getPriorities();
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M6.2: POST /api/v1/triage/evaluate — requires 'triage' write permission
router.post('/evaluate', requirePermission('triage', 'write'), (req, res) => {
  try {
    const result = triageService.evaluateDeliveries(req.broadcast);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M6.3: POST /api/v1/triage/preempt — commander and dispatcher only
router.post('/preempt', requireRole('commander', 'dispatcher'), (req, res) => {
  try {
    const { delivery_id } = req.body;
    if (!delivery_id) {
      return res.status(400).json({ error: 'delivery_id required' });
    }
    const decision = triageService.executePreemption(delivery_id, req.broadcast);
    res.json({ data: decision });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/triage/decisions — view past preemption decisions
router.get('/decisions', requireAuth, (req, res) => {
  try {
    const decisions = triageService.getDecisions({ limit: parseInt(req.query.limit) || 50 });
    res.json({ data: { decisions } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
