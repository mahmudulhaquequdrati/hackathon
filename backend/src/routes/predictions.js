const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/rbac');
const predictionService = require('../services/prediction-service');

// M7.1: POST /api/v1/predictions/ingest-rainfall — ingest sensor data
router.post('/ingest-rainfall', requireRole('commander', 'dispatcher'), (req, res) => {
  try {
    const { records } = req.body;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array required: [{ edge_id, rainfall_mm, timestamp? }]' });
    }

    const result = predictionService.ingestRainfall(records);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M7.2: GET /api/v1/predictions/risk-map — risk predictions for all edges
router.get('/risk-map', requireAuth, (req, res) => {
  try {
    const riskMap = predictionService.getRiskMap();
    res.json({ data: riskMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M7.2: GET /api/v1/predictions/edge-risk/:edgeId — single edge prediction
router.get('/edge-risk/:edgeId', requireAuth, (req, res) => {
  try {
    const result = predictionService.getEdgeRisk(req.params.edgeId);
    if (!result) {
      return res.status(404).json({ error: 'Edge not found' });
    }
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M7.2: GET /api/v1/predictions/metrics — model performance metrics
router.get('/metrics', requireAuth, (req, res) => {
  try {
    const { evaluateModel } = require('../services/classifier');
    res.json({ data: evaluateModel() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
