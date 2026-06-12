// input: 测试意图和验收条件
// output: Gene 对象（稳定的测试意图）
// position: GEP 基因层 - 把用例提炼成"测试意图 + 验收条件"

/**
 * Gene 是 GEP 的最底层抽象
 * 不关心具体步骤，只关心"要验证什么"和"怎么算通过"
 * 
 * 示例：
 * {
 *   id: "gene_login_success",
 *   intent: "验证正确账号密码能成功登录",
 *   acceptance: [
 *     "跳转到首页",
 *     "显示用户昵称",
 *     "导航栏出现退出按钮"
 *   ],
 *   tags: ["登录", "认证", "P0"],
 *   module: "用户体系"
 * }
 */

const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, '../../data/brain.db'));
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS genes (
      id TEXT PRIMARY KEY,
      intent TEXT NOT NULL,
      acceptance TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      module TEXT,
      priority TEXT DEFAULT 'P1',
      preconditions TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capsules (
      id TEXT PRIMARY KEY,
      gene_id TEXT NOT NULL,
      path TEXT NOT NULL,
      env_fingerprint TEXT NOT NULL,
      status TEXT DEFAULT 'success',
      duration_ms INTEGER DEFAULT 0,
      screenshot_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (gene_id) REFERENCES genes(id)
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_id TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT DEFAULT '{}',
      confidence REAL DEFAULT 0.8,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_id TEXT NOT NULL,
      capsule_id TEXT,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL,
      steps_log TEXT DEFAULT '[]',
      insights_gained TEXT DEFAULT '[]',
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_capsules_gene ON capsules(gene_id);
    CREATE INDEX IF NOT EXISTS idx_insights_gene ON insights(gene_id);
    CREATE INDEX IF NOT EXISTS idx_logs_gene ON execution_logs(gene_id);
  `);
}

/**
 * 创建 Gene
 */
function createGene(data) {
  const db = getDb();
  const id = data.id || `gene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  db.prepare(`
    INSERT INTO genes (id, intent, acceptance, tags, module, priority, preconditions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.intent,
    JSON.stringify(data.acceptance || []),
    JSON.stringify(data.tags || []),
    data.module || '',
    data.priority || 'P1',
    data.preconditions || ''
  );

  return getGeneById(id);
}

/**
 * 获取 Gene
 */
function getGeneById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM genes WHERE id = ?').get(id);
  if (row) {
    row.acceptance = JSON.parse(row.acceptance || '[]');
    row.tags = JSON.parse(row.tags || '[]');
  }
  return row;
}

/**
 * 获取所有 Gene
 */
function getAllGenes(options = {}) {
  const db = getDb();
  const { module: moduleFilter, limit = 100 } = options;

  let sql = 'SELECT * FROM genes';
  const params = [];

  if (moduleFilter) {
    sql += ' WHERE module = ?';
    params.push(moduleFilter);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return rows.map(row => ({
    ...row,
    acceptance: JSON.parse(row.acceptance || '[]'),
    tags: JSON.parse(row.tags || '[]'),
  }));
}

/**
 * 更新 Gene
 */
function updateGene(id, updates) {
  const db = getDb();
  const sets = [];
  const params = [];

  if (updates.intent !== undefined) { sets.push('intent = ?'); params.push(updates.intent); }
  if (updates.acceptance !== undefined) { sets.push('acceptance = ?'); params.push(JSON.stringify(updates.acceptance)); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
  if (updates.module !== undefined) { sets.push('module = ?'); params.push(updates.module); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); params.push(updates.priority); }

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE genes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getGeneById(id);
}

/**
 * 删除 Gene
 */
function deleteGene(id) {
  const db = getDb();
  // 删除关联数据
  db.prepare('DELETE FROM capsules WHERE gene_id = ?').run(id);
  db.prepare('DELETE FROM insights WHERE gene_id = ?').run(id);
  db.prepare('DELETE FROM execution_logs WHERE gene_id = ?').run(id);
  db.prepare('DELETE FROM genes WHERE id = ?').run(id);
  return { success: true };
}

/**
 * 从测试用例提取 Gene
 */
function extractGeneFromTestCase(testCase) {
  return {
    id: testCase.id || undefined,
    intent: testCase.title || testCase.intent,
    acceptance: testCase.expected ? [testCase.expected] : (testCase.acceptance || []),
    tags: [testCase.priority || 'P1', testCase.category || '未分类'],
    module: testCase.category || '',
    priority: testCase.priority || 'P1',
    preconditions: testCase.preconditions || '',
  };
}

module.exports = {
  createGene,
  getGeneById,
  getAllGenes,
  updateGene,
  deleteGene,
  extractGeneFromTestCase,
};
