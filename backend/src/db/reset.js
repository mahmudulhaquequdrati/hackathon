require('dotenv').config();
const { getDb } = require('./connection');
const fs = require('fs');
const path = require('path');

const db = getDb();
const tables = [
  'triage_decisions',
  'mesh_node_state',
  'used_nonces',
  'mesh_messages',
  'pod_receipts',
  'sync_state',
  'audit_log',
  'deliveries',
  'supplies',
  'users',
  'edges',
  'nodes'
];

tables.forEach(t => db.exec(`DROP TABLE IF EXISTS ${t}`));

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);
console.log('Database reset complete. All tables created.');
