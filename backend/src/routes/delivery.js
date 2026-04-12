const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/rbac');

// M5: Deliveries & Proof of Delivery

// GET /api/v1/delivery/ — any authenticated user can view deliveries
router.get('/', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M5' });
});

// POST /api/v1/delivery/ — requires 'deliveries' write permission
router.post('/', requirePermission('deliveries', 'write'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M5' });
});

// PATCH /api/v1/delivery/:id/status — requires 'deliveries' write permission
router.patch('/:id/status', requirePermission('deliveries', 'write'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M5' });
});

// POST /api/v1/delivery/:id/pod — requires 'pod_receipts' write permission
router.post('/:id/pod', requirePermission('pod_receipts', 'write'), (req, res) => {
  res.status(501).json({ error: 'Not implemented', module: 'M5' });
});

module.exports = router;
