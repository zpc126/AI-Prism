// input: Web 探索任务配置、动作/时长策略、执行日志、覆盖结果与问题证据
// output: 兼容限次和持续模式的 AI 探索历史记录
// position: 探索测试数据层，复用 Prism brain.db 持久化运行结果并迁移旧表

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
      CREATE TABLE IF NOT EXISTS exploration_runs (
        id TEXT PRIMARY KEY,
        target_url TEXT NOT NULL,
        scope TEXT DEFAULT '',
        read_only INTEGER DEFAULT 1,
        max_actions INTEGER DEFAULT 24,
        continuous INTEGER DEFAULT 0,
        max_duration_minutes INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        summary TEXT DEFAULT '',
        coverage TEXT DEFAULT '[]',
        findings TEXT DEFAULT '[]',
        reusable_flows TEXT DEFAULT '[]',
        actions TEXT DEFAULT '[]',
        screenshots TEXT DEFAULT '[]',
        logs TEXT DEFAULT '[]',
        error_message TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        completed_at TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_exploration_runs_created
        ON exploration_runs(created_at DESC);
    `);
    migrateExplorationRuns(db);
  }
  return db;
}

function migrateExplorationRuns(database) {
  const columns = database.prepare('PRAGMA table_info(exploration_runs)').all().map(column => column.name);
  const migrations = [
    ['continuous', 'ALTER TABLE exploration_runs ADD COLUMN continuous INTEGER DEFAULT 0'],
    ['max_duration_minutes', 'ALTER TABLE exploration_runs ADD COLUMN max_duration_minutes INTEGER'],
  ];
  migrations.forEach(([name, sql]) => {
    if (!columns.includes(name)) database.exec(sql);
  });
}

function safeJsonParse(value, fallback = []) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function parseRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    targetUrl: row.target_url,
    scope: row.scope || '',
    readOnly: Boolean(row.read_only),
    maxActions: row.max_actions,
    continuous: Boolean(row.continuous),
    maxDurationMinutes: row.max_duration_minutes || null,
    status: row.status,
    summary: row.summary || '',
    coverage: safeJsonParse(row.coverage),
    findings: safeJsonParse(row.findings),
    reusableFlows: safeJsonParse(row.reusable_flows),
    actions: safeJsonParse(row.actions),
    screenshots: safeJsonParse(row.screenshots),
    logs: safeJsonParse(row.logs),
    errorMessage: row.error_message || '',
    createdAt: row.created_at,
    completedAt: row.completed_at || '',
  };
}

function createRun(input = {}) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO exploration_runs (
      id, target_url, scope, read_only, max_actions, continuous, max_duration_minutes, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
  `).run(
    id,
    input.targetUrl,
    input.scope || '',
    input.readOnly === false ? 0 : 1,
    input.maxActions || 24,
    input.continuous ? 1 : 0,
    input.maxDurationMinutes || null,
    createdAt,
  );
  return getRun(id);
}

function completeRun(id, result = {}) {
  const completedAt = new Date().toISOString();
  getDb().prepare(`
    UPDATE exploration_runs
    SET status = 'completed', summary = ?, coverage = ?, findings = ?, reusable_flows = ?,
        actions = ?, screenshots = ?, logs = ?, error_message = '', completed_at = ?
    WHERE id = ?
  `).run(
    result.summary || '',
    JSON.stringify(result.coverage || []),
    JSON.stringify(result.findings || []),
    JSON.stringify(result.reusableFlows || []),
    JSON.stringify(result.actions || []),
    JSON.stringify(result.screenshots || []),
    JSON.stringify(result.logs || []),
    completedAt,
    id,
  );
  return getRun(id);
}

function failRun(id, error, result = {}) {
  const completedAt = new Date().toISOString();
  const status = result.stopped ? 'stopped' : 'failed';
  getDb().prepare(`
    UPDATE exploration_runs
    SET status = ?, summary = ?, coverage = ?, findings = ?, reusable_flows = ?,
        actions = ?, screenshots = ?, logs = ?, error_message = ?, completed_at = ?
    WHERE id = ?
  `).run(
    status,
    result.summary || '',
    JSON.stringify(result.coverage || []),
    JSON.stringify(result.findings || []),
    JSON.stringify(result.reusableFlows || []),
    JSON.stringify(result.actions || []),
    JSON.stringify(result.screenshots || []),
    JSON.stringify(result.logs || []),
    String(error?.message || error || '探索失败'),
    completedAt,
    id,
  );
  return getRun(id);
}

function getRun(id) {
  return parseRun(getDb().prepare('SELECT * FROM exploration_runs WHERE id = ?').get(id));
}

function listRuns(limit = 30) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  return getDb().prepare(`
    SELECT * FROM exploration_runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(normalizedLimit).map(parseRun);
}

module.exports = {
  createRun,
  completeRun,
  failRun,
  getRun,
  listRuns,
};
