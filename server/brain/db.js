// input: 无
// output: SQLite 数据库连接和初始化
// position: 大脑数据库层

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'brain.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      source TEXT DEFAULT 'manual',
      source_ref TEXT,
      usage_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      is_consolidated INTEGER DEFAULT 0,
      consolidated_into INTEGER,
      importance REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      fragment_ids TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dream_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      fragment_ids TEXT DEFAULT '[]',
      result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fragment_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fragment_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      image_base64 TEXT,
      description TEXT,
      mime_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (fragment_id) REFERENCES fragments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_fragments_tags ON fragments(tags);
    CREATE INDEX IF NOT EXISTS idx_fragments_source ON fragments(source);
    CREATE INDEX IF NOT EXISTS idx_fragments_usage ON fragments(usage_count);
    CREATE INDEX IF NOT EXISTS idx_images_fragment ON fragment_images(fragment_id);
  `);

  const fragmentColumns = db.prepare('PRAGMA table_info(fragments)').all();
  if (!fragmentColumns.some(column => column.name === 'source_ref')) {
    db.exec('ALTER TABLE fragments ADD COLUMN source_ref TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fragments_source_ref ON fragments(source_ref)');
  
  // 迁移：添加新列（如果不存在）
  try {
    db.prepare('SELECT image_path FROM fragments LIMIT 1').get();
  } catch (e) {
    // 列不存在，添加
    db.exec('ALTER TABLE fragments ADD COLUMN image_path TEXT');
    db.exec('ALTER TABLE fragments ADD COLUMN image_description TEXT');
  }
}

module.exports = { getDb };
