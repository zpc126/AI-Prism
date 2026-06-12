// input: 业务事件、报告数据库
// output: 首页统计数据和累计计数
// position: 统计存储模块，汇总用例生成、模型调用和执行报告数据

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'stats.db');
const REPORT_DB_PATH = path.join(DATA_DIR, 'brain.db');
const SESSION_DB_PATH = path.join(DATA_DIR, 'sessions.db');

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
    CREATE TABLE IF NOT EXISTS app_stats (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function incrementStat(key, amount = 1) {
  const database = getDb();
  database.prepare(`
    INSERT INTO app_stats (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = value + excluded.value,
      updated_at = datetime('now')
  `).run(key, Math.max(0, Number(amount) || 0));
}

function getStat(key) {
  const row = getDb().prepare('SELECT value FROM app_stats WHERE key = ?').get(key);
  return row?.value || 0;
}

function getReportStats() {
  if (!fs.existsSync(REPORT_DB_PATH)) {
    return { automationRuns: 0, automationReports: 0 };
  }

  const reportDb = new Database(REPORT_DB_PATH, { readonly: true });
  try {
    const row = reportDb.prepare(`
      SELECT
        COUNT(*) AS automationReports,
        COALESCE(SUM(total_cases), 0) AS automationRuns
      FROM test_reports
    `).get();

    return {
      automationRuns: row?.automationRuns || 0,
      automationReports: row?.automationReports || 0,
    };
  } catch (error) {
    return { automationRuns: 0, automationReports: 0 };
  } finally {
    reportDb.close();
  }
}

function getSessionStats() {
  if (!fs.existsSync(SESSION_DB_PATH)) {
    return { generatedCases: 0, modelCalls: 0, modelTokens: 0 };
  }

  const sessionDb = new Database(SESSION_DB_PATH, { readonly: true });
  try {
    const row = sessionDb.prepare(`
      SELECT
        COUNT(*) AS modelCalls,
        COALESCE(SUM(case_count), 0) AS generatedCases,
        COALESCE(SUM(LENGTH(requirement) + LENGTH(categories)), 0) AS textSize
      FROM sessions
    `).get();

    return {
      generatedCases: row?.generatedCases || 0,
      modelCalls: row?.modelCalls || 0,
      modelTokens: Math.ceil((row?.textSize || 0) / 2),
    };
  } catch (error) {
    return { generatedCases: 0, modelCalls: 0, modelTokens: 0 };
  } finally {
    sessionDb.close();
  }
}

function getHomeStats() {
  const reportStats = getReportStats();
  const sessionStats = getSessionStats();
  return {
    generatedCases: sessionStats.generatedCases + getStat('generated_cases'),
    automationRuns: reportStats.automationRuns,
    modelCalls: sessionStats.modelCalls + getStat('model_calls'),
    modelTokens: sessionStats.modelTokens + getStat('model_tokens'),
    automationReports: reportStats.automationReports,
    regressionCases: getStat('regression_cases'),
  };
}

function estimateTokens(...parts) {
  const totalLength = parts
    .filter(Boolean)
    .map(part => typeof part === 'string' ? part.length : JSON.stringify(part).length)
    .reduce((sum, length) => sum + length, 0);
  return Math.ceil(totalLength / 2);
}

module.exports = {
  incrementStat,
  getHomeStats,
  estimateTokens,
};
