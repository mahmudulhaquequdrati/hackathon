const nacl = require('tweetnacl');
const { encodeBase64, decodeBase64 } = require('tweetnacl-util');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { TOTP, HOTP, Secret } = require('otpauth');
const { getDb } = require('../db/connection');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
const JWT_EXPIRES_IN = '24h';

const VALID_ROLES = ['commander', 'dispatcher', 'field_agent', 'drone_pilot', 'observer'];

/**
 * Generate an Ed25519 key pair.
 * Returns base64-encoded public and secret keys.
 */
function generateKeypair() {
  const pair = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(pair.publicKey),
    secretKey: encodeBase64(pair.secretKey),
  };
}

/**
 * Register a device with its public key and role.
 * The device generates the keypair client-side and sends only the public key.
 */
function registerDevice(deviceId, publicKey, role, name) {
  if (!deviceId || !publicKey) {
    throw new Error('deviceId and publicKey are required');
  }
  if (role && !VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  const db = getDb();

  // Check if device already exists
  const existing = db.prepare('SELECT id FROM users WHERE device_id = ?').get(deviceId);
  if (existing) {
    // Update public key (key rotation)
    db.prepare('UPDATE users SET public_key = ?, updated_at = datetime("now") WHERE device_id = ?')
      .run(publicKey, deviceId);
    return db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO users (id, device_id, name, public_key, role) VALUES (?, ?, ?, ?, ?)'
  ).run(id, deviceId, name || null, publicKey, role || 'field_agent');

  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/**
 * Get a user by device ID.
 */
function getUserByDeviceId(deviceId) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
}

/**
 * Verify an Ed25519 signature.
 * @param {string} message - The original message (UTF-8 string)
 * @param {string} signatureB64 - Base64-encoded signature
 * @param {string} publicKeyB64 - Base64-encoded public key
 * @returns {boolean}
 */
function verifySignature(message, signatureB64, publicKeyB64) {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signature = decodeBase64(signatureB64);
    const publicKey = decodeBase64(publicKeyB64);
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Sign a message with a secret key.
 * @param {string} message - UTF-8 string to sign
 * @param {string} secretKeyB64 - Base64-encoded secret key
 * @returns {string} Base64-encoded signature
 */
function signMessage(message, secretKeyB64) {
  const messageBytes = new TextEncoder().encode(message);
  const secretKey = decodeBase64(secretKeyB64);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return encodeBase64(signature);
}

// ──────────────────────────────────────
// M1.1: TOTP (RFC 6238) — Offline OTP
// ──────────────────────────────────────

/**
 * Generate a TOTP secret for a device.
 * Stores the secret in the users table and returns it (one-time transfer to client).
 */
function generateTotpSecret(deviceId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
  if (!user) {
    throw new Error('Device not registered. Call /register first.');
  }

  // Generate a random secret
  const secret = new Secret({ size: 20 });

  // Create TOTP instance for URI generation
  const totp = new TOTP({
    issuer: 'DigitalDelta',
    label: deviceId,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  // Store the base32-encoded secret in DB
  const secretBase32 = secret.base32;
  db.prepare('UPDATE users SET totp_secret = ? WHERE device_id = ?')
    .run(secretBase32, deviceId);

  return {
    secret: secretBase32,
    uri: totp.toString(), // otpauth:// URI (for QR codes)
    period: 30,
    digits: 6,
    algorithm: 'SHA1',
  };
}

/**
 * Verify a TOTP token for a device.
 * Window=1 means we accept the current code, the previous, and the next (±30s tolerance).
 * Returns { valid, delta } where delta indicates which window matched.
 */
function verifyTotp(deviceId, token) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
  if (!user) {
    throw new Error('Device not found');
  }
  if (!user.totp_secret) {
    throw new Error('No TOTP secret configured. Register the device first.');
  }

  const totp = new TOTP({
    issuer: 'DigitalDelta',
    label: deviceId,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(user.totp_secret),
  });

  // validate returns null if invalid, or a delta integer if valid
  const delta = totp.validate({ token, window: 1 });
  return { valid: delta !== null, delta };
}

/**
 * Generate the current TOTP code for a device (server-side, for testing/demo).
 */
function generateCurrentTotp(deviceId) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
  if (!user || !user.totp_secret) {
    throw new Error('Device not found or no TOTP secret');
  }

  const totp = new TOTP({
    issuer: 'DigitalDelta',
    label: deviceId,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(user.totp_secret),
  });

  return totp.generate();
}

// ──────────────────────────────────────
// JWT Token Management
// ──────────────────────────────────────

/**
 * Issue a JWT after successful TOTP verification.
 */
function issueToken(user) {
  const payload = {
    userId: user.id,
    deviceId: user.device_id,
    role: user.role,
    name: user.name,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT.
 * Returns the payload or throws if expired/invalid.
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  generateKeypair,
  registerDevice,
  getUserByDeviceId,
  verifySignature,
  signMessage,
  generateTotpSecret,
  verifyTotp,
  generateCurrentTotp,
  issueToken,
  verifyToken,
  VALID_ROLES,
  JWT_SECRET,
};
