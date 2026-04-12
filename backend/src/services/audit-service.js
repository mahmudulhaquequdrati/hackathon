const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

const GENESIS_HASH = '0'.repeat(64); // SHA-256 of "nothing" — the chain starts here

/**
 * Append an entry to the audit log with hash chaining.
 * Each entry's hash includes the previous entry's hash, creating a tamper-evident chain.
 *
 * hash = SHA256(prevHash + timestamp + userId + action + resource + payload)
 */
function appendLog(userId, action, resource, payload) {
  const db = getDb();
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const payloadStr = payload ? JSON.stringify(payload) : '';

  // Get the last entry's hash (or genesis hash if this is the first entry)
  const lastEntry = db.prepare(
    'SELECT hash FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 1'
  ).get();
  const prevHash = lastEntry ? lastEntry.hash : GENESIS_HASH;

  // Compute hash: SHA256(prevHash + timestamp + userId + action + resource + payload)
  const hashInput = `${prevHash}${timestamp}${userId || ''}${action}${resource}${payloadStr}`;
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  db.prepare(
    'INSERT INTO audit_log (id, user_id, action, resource, payload, hash, prev_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId || null, action, resource, payloadStr || null, hash, prevHash, timestamp);

  return { id, hash, prevHash, timestamp };
}

/**
 * Verify the integrity of the entire audit chain.
 * Walks every entry in order, recomputes each hash, and checks it matches.
 *
 * Returns:
 *   { valid: true, totalEntries: N }
 *   { valid: false, brokenAt: index, expectedHash, actualHash, entry, totalEntries: N }
 */
function verifyChain() {
  const db = getDb();
  const entries = db.prepare(
    'SELECT * FROM audit_log ORDER BY created_at ASC, rowid ASC'
  ).all();

  if (entries.length === 0) {
    return { valid: true, totalEntries: 0 };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Check prev_hash matches what we expect
    if (entry.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAt: i,
        reason: 'prev_hash mismatch',
        expectedPrevHash,
        actualPrevHash: entry.prev_hash,
        entry: { id: entry.id, action: entry.action, resource: entry.resource },
        totalEntries: entries.length,
      };
    }

    // Recompute hash
    const hashInput = `${entry.prev_hash}${entry.created_at}${entry.user_id || ''}${entry.action}${entry.resource}${entry.payload || ''}`;
    const recomputedHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    if (recomputedHash !== entry.hash) {
      return {
        valid: false,
        brokenAt: i,
        reason: 'hash mismatch — entry was tampered',
        expectedHash: recomputedHash,
        actualHash: entry.hash,
        entry: { id: entry.id, action: entry.action, resource: entry.resource },
        totalEntries: entries.length,
      };
    }

    expectedPrevHash = entry.hash;
  }

  return { valid: true, totalEntries: entries.length };
}

/**
 * Get audit log entries with optional filters.
 */
function getLogs({ userId, resource, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  let query = 'SELECT * FROM audit_log';
  const params = [];
  const conditions = [];

  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }
  if (resource) {
    conditions.push('resource = ?');
    params.push(resource);
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

module.exports = {
  appendLog,
  verifyChain,
  getLogs,
  GENESIS_HASH,
};
