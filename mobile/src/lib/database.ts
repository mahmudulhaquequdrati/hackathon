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
  `);

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
