const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/rbac');
const meshService = require('../services/mesh-service');

// ── M3.1: Store-and-Forward Message Relay ─────────────────────────────────

// POST /api/v1/mesh/send — Send an encrypted message through the mesh
router.post('/send', requireAuth, (req, res) => {
  try {
    const { targetDeviceId, encryptedPayload, nonce, senderBoxPubKey, ttl } = req.body;
    if (!targetDeviceId || !encryptedPayload) {
      return res.status(400).json({ error: 'targetDeviceId and encryptedPayload are required' });
    }

    const result = meshService.createMessage(
      req.user.deviceId,
      targetDeviceId,
      encryptedPayload,
      nonce || null,
      senderBoxPubKey || null,
      ttl || 3,
    );

    // Broadcast to WebSocket clients so online recipients get notified
    req.broadcast('mesh:new_message', {
      targetDeviceId,
      messageId: result.id,
      sourceDeviceId: req.user.deviceId,
    });

    res.status(201).json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/mesh/inbox/:deviceId — Get pending messages for a device
router.get('/inbox/:deviceId', requireAuth, (req, res) => {
  try {
    const { deviceId } = req.params;

    // Can only read own inbox
    if (req.user.deviceId !== deviceId) {
      return res.status(403).json({ error: 'Can only read your own inbox' });
    }

    // Side-effect: clean up expired messages
    meshService.expireStaleMessages();

    const messages = meshService.getInbox(deviceId);
    res.json({ data: { messages, count: messages.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/mesh/relay — Relay a message to the next hop
router.post('/relay', requireAuth, (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.id) {
      return res.status(400).json({ error: 'message object with id is required' });
    }

    const result = meshService.relayMessage(req.user.deviceId, message);

    if (result.relayed) {
      // Notify target via WebSocket
      req.broadcast('mesh:relayed', {
        messageId: message.id,
        targetDeviceId: message.target_device_id || message.targetDeviceId,
        relayDeviceId: req.user.deviceId,
      });
    }

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/mesh/ack — Acknowledge receipt of messages (bulk)
router.post('/ack', requireAuth, (req, res) => {
  try {
    const { messageIds } = req.body;
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }

    meshService.markDelivered(messageIds);
    res.json({ data: { acknowledged: messageIds.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── M3.3: Peer Discovery & Key Exchange ───────────────────────────────────

// GET /api/v1/mesh/peers — Get all mesh peers with box public keys
router.get('/peers', requireAuth, (req, res) => {
  try {
    const peers = meshService.getPeers();
    res.json({
      data: peers.map(p => ({
        deviceId: p.device_id,
        name: p.name,
        role: p.role,
        boxPublicKey: p.box_public_key,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── M3.2: Dual-Role Node Architecture ────────────────────────────────────

// POST /api/v1/mesh/heartbeat — Report node state (battery, signal, peers)
router.post('/heartbeat', requireAuth, (req, res) => {
  try {
    const { batteryLevel, signalStrength, connectedPeers } = req.body;

    // Get current state before update
    const currentState = meshService.getNodeState(req.user.deviceId);
    const currentRole = currentState ? currentState.role : 'client';

    // Evaluate new role from heuristics
    const newRole = meshService.evaluateRole(
      batteryLevel ?? 0,
      signalStrength ?? 0,
      connectedPeers ?? 0,
    );

    // Update state
    meshService.updateNodeState(
      req.user.deviceId,
      newRole,
      batteryLevel ?? 0,
      signalStrength ?? 0,
      connectedPeers ?? 0,
    );

    // Log role switch if changed
    if (currentRole !== newRole) {
      const reason = newRole === 'relay'
        ? `battery=${batteryLevel}, signal=${signalStrength}, peers=${connectedPeers} — meets relay threshold`
        : `battery=${batteryLevel}, signal=${signalStrength}, peers=${connectedPeers} — below relay threshold`;
      meshService.logRoleSwitch(req.user.deviceId, currentRole, newRole, reason);

      req.broadcast('mesh:role_switch', {
        deviceId: req.user.deviceId,
        fromRole: currentRole,
        toRole: newRole,
        reason,
      });
    }

    res.json({
      data: {
        role: newRole,
        previousRole: currentRole,
        switched: currentRole !== newRole,
        batteryLevel,
        signalStrength,
        connectedPeers,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/mesh/role/:deviceId — Get current mesh role for a device
router.get('/role/:deviceId', requireAuth, (req, res) => {
  try {
    const state = meshService.getNodeState(req.params.deviceId);
    if (!state) {
      return res.json({ data: { role: 'client', since: null } });
    }
    res.json({
      data: {
        role: state.role,
        batteryLevel: state.battery_level,
        signalStrength: state.signal_strength,
        connectedPeers: state.connected_peers,
        since: state.updated_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
