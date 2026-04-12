const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/rbac');

// M7: ML Predictions — read is open, ingestion requires elevated access

// GET /api/v1/predictions/risk-map — any authenticated user
router.get('/risk-map', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M7' });
});

// POST /api/v1/predictions/ingest-rainfall — commander, dispatcher only
router.post('/ingest-rainfall', requireRole('commander', 'dispatcher'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M7' });
});

// GET /api/v1/predictions/edge-risk/:edgeId — any authenticated user
router.get('/edge-risk/:edgeId', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M7' });
});

module.exports = router;
