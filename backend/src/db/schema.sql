-- Nodes: relief camps, hubs, waypoints
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'camp', -- hub, camp, waypoint, drone_base
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active, damaged, offline
  capacity INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Edges: roads, waterways, airways connecting nodes
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES nodes(id),
  target_id TEXT NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL DEFAULT 'road', -- road, waterway, airway
  distance REAL NOT NULL, -- km
  travel_time REAL NOT NULL, -- minutes
  capacity REAL DEFAULT 1.0,
  risk_score REAL DEFAULT 0.0, -- 0.0 to 1.0
  status TEXT NOT NULL DEFAULT 'open', -- open, degraded, closed, washed_out
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Users/Devices
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  device_id TEXT UNIQUE NOT NULL,
  name TEXT,
  public_key TEXT,
  box_public_key TEXT, -- x25519 encryption key for mesh E2E (M3.3)
  role TEXT NOT NULL DEFAULT 'field_agent', -- commander, dispatcher, field_agent, drone_pilot, observer
  totp_secret TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Supply inventory (CRDT-synced)
CREATE TABLE IF NOT EXISTS supplies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- medical, food, water, equipment, shelter
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'units',
  priority TEXT NOT NULL DEFAULT 'P2', -- P0, P1, P2, P3
  node_id TEXT REFERENCES nodes(id),
  crdt_state TEXT, -- serialized LWW-Map JSON
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Deliveries
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  supply_id TEXT REFERENCES supplies(id),
  source_node_id TEXT REFERENCES nodes(id),
  target_node_id TEXT REFERENCES nodes(id),
  vehicle_type TEXT NOT NULL DEFAULT 'truck', -- truck, boat, drone
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_transit, delivered, failed
  priority TEXT NOT NULL DEFAULT 'P2',
  route_data TEXT, -- JSON: computed route
  driver_id TEXT REFERENCES users(id),
  eta TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Audit log (hash-chained)
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  payload TEXT,
  hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL, -- device/node identifier
  vector_clock TEXT NOT NULL, -- JSON serialized vector clock
  last_sync TEXT DEFAULT (datetime('now')),
  sync_type TEXT DEFAULT 'full' -- full, delta
);

-- Proof of Delivery receipts
CREATE TABLE IF NOT EXISTS pod_receipts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT REFERENCES deliveries(id),
  sender_device_id TEXT NOT NULL,
  receiver_device_id TEXT NOT NULL,
  sender_signature TEXT NOT NULL,
  receiver_signature TEXT,
  payload_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, rejected
  created_at TEXT DEFAULT (datetime('now'))
);

-- Mesh network messages
CREATE TABLE IF NOT EXISTS mesh_messages (
  id TEXT PRIMARY KEY,
  source_device_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  relay_device_id TEXT,
  payload TEXT NOT NULL, -- encrypted ciphertext (base64)
  nonce TEXT, -- nacl.box nonce for decryption (base64)
  sender_box_pub_key TEXT, -- sender's x25519 box public key (base64)
  ttl INTEGER NOT NULL DEFAULT 3,
  hop_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, relayed, delivered, expired
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

-- Mesh node state for role tracking (M3.2)
CREATE TABLE IF NOT EXISTS mesh_node_state (
  device_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'client', -- 'client' or 'relay'
  battery_level REAL,
  signal_strength REAL,
  connected_peers INTEGER DEFAULT 0,
  last_heartbeat TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
