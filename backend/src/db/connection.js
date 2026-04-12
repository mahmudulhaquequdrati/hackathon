require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function getDb() {
  if (!db) {
    const dbPath = process.env.SQLITE_DB_PATH
      ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
      : path.join(__dirname, '..', '..', 'data', 'digital_delta.sqlite');

    const fs = require('fs');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

module.exports = { getDb };
