// input: 已成功执行的测试用例和浏览器动作
// output: 可编辑、可复用的自动化脚本
// position: 自动化脚本库数据层

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/brain.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_scripts (
        id TEXT PRIMARY KEY,
        case_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        product_name TEXT DEFAULT '',
        module_name TEXT DEFAULT '',
        steps TEXT NOT NULL DEFAULT '[]',
        expected TEXT DEFAULT '',
        source_case TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        run_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        last_status TEXT DEFAULT '',
        last_report_id TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_automation_scripts_module
        ON automation_scripts(module_name);
      CREATE INDEX IF NOT EXISTS idx_automation_scripts_updated
        ON automation_scripts(updated_at);
    `);
  }
  return db;
}

function buildCaseKey(testCase = {}) {
  const identity = [
    testCase.productName || '',
    testCase.moduleName || testCase.category || '',
    testCase.title || '',
  ].map(value => String(value).trim().toLowerCase()).join('::');
  return crypto.createHash('sha1').update(identity).digest('hex');
}

function parseScript(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    steps: JSON.parse(row.steps || '[]'),
    sourceCase: JSON.parse(row.source_case || '{}'),
  };
}

function listScripts({ search = '', limit = 500 } = {}) {
  const database = getDb();
  const keyword = `%${search.trim()}%`;
  const rows = search.trim()
    ? database.prepare(`
        SELECT * FROM automation_scripts
        WHERE name LIKE ? OR module_name LIKE ? OR product_name LIKE ?
        ORDER BY updated_at DESC LIMIT ?
      `).all(keyword, keyword, keyword, limit)
    : database.prepare(`
        SELECT * FROM automation_scripts ORDER BY updated_at DESC LIMIT ?
      `).all(limit);
  return rows.map(parseScript);
}

function getScriptById(id) {
  return parseScript(getDb().prepare(
    'SELECT * FROM automation_scripts WHERE id = ?'
  ).get(id));
}

function getScriptForCase(testCase) {
  return parseScript(getDb().prepare(`
    SELECT * FROM automation_scripts WHERE case_key = ? AND enabled = 1
  `).get(buildCaseKey(testCase)));
}

function upsertScriptFromExecution(testCase, steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const database = getDb();
  const caseKey = buildCaseKey(testCase);
  const existing = database.prepare(
    'SELECT id FROM automation_scripts WHERE case_key = ?'
  ).get(caseKey);
  const id = existing?.id || `script_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const sourceCase = {
    ...testCase,
    steps: Array.isArray(testCase.steps) ? testCase.steps : [],
  };

  database.prepare(`
    INSERT INTO automation_scripts (
      id, case_key, name, product_name, module_name, steps, expected,
      source_case, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(case_key) DO UPDATE SET
      name = excluded.name,
      product_name = excluded.product_name,
      module_name = excluded.module_name,
      steps = excluded.steps,
      expected = excluded.expected,
      source_case = excluded.source_case,
      enabled = 1,
      updated_at = datetime('now')
  `).run(
    id,
    caseKey,
    testCase.title || '未命名脚本',
    testCase.productName || '',
    testCase.moduleName || testCase.category || '',
    JSON.stringify(steps),
    testCase.expected || '',
    JSON.stringify(sourceCase)
  );
  return getScriptById(existing?.id || id);
}

function updateScript(id, updates = {}) {
  const current = getScriptById(id);
  if (!current) return null;
  const sourceCase = {
    ...current.sourceCase,
    title: updates.name ?? current.name,
    productName: updates.productName ?? current.product_name,
    moduleName: updates.moduleName ?? current.module_name,
    category: updates.moduleName ?? current.module_name,
    expected: updates.expected ?? current.expected,
  };

  getDb().prepare(`
    UPDATE automation_scripts SET
      name = ?,
      product_name = ?,
      module_name = ?,
      steps = ?,
      expected = ?,
      source_case = ?,
      enabled = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updates.name ?? current.name,
    updates.productName ?? current.product_name,
    updates.moduleName ?? current.module_name,
    JSON.stringify(updates.steps ?? current.steps),
    updates.expected ?? current.expected,
    JSON.stringify(sourceCase),
    updates.enabled === undefined ? Number(current.enabled) : Number(Boolean(updates.enabled)),
    id
  );
  return getScriptById(id);
}

function recordScriptRun(id, { success, reportId = '' }) {
  getDb().prepare(`
    UPDATE automation_scripts SET
      run_count = run_count + 1,
      success_count = success_count + ?,
      last_status = ?,
      last_report_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(success ? 1 : 0, success ? 'passed' : 'failed', reportId, id);
}

function deleteScript(id) {
  return getDb().prepare('DELETE FROM automation_scripts WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  buildCaseKey,
  listScripts,
  getScriptById,
  getScriptForCase,
  upsertScriptFromExecution,
  updateScript,
  recordScriptRun,
  deleteScript,
};
