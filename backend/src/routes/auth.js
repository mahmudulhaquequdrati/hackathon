const express = require('express');
const router = express.Router();
const authService = require('../services/auth-service');
const { requireAuth, requireRole } = require('../middleware/rbac');

// ──────────────────────────────────────
// M1.2: Ed25519 Key Pair Endpoints
// ──────────────────────────────────────

// Generate a fresh Ed25519 keypair (for demo/testing)
router.get('/keypair', (req, res) => {
  const keypair = authService.generateKeypair();
  res.json({
    data: keypair,
    note: 'Store secretKey securely on-device. Only send publicKey to the server.',
  });
});

// Register a device with its public key + generate TOTP secret
router.post('/register', (req, res) => {
  const { deviceId, publicKey, boxPublicKey, role, name } = req.body;
  if (!deviceId || !publicKey) {
    return res.status(400).json({ error: 'deviceId and publicKey are required' });
  }

  try {
    authService.registerDevice(deviceId, publicKey, role, name);

    // Store box public key for mesh encryption (M3.3) if provided
    if (boxPublicKey) {
      const { getDb } = require('../db/connection');
      getDb().prepare('UPDATE users SET box_public_key = ? WHERE device_id = ?')
        .run(boxPublicKey, deviceId);
    }

    // Auto-generate TOTP secret on registration
    const totp = authService.generateTotpSecret(deviceId);

    // Re-fetch user to include box_public_key
    const user = authService.getUserByDeviceId(deviceId);

    res.status(201).json({
      data: {
        user,
        totp: {
          secret: totp.secret,
          uri: totp.uri,
          period: totp.period,
          digits: totp.digits,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Register/update box public key for mesh encryption (M3.3)
router.post('/register-box-key', requireAuth, (req, res) => {
  try {
    const { boxPublicKey } = req.body;
    if (!boxPublicKey) {
      return res.status(400).json({ error: 'boxPublicKey is required' });
    }

    const { getDb } = require('../db/connection');
    getDb().prepare('UPDATE users SET box_public_key = ? WHERE device_id = ?')
      .run(boxPublicKey, req.user.deviceId);

    res.json({ data: { deviceId: req.user.deviceId, boxPublicKey, registered: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify a signature against a device's registered public key
router.post('/verify-signature', (req, res) => {
  const { deviceId, message, signature } = req.body;
  if (!deviceId || !message || !signature) {
    return res.status(400).json({ error: 'deviceId, message, and signature are required' });
  }

  const user = authService.getUserByDeviceId(deviceId);
  if (!user || !user.public_key) {
    return res.status(404).json({ error: 'Device not found or no public key registered' });
  }

  const valid = authService.verifySignature(message, signature, user.public_key);
  res.json({ data: { valid, deviceId, message } });
});

// ──────────────────────────────────────
// M1.1: TOTP Endpoints
// ──────────────────────────────────────

// Verify OTP and issue JWT
router.post('/verify-otp', (req, res) => {
  const { deviceId, token } = req.body;
  if (!deviceId || !token) {
    return res.status(400).json({ error: 'deviceId and token are required' });
  }

  try {
    const result = authService.verifyTotp(deviceId, token);
    if (!result.valid) {
      return res.status(401).json({ error: 'Invalid or expired OTP', valid: false });
    }

    // OTP valid — issue JWT
    const user = authService.getUserByDeviceId(deviceId);
    const jwt = authService.issueToken(user);

    // Update last_login
    const { getDb } = require('../db/connection');
    getDb().prepare("UPDATE users SET last_login = datetime('now') WHERE device_id = ?")
      .run(deviceId);

    res.json({
      data: {
        valid: true,
        token: jwt,
        user: {
          id: user.id,
          deviceId: user.device_id,
          name: user.name,
          role: user.role,
          publicKey: user.public_key,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Generate current TOTP code (demo/testing only — in production the client generates this)
router.get('/otp/:deviceId', (req, res) => {
  try {
    const code = authService.generateCurrentTotp(req.params.deviceId);
    const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    res.json({ data: { code, secondsRemaining, period: 30 } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ──────────────────────────────────────
// M1.3: Protected Endpoints
// ──────────────────────────────────────

// Get current user profile — any authenticated user
router.get('/me', requireAuth, (req, res) => {
  const user = authService.getUserByDeviceId(req.user.deviceId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    data: {
      id: user.id,
      deviceId: user.device_id,
      name: user.name,
      role: user.role,
      publicKey: user.public_key,
      createdAt: user.created_at,
      lastLogin: user.last_login,
    },
  });
});

// ──────────────────────────────────────
// M1.4: Audit Trail (Hash-Chained)
// ──────────────────────────────────────
const auditService = require('../services/audit-service');

// Get audit log entries — commander + dispatcher only
router.get('/audit', requireRole('commander', 'dispatcher'), (req, res) => {
  const { userId, resource, limit, offset } = req.query;
  const logs = auditService.getLogs({
    userId,
    resource,
    limit: limit ? parseInt(limit) : 50,
    offset: offset ? parseInt(offset) : 0,
  });
  res.json({ data: logs, count: logs.length });
});

// Verify the audit chain integrity — commander only
router.get('/audit/verify', requireRole('commander'), (req, res) => {
  const result = auditService.verifyChain();
  res.json({ data: result });
});

// M2.3: Log conflict resolution decisions to audit trail
router.post('/audit/log', requireAuth, (req, res) => {
  try {
    const { action, resource, payload } = req.body;
    if (!action || !resource) {
      return res.status(400).json({ error: 'Required: action, resource' });
    }
    const userId = req.user?.id || req.body.payload?.deviceId || null;
    const result = auditService.appendLog(userId, action, resource, payload);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
