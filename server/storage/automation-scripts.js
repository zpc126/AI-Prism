// input: 已成功执行的测试用例和浏览器动作
// output: 带 locator、守卫、校验和导出包的可复用自动化脚本
// position: 自动化脚本库数据层，管理脚本 DSL v2

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
        schema_version INTEGER DEFAULT 1,
        page_guard TEXT DEFAULT '{}',
        steps TEXT NOT NULL DEFAULT '[]',
        expected TEXT DEFAULT '',
        post_check TEXT DEFAULT '{}',
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
    migrateAutomationScripts(db);
  }
  return db;
}

function migrateAutomationScripts(database) {
  const columns = database.prepare('PRAGMA table_info(automation_scripts)').all().map(column => column.name);
  const migrations = [
    ['schema_version', 'ALTER TABLE automation_scripts ADD COLUMN schema_version INTEGER DEFAULT 1'],
    ['page_guard', "ALTER TABLE automation_scripts ADD COLUMN page_guard TEXT DEFAULT '{}'"],
    ['post_check', "ALTER TABLE automation_scripts ADD COLUMN post_check TEXT DEFAULT '{}'"],
  ];
  migrations.forEach(([name, sql]) => {
    if (!columns.includes(name)) database.exec(sql);
  });
}

function buildCaseKey(testCase = {}) {
  const identity = [
    testCase.productName || '',
    testCase.moduleName || testCase.category || '',
    testCase.title || '',
  ].map(value => String(value).trim().toLowerCase()).join('::');
  return crypto.createHash('sha1').update(identity).digest('hex');
}

function safeJsonParse(value, fallback) {
  try {
    if (value === undefined || value === null || value === '') return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeScriptAction(action) {
  const raw = String(action || '').trim().toLowerCase();
  const aliases = {
    goto: 'navigate',
    go_to: 'navigate',
    open: 'navigate',
    visit: 'navigate',
    input: 'fill',
    type: 'fill',
    set_value: 'fill',
    tap: 'click',
    press: 'click',
    assert: 'assert_text',
    verify: 'assert_text',
    check_text: 'assert_text',
    screenshot: 'screenshot',
  };
  return aliases[raw] || raw || 'click';
}

function normalizeScriptStep(step = {}) {
  if (typeof step === 'string') {
    return {
      schemaVersion: 2,
      action: 'click',
      target: step,
      value: '',
      legacyText: step,
    };
  }

  const action = normalizeScriptAction(step.action || step.type || step.command);
  const target = step.target
    ?? step.url
    ?? step.selector
    ?? step.text
    ?? step.label
    ?? step.name
    ?? step.desc
    ?? '';
  const value = step.value ?? step.input ?? step.content ?? step.textValue ?? '';

  return {
    ...step,
    schemaVersion: step.schemaVersion || 2,
    action,
    target: String(target || ''),
    value: value === undefined || value === null ? '' : String(value),
  };
}

function parseScript(row) {
  if (!row) return null;
  const steps = safeJsonParse(row.steps, []);
  return {
    ...row,
    enabled: Boolean(row.enabled),
    schemaVersion: Number(row.schema_version || 1),
    pageGuard: safeJsonParse(row.page_guard, {}),
    steps: Array.isArray(steps) ? steps.map(normalizeScriptStep) : [],
    postCheck: safeJsonParse(row.post_check, {}),
    sourceCase: safeJsonParse(row.source_case, {}),
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

  const normalizedSteps = steps.map(normalizeScriptStep);
  const pageGuard = testCase.pageGuard || {};
  database.prepare(`
    INSERT INTO automation_scripts (
      id, case_key, name, product_name, module_name, schema_version,
      page_guard, steps, expected, post_check, source_case, enabled,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(case_key) DO UPDATE SET
      name = excluded.name,
      product_name = excluded.product_name,
      module_name = excluded.module_name,
      schema_version = excluded.schema_version,
      page_guard = excluded.page_guard,
      steps = excluded.steps,
      expected = excluded.expected,
      post_check = excluded.post_check,
      source_case = excluded.source_case,
      enabled = 1,
      updated_at = datetime('now')
  `).run(
    id,
    caseKey,
    testCase.title || '未命名脚本',
    testCase.productName || '',
    testCase.moduleName || testCase.category || '',
    JSON.stringify(pageGuard),
    JSON.stringify(normalizedSteps),
    testCase.expected || '',
    JSON.stringify(testCase.postCheck || {}),
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
      schema_version = ?,
      page_guard = ?,
      steps = ?,
      expected = ?,
      post_check = ?,
      source_case = ?,
      enabled = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updates.name ?? current.name,
    updates.productName ?? current.product_name,
    updates.moduleName ?? current.module_name,
    updates.schemaVersion ?? current.schemaVersion ?? 2,
    JSON.stringify(updates.pageGuard ?? current.pageGuard ?? {}),
    JSON.stringify((updates.steps ?? current.steps).map(normalizeScriptStep)),
    updates.expected ?? current.expected,
    JSON.stringify(updates.postCheck ?? current.postCheck ?? {}),
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

function toScriptPackageItem(script) {
  const sourceCase = script.sourceCase || {};
  return {
    schemaVersion: Math.max(Number(script.schemaVersion || 1), 2),
    id: script.id,
    caseKey: script.case_key || '',
    name: script.name || '',
    productName: script.product_name || '',
    moduleName: script.module_name || '',
    owner: sourceCase.owner || '',
    tags: normalizeStringArray(sourceCase.tags),
    env: normalizeStringArray(sourceCase.env),
    sourceCase,
    pageGuard: script.pageGuard || {},
    steps: (script.steps || []).map(normalizeScriptStep),
    postCheck: script.postCheck || {},
    expected: script.expected || '',
    dataPolicy: sourceCase.dataPolicy || 'none',
    setupRefs: normalizeStringArray(sourceCase.setupRefs),
    cleanupRefs: normalizeStringArray(sourceCase.cleanupRefs),
  };
}

function isStableForExport(script) {
  if (script.last_status === 'passed') return true;
  if (Number(script.success_count || 0) > 0) return true;
  return Number(script.schemaVersion || 1) < 2 && Number(script.run_count || 0) === 0;
}

function buildScriptExportPackage({ includeAll = false } = {}) {
  const scripts = listScripts({ limit: 5000 })
    .filter(script => script.enabled)
    .filter(script => includeAll || isStableForExport(script))
    .map(toScriptPackageItem);
  return {
    packageType: 'scout-script-package',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    exportPolicy: includeAll ? 'enabled' : 'enabled-and-last-passed',
    scripts,
  };
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
  buildScriptExportPackage,
  toScriptPackageItem,
};
