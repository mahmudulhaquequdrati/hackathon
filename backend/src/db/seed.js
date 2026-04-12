require('dotenv').config();
const { getDb } = require('./connection');
const { v4: uuidv4 } = require('uuid');

const db = getDb();

// Ensure schema exists
const fs = require('fs');
const path = require('path');
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// ── Nodes ──────────────────────────────────────────────────────────────────
const nodes = [
  { id: 'sylhet-hub',    name: 'Sylhet Hub',        type: 'hub',        lat: 24.8949, lng: 91.8687, status: 'active', capacity: 5000 },
  { id: 'sunamganj',     name: 'Sunamganj Camp',     type: 'camp',       lat: 25.0657, lng: 91.3950, status: 'active', capacity: 2000 },
  { id: 'companiganj',   name: 'Companiganj Post',   type: 'waypoint',   lat: 25.0500, lng: 91.7333, status: 'active', capacity: 800  },
  { id: 'bishwanath',    name: 'Bishwanath Base',    type: 'camp',       lat: 24.8167, lng: 91.7167, status: 'active', capacity: 1500 },
  { id: 'golapganj',     name: 'Golapganj Post',     type: 'waypoint',   lat: 24.7333, lng: 91.8333, status: 'active', capacity: 600  },
  { id: 'jaintapur',     name: 'Jaintapur Drone Base', type: 'drone_base', lat: 25.1333, lng: 92.0667, status: 'active', capacity: 200 }
];

const insertNode = db.prepare(`
  INSERT OR REPLACE INTO nodes (id, name, type, lat, lng, status, capacity)
  VALUES (@id, @name, @type, @lat, @lng, @status, @capacity)
`);

db.transaction(() => {
  nodes.forEach(n => insertNode.run(n));
})();
console.log(`Seeded ${nodes.length} nodes.`);

// ── Edges ──────────────────────────────────────────────────────────────────
const edges = [
  { id: 'e1', source_id: 'sylhet-hub',  target_id: 'bishwanath',  type: 'road',     distance: 22.5, travel_time: 35, capacity: 1.0, risk_score: 0.1, status: 'open' },
  { id: 'e2', source_id: 'sylhet-hub',  target_id: 'companiganj', type: 'road',     distance: 31.0, travel_time: 50, capacity: 1.0, risk_score: 0.2, status: 'open' },
  { id: 'e3', source_id: 'companiganj', target_id: 'sunamganj',   type: 'waterway', distance: 40.0, travel_time: 90, capacity: 0.8, risk_score: 0.4, status: 'open' },
  { id: 'e4', source_id: 'bishwanath',  target_id: 'golapganj',   type: 'road',     distance: 18.0, travel_time: 28, capacity: 1.0, risk_score: 0.15, status: 'open' },
  { id: 'e5', source_id: 'golapganj',   target_id: 'sylhet-hub',  type: 'road',     distance: 15.0, travel_time: 22, capacity: 1.0, risk_score: 0.1, status: 'open' },
  { id: 'e6', source_id: 'sylhet-hub',  target_id: 'jaintapur',   type: 'airway',   distance: 27.0, travel_time: 15, capacity: 0.5, risk_score: 0.05, status: 'open' },
  { id: 'e7', source_id: 'jaintapur',   target_id: 'sunamganj',   type: 'airway',   distance: 75.0, travel_time: 40, capacity: 0.5, risk_score: 0.1,  status: 'open' }
];

const insertEdge = db.prepare(`
  INSERT OR REPLACE INTO edges (id, source_id, target_id, type, distance, travel_time, capacity, risk_score, status)
  VALUES (@id, @source_id, @target_id, @type, @distance, @travel_time, @capacity, @risk_score, @status)
`);

db.transaction(() => {
  edges.forEach(e => insertEdge.run(e));
})();
console.log(`Seeded ${edges.length} edges.`);

// ── Users ──────────────────────────────────────────────────────────────────
const users = [
  { id: uuidv4(), device_id: 'dev-commander-01',  name: 'Col. Rahman',      role: 'commander',    public_key: null, totp_secret: 'JBSWY3DPEHPK3PXP' },
  { id: uuidv4(), device_id: 'dev-dispatcher-01', name: 'Dispatcher Akter', role: 'dispatcher',   public_key: null, totp_secret: 'JBSWY3DPEHPK3PXQ' },
  { id: uuidv4(), device_id: 'dev-agent-01',       name: 'Field Agent Hasan',role: 'field_agent',  public_key: null, totp_secret: 'JBSWY3DPEHPK3PXR' },
  { id: uuidv4(), device_id: 'dev-pilot-01',       name: 'Drone Pilot Mim',  role: 'drone_pilot',  public_key: null, totp_secret: 'JBSWY3DPEHPK3PXS' },
  { id: uuidv4(), device_id: 'dev-observer-01',    name: 'UN Observer Karim',role: 'observer',     public_key: null, totp_secret: 'JBSWY3DPEHPK3PXT' }
];

const insertUser = db.prepare(`
  INSERT OR REPLACE INTO users (id, device_id, name, role, public_key, totp_secret)
  VALUES (@id, @device_id, @name, @role, @public_key, @totp_secret)
`);

db.transaction(() => {
  users.forEach(u => insertUser.run(u));
})();
console.log(`Seeded ${users.length} users.`);

// ── Supplies ───────────────────────────────────────────────────────────────
const supplies = [
  { id: uuidv4(), name: 'ORS Packets',         category: 'medical',   quantity: 5000, unit: 'packets',  priority: 'P0', node_id: 'sylhet-hub' },
  { id: uuidv4(), name: 'Insulin',             category: 'medical',   quantity: 200,  unit: 'vials',    priority: 'P0', node_id: 'sylhet-hub' },
  { id: uuidv4(), name: 'Rice Bags (50kg)',    category: 'food',      quantity: 800,  unit: 'bags',     priority: 'P1', node_id: 'sylhet-hub' },
  { id: uuidv4(), name: 'Canned Goods',        category: 'food',      quantity: 3000, unit: 'cans',     priority: 'P2', node_id: 'sunamganj' },
  { id: uuidv4(), name: 'Purified Water (5L)', category: 'water',     quantity: 2000, unit: 'bottles',  priority: 'P0', node_id: 'sylhet-hub' },
  { id: uuidv4(), name: 'Water Purification Tablets', category: 'water', quantity: 10000, unit: 'tablets', priority: 'P1', node_id: 'companiganj' },
  { id: uuidv4(), name: 'Emergency Tents',     category: 'shelter',   quantity: 150,  unit: 'units',    priority: 'P1', node_id: 'sunamganj' },
  { id: uuidv4(), name: 'Emergency Generator', category: 'equipment', quantity: 10,   unit: 'units',    priority: 'P1', node_id: 'sylhet-hub' }
];

const insertSupply = db.prepare(`
  INSERT OR REPLACE INTO supplies (id, name, category, quantity, unit, priority, node_id)
  VALUES (@id, @name, @category, @quantity, @unit, @priority, @node_id)
`);

db.transaction(() => {
  supplies.forEach(s => insertSupply.run(s));
})();
console.log(`Seeded ${supplies.length} supplies.`);

// Seed initial audit entry using the audit service (ensures correct hash chain)
const auditService = require('../services/audit-service');
const existing = db.prepare('SELECT id FROM audit_log LIMIT 1').get();
if (!existing) {
  auditService.appendLog(null, 'GENESIS', 'system', { event: 'database_seeded' });
}

console.log('Seed complete.');
