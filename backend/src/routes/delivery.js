const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/rbac');
const deliveryService = require('../services/delivery-service');

// GET /api/v1/delivery/ — list deliveries
router.get('/', requireAuth, (req, res) => {
  try {
    const { status, driver_id, limit } = req.query;
    const deliveries = deliveryService.getDeliveries({
      status, driverId: driver_id, limit: limit ? parseInt(limit) : 50,
    });
    res.json({ data: { deliveries, count: deliveries.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/delivery/ — create delivery (auto-routes via M4)
router.post('/', requirePermission('deliveries', 'write'), (req, res) => {
  try {
    const { supply_id, source_node_id, target_node_id, vehicle_type, priority, driver_id } = req.body;
    if (!source_node_id || !target_node_id) {
      return res.status(400).json({ error: 'source_node_id and target_node_id are required' });
    }

    const delivery = deliveryService.createDelivery({
      supplyId: supply_id,
      sourceNodeId: source_node_id,
      targetNodeId: target_node_id,
      vehicleType: vehicle_type,
      priority,
      driverId: driver_id || req.user?.device_id,
    });

    if (req.broadcast) req.broadcast('DELIVERY_CREATED', { delivery });

    res.status(201).json({ data: delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/v1/delivery/:id/status — update delivery status
router.patch('/:id/status', requirePermission('deliveries', 'write'), (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const delivery = deliveryService.updateDeliveryStatus(req.params.id, status);

    if (req.broadcast) req.broadcast('DELIVERY_STATUS_CHANGED', { delivery });

    res.json({ data: delivery });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/v1/delivery/:id/pod — PoD operations (generate challenge or confirm receipt)
router.post('/:id/pod', requirePermission('pod_receipts', 'write'), (req, res) => {
  try {
    const { action } = req.body;

    if (action === 'generate') {
      // M5.1: Generate signed QR challenge
      const { sender_device_id } = req.body;
      if (!sender_device_id) return res.status(400).json({ error: 'sender_device_id is required' });

      const challenge = deliveryService.createPodChallenge(req.params.id, sender_device_id);
      res.json({ data: challenge });

    } else if (action === 'confirm') {
      // M5.1 + M5.2: Verify sender sig, check nonce, countersign, store receipt
      const { pod_payload, sender_signature, receiver_device_id, receiver_signature } = req.body;
      if (!pod_payload || !sender_signature || !receiver_device_id) {
        return res.status(400).json({ error: 'pod_payload, sender_signature, and receiver_device_id are required' });
      }

      const receipt = deliveryService.verifyAndConfirmPod({
        podPayload: pod_payload,
        senderSignature: sender_signature,
        receiverDeviceId: receiver_device_id,
        receiverSignature: receiver_signature,
      });

      if (req.broadcast) req.broadcast('POD_CONFIRMED', { receipt });

      res.json({ data: receipt });

    } else {
      return res.status(400).json({ error: 'action must be "generate" or "confirm"' });
    }
  } catch (err) {
    const status = err.code === 'NONCE_REUSED' || err.code === 'EXPIRED' || err.code === 'SIGNATURE_INVALID' ? 400 : 500;
    res.status(status).json({ error: err.message, code: err.code || 'UNKNOWN' });
  }
});

// GET /api/v1/delivery/:id/chain — chain of custody (M5.3)
router.get('/:id/chain', requireAuth, (req, res) => {
  try {
    const chain = deliveryService.getDeliveryChain(req.params.id);
    res.json({ data: chain });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
