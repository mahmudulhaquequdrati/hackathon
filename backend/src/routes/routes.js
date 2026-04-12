const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/rbac');
const routeService = require('../services/route-service');

// M4.1: GET /api/v1/routes/graph — full graph (nodes + edges)
router.get('/graph', requireAuth, (req, res) => {
  try {
    const graph = routeService.loadGraph();
    res.json({ data: graph });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// M4.2 + M4.3: POST /api/v1/routes/find-path — shortest path with vehicle constraints
router.post('/find-path', requirePermission('routes', 'execute'), (req, res) => {
  try {
    const { source, target, vehicle_type, payload_weight_kg } = req.body;
    if (!source || !target || !vehicle_type) {
      return res.status(400).json({ error: 'source, target, and vehicle_type are required' });
    }
    if (!routeService.VEHICLE_EDGE_MAP[vehicle_type]) {
      return res.status(400).json({ error: `Invalid vehicle_type: ${vehicle_type}. Must be one of: ${Object.keys(routeService.VEHICLE_EDGE_MAP).join(', ')}` });
    }

    const result = routeService.findPath(source, target, vehicle_type, payload_weight_kg);

    if (!result.found) {
      return res.json({ data: result });
    }
    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// M4.2: PATCH /api/v1/routes/edges/:id/status — mark edge failed, trigger reroute
router.patch('/edges/:id/status', requireRole('commander', 'dispatcher', 'field_agent'), (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    const validStatuses = ['open', 'degraded', 'closed', 'washed_out'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}` });
    }

    const result = routeService.updateEdgeStatus(req.params.id, status, req.broadcast);
    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
