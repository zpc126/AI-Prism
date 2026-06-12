// input: 会话数据
// output: 会话 CRUD 操作
// position: 会话存储模块

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'sessions.db');

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
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      requirement TEXT NOT NULL,
      categories TEXT DEFAULT '[]',
      mind_map TEXT,
      status TEXT DEFAULT 'completed',
      case_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);
}

/**
 * 创建会话
 */
function createSession(data) {
  const db = getDb();
  const { id, title, requirement, categories, mindMap, caseCount } = data;
  
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, requirement, categories, mind_map, case_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  
  stmt.run(
    id,
    title || generateTitle(requirement),
    requirement,
    JSON.stringify(categories || []),
    mindMap ? JSON.stringify(mindMap) : null,
    caseCount || 0
  );
  
  return getSessionById(id);
}

/**
 * 获取单个会话
 */
function getSessionById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  
  return {
    id: row.id,
    title: row.title,
    requirement: row.requirement,
    categories: JSON.parse(row.categories || '[]'),
    mindMap: row.mind_map ? JSON.parse(row.mind_map) : null,
    status: row.status,
    caseCount: row.case_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * 获取所有会话
 */
function getAllSessions(options = {}) {
  const db = getDb();
  const { limit = 50, offset = 0 } = options;
  
  const rows = db.prepare(`
    SELECT * FROM sessions 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    requirement: row.requirement,
    categories: JSON.parse(row.categories || '[]'),
    mindMap: row.mind_map ? JSON.parse(row.mind_map) : null,
    status: row.status,
    caseCount: row.case_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * 更新会话
 */
function updateSession(id, updates) {
  const db = getDb();
  const sets = [];
  const params = [];
  
  if (updates.title !== undefined) {
    sets.push('title = ?');
    params.push(updates.title);
  }
  if (updates.categories !== undefined) {
    sets.push('categories = ?');
    params.push(JSON.stringify(updates.categories));
  }
  if (updates.mindMap !== undefined) {
    sets.push('mind_map = ?');
    params.push(JSON.stringify(updates.mindMap));
  }
  if (updates.caseCount !== undefined) {
    sets.push('case_count = ?');
    params.push(updates.caseCount);
  }
  if (updates.status !== undefined) {
    sets.push('status = ?');
    params.push(updates.status);
  }
  
  sets.push("updated_at = datetime('now')");
  params.push(id);
  
  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getSessionById(id);
}

/**
 * 删除会话
 */
function deleteSession(id) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return { success: true };
}

/**
 * 生成标题
 */
function generateTitle(requirement) {
  if (!requirement) return '未命名会话';
  // 取前30个字符作为标题
  const title = requirement.substring(0, 30).replace(/\n/g, ' ');
  return title.length < requirement.length ? title + '...' : title;
}

/**
 * 获取会话统计
 */
function getSessionStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  const totalCases = db.prepare('SELECT SUM(case_count) as total FROM sessions').get().total || 0;
  
  return { total, totalCases };
}

module.exports = {
  createSession,
  getSessionById,
  getAllSessions,
  updateSession,
  deleteSession,
  getSessionStats
};
