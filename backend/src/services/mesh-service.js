/**
 * M3: Ad-Hoc Mesh Network Protocol — Backend Service
 *
 * Store-and-forward message relay with TTL, deduplication,
 * dual-role node management, and E2E encryption support.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const auditService = require('./audit-service');

// ── M3.1: Store-and-Forward Message Relay ─────────────────────────────────

/**
 * Create and store a new mesh message.
 * The payload is already encrypted by the sender (E2E).
 */
function createMessage(sourceDeviceId, targetDeviceId, encryptedPayload, nonce, senderBoxPubKey, ttl = 3) {
  const db = getDb();
  const id = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // +24h

  db.prepare(`
    INSERT INTO mesh_messages (id, source_device_id, target_device_id, payload, nonce, sender_box_pub_key, ttl, hop_count, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)
  `).run(id, sourceDeviceId, targetDeviceId, encryptedPayload, nonce, senderBoxPubKey, ttl, expiresAt);

  auditService.appendLog(sourceDeviceId, 'MESH_SEND', 'mesh_messages', {
    messageId: id,
    targetDeviceId,
    ttl,
  });

  return { id, sourceDeviceId, targetDeviceId, ttl, hopCount: 0, status: 'pending', expiresAt };
}

/**
 * Get pending inbox messages for a device.
 */
function getInbox(deviceId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM mesh_messages
    WHERE target_device_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `).all(deviceId);
}

/**
 * Relay a message through this node.
 * Validates TTL, deduplicates, and decrements TTL.
 */
function relayMessage(relayDeviceId, message) {
  const db = getDb();

  // TTL check
  if (!message.ttl || message.ttl <= 0) {
    return { relayed: false, reason: 'ttl_expired' };
  }

  // Deduplication: check if this exact message ID already exists
  const existing = db.prepare('SELECT id FROM mesh_messages WHERE id = ?').get(message.id);
  if (existing) {
    return { relayed: false, reason: 'duplicate' };
  }

  const expiresAt = message.expires_at || message.expiresAt ||
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO mesh_messages (id, source_device_id, target_device_id, relay_device_id, payload, nonce, sender_box_pub_key, ttl, hop_count, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    message.id,
    message.source_device_id || message.sourceDeviceId,
    message.target_device_id || message.targetDeviceId,
    relayDeviceId,
    message.payload,
    message.nonce || null,
    message.sender_box_pub_key || message.senderBoxPubKey || null,
    message.ttl - 1,
    (message.hop_count || message.hopCount || 0) + 1,
    expiresAt,
  );

  auditService.appendLog(relayDeviceId, 'MESH_RELAY', 'mesh_messages', {
    messageId: message.id,
    fromHop: message.hop_count || message.hopCount || 0,
    ttlRemaining: message.ttl - 1,
  });

  return {
    relayed: true,
    messageId: message.id,
    ttlRemaining: message.ttl - 1,
    hopCount: (message.hop_count || message.hopCount || 0) + 1,
  };
}

/**
 * Mark messages as delivered (bulk).
 */
function markDelivered(messageIds) {
  const db = getDb();
  const stmt = db.prepare('UPDATE mesh_messages SET status = ? WHERE id = ?');
  const markMany = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run('delivered', id);
    }
  });
  markMany(messageIds);
}

/**
 * Get messages that can be relayed (pending, not expired, TTL > 0).
 */
function getRelayableMessages(excludeDeviceId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM mesh_messages
    WHERE status = 'pending'
      AND target_device_id != ?
      AND ttl > 0
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at ASC
  `).all(excludeDeviceId);
}

/**
 * Expire stale messages past their expires_at.
 */
function expireStaleMessages() {
  const db = getDb();
  const result = db.prepare(`
    UPDATE mesh_messages SET status = 'expired'
    WHERE status = 'pending' AND expires_at < datetime('now')
  `).run();
  return result.changes;
}

// ── M3.3: Encryption Key Lookup ───────────────────────────────────────────

/**
 * Get the box public key for a device (for sender to encrypt).
 */
function getBoxPublicKey(deviceId) {
  const db = getDb();
  const row = db.prepare('SELECT box_public_key FROM users WHERE device_id = ?').get(deviceId);
  return row ? row.box_public_key : null;
}

/**
 * Get all peers with box public keys (for peer discovery).
 */
function getPeers() {
  const db = getDb();
  return db.prepare(`
    SELECT device_id, name, role, box_public_key
    FROM users
    WHERE box_public_key IS NOT NULL
  `).all();
}

// ── M3.2: Dual-Role Node Architecture ────────────────────────────────────

/**
 * Update a node's mesh state (role, battery, signal, peers).
 */
function updateNodeState(deviceId, role, batteryLevel, signalStrength, connectedPeers) {
  const db = getDb();
  db.prepare(`
    INSERT INTO mesh_node_state (device_id, role, battery_level, signal_strength, connected_peers, last_heartbeat, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET
      role = excluded.role,
      battery_level = excluded.battery_level,
      signal_strength = excluded.signal_strength,
      connected_peers = excluded.connected_peers,
      last_heartbeat = excluded.last_heartbeat,
      updated_at = excluded.updated_at
  `).run(deviceId, role, batteryLevel, signalStrength, connectedPeers);
}

/**
 * Get a node's current mesh state.
 */
function getNodeState(deviceId) {
  const db = getDb();
  return db.prepare('SELECT * FROM mesh_node_state WHERE device_id = ?').get(deviceId);
}

/**
 * Log a role switch to the audit trail.
 */
function logRoleSwitch(deviceId, fromRole, toRole, reason) {
  auditService.appendLog(deviceId, 'MESH_ROLE_SWITCH', 'mesh_nodes', {
    deviceId,
    fromRole,
    toRole,
    reason,
  });
}

/**
 * Evaluate role heuristics for a device.
 * Returns 'relay' if battery > 50%, signal > 0.6, peers >= 2.
 */
function evaluateRole(batteryLevel, signalStrength, connectedPeers) {
  if (batteryLevel > 0.5 && signalStrength > 0.6 && connectedPeers >= 2) {
    return 'relay';
  }
  return 'client';
}

module.exports = {
  createMessage,
  getInbox,
  relayMessage,
  markDelivered,
  getRelayableMessages,
  expireStaleMessages,
  getBoxPublicKey,
  getPeers,
  updateNodeState,
  getNodeState,
  logRoleSwitch,
  evaluateRole,
};
