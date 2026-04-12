import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('digital_delta.db');

  // Create tables
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS supplies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'equipment',
      quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'units',
      priority TEXT NOT NULL DEFAULT 'P2',
      node_id TEXT,
      crdt_state TEXT,
      synced INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mesh_messages (
      id TEXT PRIMARY KEY,
      source_device_id TEXT NOT NULL,
      target_device_id TEXT NOT NULL,
      relay_device_id TEXT,
      payload TEXT NOT NULL,
      nonce TEXT,
      sender_box_pub_key TEXT,
      ttl INTEGER NOT NULL DEFAULT 3,
      hop_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_peers (
      device_id TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      box_public_key TEXT NOT NULL,
      ip_address TEXT,
      port INTEGER,
      cached_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mesh_node_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'camp',
      lat REAL,
      lng REAL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS cached_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'road',
      distance REAL,
      travel_time REAL,
      risk_score REAL DEFAULT 0,
      status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS local_deliveries (
      id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      vehicle_type TEXT NOT NULL DEFAULT 'truck',
      priority TEXT NOT NULL DEFAULT 'P2',
      status TEXT NOT NULL DEFAULT 'pending',
      supply_id TEXT,
      driver_id TEXT,
      synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS used_nonces (
      nonce TEXT PRIMARY KEY,
      delivery_id TEXT,
      used_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS local_triage_decisions (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      old_eta TEXT,
      new_eta TEXT,
      sla_deadline TEXT,
      slack_minutes REAL,
      dropped_cargo TEXT,
      waypoint_id TEXT,
      rationale TEXT,
      decided_by TEXT DEFAULT 'system',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pod_receipts (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL,
      sender_device_id TEXT NOT NULL,
      receiver_device_id TEXT NOT NULL,
      sender_signature TEXT NOT NULL,
      receiver_signature TEXT,
      payload_hash TEXT NOT NULL,
      nonce TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations — add columns to existing tables (silently skip if already present)
  try { await db.execAsync('ALTER TABLE mesh_peers ADD COLUMN ip_address TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE mesh_peers ADD COLUMN port INTEGER'); } catch {}

  return db;
}

// --- Supply CRUD with CRDT state ---

export interface SupplyRow {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  priority: string;
  node_id: string | null;
  crdt_state: string | null;
  synced: number;
  updated_at: string;
}

export async function getAllSupplies(): Promise<SupplyRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<SupplyRow>('SELECT * FROM supplies ORDER BY updated_at DESC');
}

export async function getSupplyById(id: string): Promise<SupplyRow | null> {
  const db = await getDatabase();
  return db.getFirstAsync<SupplyRow>('SELECT * FROM supplies WHERE id = ?', [id]);
}

export async function upsertSupply(
  id: string,
  plain: Record<string, any>,
  crdtState: string,
  synced: boolean = false,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO supplies (id, name, category, quantity, unit, priority, node_id, crdt_state, synced, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       quantity = excluded.quantity,
       unit = excluded.unit,
       priority = excluded.priority,
       node_id = excluded.node_id,
       crdt_state = excluded.crdt_state,
       synced = excluded.synced,
       updated_at = excluded.updated_at`,
    [
      id,
      plain.name || 'Unknown',
      plain.category || 'equipment',
      plain.quantity ?? 0,
      plain.unit || 'units',
      plain.priority || 'P2',
      plain.nodeId || plain.node_id || null,
      crdtState,
      synced ? 1 : 0,
    ],
  );
}

export async function getUnsyncedSupplies(): Promise<SupplyRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<SupplyRow>(
    'SELECT * FROM supplies WHERE synced = 0 AND crdt_state IS NOT NULL',
  );
}

export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE supplies SET synced = 1 WHERE id IN (${placeholders})`,
    ids,
  );
}

// --- Mesh messages (M3) ---

export interface MeshMessageRow {
  id: string;
  source_device_id: string;
  target_device_id: string;
  relay_device_id: string | null;
  payload: string;
  nonce: string | null;
  sender_box_pub_key: string | null;
  ttl: number;
  hop_count: number;
  status: string;
  created_at: string;
  expires_at: string | null;
}

export async function insertMeshMessage(msg: MeshMessageRow): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO mesh_messages (id, source_device_id, target_device_id, relay_device_id, payload, nonce, sender_box_pub_key, ttl, hop_count, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.source_device_id, msg.target_device_id, msg.relay_device_id, msg.payload, msg.nonce, msg.sender_box_pub_key, msg.ttl, msg.hop_count, msg.status, msg.expires_at],
  );
}

export async function getPendingOutbox(deviceId: string): Promise<MeshMessageRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<MeshMessageRow>(
    "SELECT * FROM mesh_messages WHERE source_device_id = ? AND status = 'pending' ORDER BY created_at ASC",
    [deviceId],
  );
}

export async function getPendingInbox(deviceId: string): Promise<MeshMessageRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<MeshMessageRow>(
    "SELECT * FROM mesh_messages WHERE target_device_id = ? AND status IN ('pending', 'delivered') ORDER BY created_at ASC",
    [deviceId],
  );
}

export async function getRelayableMessages(excludeDeviceId: string): Promise<MeshMessageRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<MeshMessageRow>(
    "SELECT * FROM mesh_messages WHERE status = 'pending' AND target_device_id != ? AND ttl > 0 AND (expires_at IS NULL OR expires_at > datetime('now'))",
    [excludeDeviceId],
  );
}

export async function updateMeshMessageStatus(id: string, status: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE mesh_messages SET status = ? WHERE id = ?', [status, id]);
}

export async function meshMessageExists(id: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM mesh_messages WHERE id = ?', [id]);
  return !!row;
}

export async function expireOldMeshMessages(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE mesh_messages SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')");
}

export async function getAllMeshMessages(deviceId: string): Promise<MeshMessageRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<MeshMessageRow>(
    'SELECT * FROM mesh_messages WHERE source_device_id = ? OR target_device_id = ? ORDER BY created_at DESC',
    [deviceId, deviceId],
  );
}

// --- Mesh peers cache (M3) ---

export interface MeshPeerRow {
  device_id: string;
  name: string | null;
  role: string | null;
  box_public_key: string;
  ip_address: string | null;
  port: number | null;
  cached_at: string;
}

export async function cachePeer(
  deviceId: string,
  boxPubKey: string,
  name: string | null,
  role: string | null,
  ipAddress?: string | null,
  port?: number | null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO mesh_peers (device_id, name, role, box_public_key, ip_address, port, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(device_id) DO UPDATE SET
       name = excluded.name,
       role = excluded.role,
       box_public_key = excluded.box_public_key,
       ip_address = COALESCE(excluded.ip_address, mesh_peers.ip_address),
       port = COALESCE(excluded.port, mesh_peers.port),
       cached_at = excluded.cached_at`,
    [deviceId, name, role, boxPubKey, ipAddress ?? null, port ?? null],
  );
}

export async function getCachedPeers(): Promise<MeshPeerRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<MeshPeerRow>('SELECT * FROM mesh_peers ORDER BY name ASC');
}

export async function getCachedPeer(deviceId: string): Promise<MeshPeerRow | null> {
  const db = await getDatabase();
  return db.getFirstAsync<MeshPeerRow>('SELECT * FROM mesh_peers WHERE device_id = ?', [deviceId]);
}

// --- Mesh node state (M3) ---

export async function saveMeshNodeState(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO mesh_node_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getMeshNodeState(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM mesh_node_state WHERE key = ?', [key]);
  return row ? row.value : null;
}

// --- Delivery upsert (for full sync) ---

export async function upsertLocalDelivery(d: {
  id: string; source_node_id: string; target_node_id: string;
  vehicle_type?: string; priority?: string; status?: string;
  supply_id?: string; driver_id?: string; created_at?: string;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO local_deliveries (id, source_node_id, target_node_id, vehicle_type, priority, status, supply_id, driver_id, synced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       synced = 1`,
    [d.id, d.source_node_id, d.target_node_id, d.vehicle_type || 'truck', d.priority || 'P2', d.status || 'pending', d.supply_id || null, d.driver_id || null, d.created_at || new Date().toISOString()],
  );
}

export async function upsertPodReceipt(r: {
  id: string; delivery_id: string; sender_device_id: string; receiver_device_id: string;
  sender_signature: string; receiver_signature?: string | null; payload_hash: string;
  nonce: string; status: string; created_at?: string;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO pod_receipts (id, delivery_id, sender_device_id, receiver_device_id, sender_signature, receiver_signature, payload_hash, nonce, status, synced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, receiver_signature = COALESCE(excluded.receiver_signature, pod_receipts.receiver_signature)`,
    [r.id, r.delivery_id, r.sender_device_id, r.receiver_device_id, r.sender_signature, r.receiver_signature || null, r.payload_hash, r.nonce, r.status, r.created_at || new Date().toISOString()],
  );
}

// --- Sync state (vector clock persistence) ---

export async function getVectorClock(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'vector_clock'",
  );
  return row ? JSON.parse(row.value) : {};
}

export async function saveVectorClock(clock: Record<string, number>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES ('vector_clock', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(clock)],
  );
}
