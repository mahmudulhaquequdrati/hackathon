const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/rbac');

// M4: Route Engine — graph read is open, compute/modify requires permissions

// GET /api/v1/routes/graph — any authenticated user can read the graph
router.get('/graph', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M4' });
});

// POST /api/v1/routes/find-path — requires 'routes' execute permission
router.post('/find-path', requirePermission('routes', 'execute'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M4' });
});

// PATCH /api/v1/routes/edges/:id/status — commander, dispatcher, field_agent can report
router.patch('/edges/:id/status', requireRole('commander', 'dispatcher', 'field_agent'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M4' });
});

module.exports = router;
