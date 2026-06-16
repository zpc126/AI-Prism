// input: better-sqlite3
// output: Web 评估集 + 评估记录 CRUD
// position: server/evaluation/storage.js

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'eval.sqlite');

let db;

function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cases TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      results TEXT,
      report TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dataset_id) REFERENCES eval_datasets(id)
    );
  `);
  
  return db;
}

// ========== 评估集 ==========

function listDatasets() {
  const db = getDb();
  return db.prepare('SELECT * FROM eval_datasets ORDER BY updated_at DESC').all();
}

function getDataset(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM eval_datasets WHERE id = ?').get(id);
}

function createDataset({ id, name, description, cases }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO eval_datasets (id, name, description, cases)
    VALUES (?, ?, ?, ?)
  `).run(id, name, description || '', JSON.stringify(cases));
  return getDataset(id);
}

function updateDataset(id, { name, description, cases }) {
  const db = getDb();
  const updates = [];
  const params = [];
  
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (cases !== undefined) { updates.push('cases = ?'); params.push(JSON.stringify(cases)); }
  
  updates.push("updated_at = datetime('now')");
  params.push(id);
  
  db.prepare(`UPDATE eval_datasets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getDataset(id);
}

function deleteDataset(id) {
  const db = getDb();
  db.prepare('DELETE FROM eval_datasets WHERE id = ?').run(id);
}

// ========== 评估记录 ==========

function listRuns(datasetId) {
  const db = getDb();
  if (datasetId) {
    return db.prepare('SELECT * FROM eval_runs WHERE dataset_id = ? ORDER BY created_at DESC').all(datasetId);
  }
  return db.prepare('SELECT * FROM eval_runs ORDER BY created_at DESC').all();
}

function getRun(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM eval_runs WHERE id = ?').get(id);
}

function createRun({ id, dataset_id }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO eval_runs (id, dataset_id, status, started_at)
    VALUES (?, ?, 'running', datetime('now'))
  `).run(id, dataset_id);
  return getRun(id);
}

function updateRun(id, { status, duration_ms, results, report }) {
  const db = getDb();
  const updates = [];
  const params = [];
  
  if (status) { updates.push('status = ?'); params.push(status); }
  if (status === 'done' || status === 'error') { updates.push("finished_at = datetime('now')"); }
  if (duration_ms !== undefined) { updates.push('duration_ms = ?'); params.push(duration_ms); }
  if (results !== undefined) { updates.push('results = ?'); params.push(JSON.stringify(results)); }
  if (report !== undefined) { updates.push('report = ?'); params.push(JSON.stringify(report)); }
  
  params.push(id);
  db.prepare(`UPDATE eval_runs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getRun(id);
}

module.exports = {
  listDatasets,
  getDataset,
  createDataset,
  updateDataset,
  deleteDataset,
  listRuns,
  getRun,
  createRun,
  updateRun
};
