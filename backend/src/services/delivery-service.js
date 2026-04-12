const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');
const routeService = require('./route-service');
const authService = require('./auth-service');
const auditService = require('./audit-service');

const POD_EXPIRY_MINUTES = 5;

// ── Delivery CRUD ─────────────────────────────────────────────────────

function createDelivery({ supplyId, sourceNodeId, targetNodeId, vehicleType, priority, driverId }) {
  const db = getDb();
  const id = uuidv4();

  // Compute route via M4
  let routeData = null;
  let eta = null;
  try {
    const route = routeService.findPath(sourceNodeId, targetNodeId, vehicleType);
    routeData = JSON.stringify(route);
    // M6: Compute initial ETA
    const triageService = require('./triage-service');
    eta = triageService.computeEta(route, new Date().toISOString());
  } catch (err) {
    // Route computation is best-effort; delivery can exist without a pre-computed route
  }

  db.prepare(`
    INSERT INTO deliveries (id, supply_id, source_node_id, target_node_id, vehicle_type, priority, driver_id, route_data, eta, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, supplyId || null, sourceNodeId, targetNodeId, vehicleType || 'truck', priority || 'P2', driverId || null, routeData, eta);

  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);

  auditService.appendLog(driverId, 'DELIVERY_CREATED', 'deliveries', { delivery_id: id, source: sourceNodeId, target: targetNodeId });

  return delivery;
}

function getDeliveries({ status, driverId, limit = 50 } = {}) {
  const db = getDb();
  let query = 'SELECT * FROM deliveries';
  const conditions = [];
  const params = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (driverId) { conditions.push('driver_id = ?'); params.push(driverId); }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params);
}

function getDeliveryById(id) {
  return getDb().prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
}

function updateDeliveryStatus(id, status) {
  const db = getDb();
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
  if (!delivery) throw new Error(`Delivery not found: ${id}`);

  const validTransitions = {
    pending: ['in_transit', 'failed', 'preempted'],
    in_transit: ['delivered', 'failed', 'preempted'],
    preempted: ['pending', 'in_transit'],
  };
  const allowed = validTransitions[delivery.status];
  if (!allowed || !allowed.includes(status)) {
    throw new Error(`Invalid status transition: ${delivery.status} → ${status}`);
  }

  db.prepare("UPDATE deliveries SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);

  auditService.appendLog(delivery.driver_id, 'DELIVERY_STATUS_CHANGED', 'deliveries', {
    delivery_id: id, old_status: delivery.status, new_status: status,
  });

  return db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
}

// ── PoD Challenge-Response (M5.1) ─────────────────────────────────────

function createPodChallenge(deliveryId, senderDeviceId) {
  const db = getDb();

  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
  if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);

  const sender = db.prepare('SELECT * FROM users WHERE device_id = ?').get(senderDeviceId);
  if (!sender) throw new Error(`Sender device not found: ${senderDeviceId}`);
  if (!sender.public_key) throw new Error(`Sender has no registered public key`);

  // Build the supply payload hash
  let payloadHash;
  if (delivery.supply_id) {
    const supply = db.prepare('SELECT * FROM supplies WHERE id = ?').get(delivery.supply_id);
    const payloadStr = JSON.stringify({
      supply_id: delivery.supply_id,
      supply_name: supply?.name,
      quantity: supply?.quantity,
      priority: delivery.priority,
    });
    payloadHash = crypto.createHash('sha256').update(payloadStr).digest('hex');
  } else {
    payloadHash = crypto.createHash('sha256').update(deliveryId).digest('hex');
  }

  const nonce = uuidv4();
  const timestamp = new Date().toISOString();

  // The canonical payload that gets signed (device signs locally with its secret key)
  const podPayload = {
    delivery_id: deliveryId,
    sender_pubkey: sender.public_key,
    sender_device_id: senderDeviceId,
    payload_hash: payloadHash,
    nonce,
    timestamp,
  };

  const canonicalString = JSON.stringify(podPayload);

  auditService.appendLog(sender.id, 'POD_CHALLENGE_CREATED', 'pod_receipts', {
    delivery_id: deliveryId, nonce,
  });

  // Server returns unsigned payload — the mobile device signs it locally
  // with its private key (which never leaves the device)
  return {
    pod_payload: podPayload,
    canonical_string: canonicalString,
    note: 'Sign canonical_string with your Ed25519 secret key on-device',
  };
}

// ── Verify & Countersign (M5.1 + M5.2) ──────────────────────────────

function verifyAndConfirmPod({ podPayload, senderSignature, receiverDeviceId, receiverSignature }) {
  const db = getDb();

  // Parse payload if it's a string
  const payload = typeof podPayload === 'string' ? JSON.parse(podPayload) : podPayload;

  // M5.2: Check nonce not reused (replay protection)
  const existingNonce = db.prepare('SELECT nonce FROM used_nonces WHERE nonce = ?').get(payload.nonce);
  if (existingNonce) {
    throw Object.assign(new Error('Nonce already used — replay detected'), { code: 'NONCE_REUSED' });
  }

  // M5.2: Check timestamp not expired
  const podTime = new Date(payload.timestamp).getTime();
  const now = Date.now();
  if (now - podTime > POD_EXPIRY_MINUTES * 60 * 1000) {
    throw Object.assign(new Error(`PoD expired — older than ${POD_EXPIRY_MINUTES} minutes`), { code: 'EXPIRED' });
  }

  // M5.1: Verify sender signature
  const canonicalString = JSON.stringify(payload);
  const senderValid = authService.verifySignature(canonicalString, senderSignature, payload.sender_pubkey);
  if (!senderValid) {
    throw Object.assign(new Error('Sender signature invalid — tampered payload'), { code: 'SIGNATURE_INVALID' });
  }

  // Verify receiver exists
  const receiver = db.prepare('SELECT * FROM users WHERE device_id = ?').get(receiverDeviceId);
  if (!receiver) throw new Error(`Receiver device not found: ${receiverDeviceId}`);

  // Verify receiver signature if provided
  if (receiverSignature && receiver.public_key) {
    const receiverValid = authService.verifySignature(canonicalString, receiverSignature, receiver.public_key);
    if (!receiverValid) {
      throw Object.assign(new Error('Receiver signature invalid'), { code: 'SIGNATURE_INVALID' });
    }
  }

  // Mark nonce as used (M5.2)
  db.prepare('INSERT INTO used_nonces (nonce, device_id, delivery_id) VALUES (?, ?, ?)')
    .run(payload.nonce, receiverDeviceId, payload.delivery_id);

  // Store PoD receipt
  const receiptId = uuidv4();
  db.prepare(`
    INSERT INTO pod_receipts (id, delivery_id, sender_device_id, receiver_device_id, sender_signature, receiver_signature, payload_hash, nonce, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
  `).run(
    receiptId, payload.delivery_id, payload.sender_device_id, receiverDeviceId,
    senderSignature, receiverSignature || null, payload.payload_hash, payload.nonce,
  );

  // Update delivery status to delivered
  try {
    updateDeliveryStatus(payload.delivery_id, 'delivered');
  } catch {
    // May already be delivered or in wrong state — not fatal
  }

  // M5.3: Append to audit log (hash-chained)
  auditService.appendLog(receiver.id, 'POD_CONFIRMED', 'pod_receipts', {
    receipt_id: receiptId,
    delivery_id: payload.delivery_id,
    sender_device_id: payload.sender_device_id,
    receiver_device_id: receiverDeviceId,
    payload_hash: payload.payload_hash,
    nonce: payload.nonce,
  });

  return {
    receipt_id: receiptId,
    delivery_id: payload.delivery_id,
    status: 'confirmed',
    sender_device_id: payload.sender_device_id,
    receiver_device_id: receiverDeviceId,
    payload_hash: payload.payload_hash,
    nonce: payload.nonce,
  };
}

// ── Chain of Custody (M5.3) ──────────────────────────────────────────

function getDeliveryChain(deliveryId) {
  const db = getDb();

  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(deliveryId);
  if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);

  const receipts = db.prepare(
    'SELECT * FROM pod_receipts WHERE delivery_id = ? ORDER BY created_at ASC'
  ).all(deliveryId);

  // Get audit entries related to this delivery
  const auditEntries = db.prepare(
    "SELECT * FROM audit_log WHERE payload LIKE ? ORDER BY created_at ASC"
  ).all(`%${deliveryId}%`);

  return {
    delivery,
    receipts,
    audit_trail: auditEntries,
    chain_length: receipts.length,
    fully_verified: receipts.every(r => r.sender_signature && r.receiver_signature && r.status === 'confirmed'),
  };
}

// ── Nonce helpers ────────────────────────────────────────────────────

function isNonceUsed(nonce) {
  return !!getDb().prepare('SELECT nonce FROM used_nonces WHERE nonce = ?').get(nonce);
}

module.exports = {
  createDelivery,
  getDeliveries,
  getDeliveryById,
  updateDeliveryStatus,
  createPodChallenge,
  verifyAndConfirmPod,
  getDeliveryChain,
  isNonceUsed,
};
