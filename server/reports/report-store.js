// input: 测试执行结果数据、原始测试用例详情
// output: 测试报告存储和查询
// position: 测试报告数据层，保留执行结果与用例上下文

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

// 确保目录存在
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(path.join(DATA_DIR, 'brain.db'));
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some(column => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function normalizeBrandText(value) {
  return typeof value === 'string' ? value.replace(/Scout/g, 'Prism') : value;
}

function normalizeReport(report) {
  if (!report) return report;
  return {
    ...report,
    title: normalizeBrandText(report.title),
    requirement: normalizeBrandText(report.requirement),
  };
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      requirement TEXT,
      status TEXT DEFAULT 'running',
      total_cases INTEGER DEFAULT 0,
      passed_cases INTEGER DEFAULT 0,
      failed_cases INTEGER DEFAULT 0,
      skipped_cases INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT NOT NULL,
      case_id TEXT,
      case_title TEXT NOT NULL,
      category TEXT,
      priority TEXT,
      case_detail TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      duration_ms INTEGER DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (report_id) REFERENCES test_reports(id)
    );

    CREATE TABLE IF NOT EXISTS test_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      description TEXT NOT NULL,
      action TEXT,
      status TEXT DEFAULT 'pending',
      screenshot_path TEXT,
      error_message TEXT,
      duration_ms INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (result_id) REFERENCES test_results(id)
    );

    CREATE INDEX IF NOT EXISTS idx_results_report ON test_results(report_id);
    CREATE INDEX IF NOT EXISTS idx_steps_result ON test_steps(result_id);
  `);

  ensureColumn('test_results', 'case_detail', 'TEXT');
}

/**
 * 创建测试报告
 */
function createReport(data) {
  const db = getDb();
  const id = data.id || `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  db.prepare(`
    INSERT INTO test_reports (id, title, requirement, total_cases, started_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(id, data.title || '测试报告', data.requirement || '', data.totalCases || 0);
  
  return getReportById(id);
}

/**
 * 更新报告状态
 */
function updateReport(id, updates) {
  const db = getDb();
  const sets = [];
  const params = [];
  
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.passed_cases !== undefined) { sets.push('passed_cases = ?'); params.push(updates.passed_cases); }
  if (updates.failed_cases !== undefined) { sets.push('failed_cases = ?'); params.push(updates.failed_cases); }
  if (updates.skipped_cases !== undefined) { sets.push('skipped_cases = ?'); params.push(updates.skipped_cases); }
  if (updates.duration_ms !== undefined) { sets.push('duration_ms = ?'); params.push(updates.duration_ms); }
  if (updates.finished_at !== undefined) { sets.push('finished_at = ?'); params.push(updates.finished_at); }
  
  if (sets.length > 0) {
    params.push(id);
    db.prepare(`UPDATE test_reports SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  
  return getReportById(id);
}

/**
 * 获取报告
 */
function getReportById(id) {
  const db = getDb();
  return normalizeReport(db.prepare('SELECT * FROM test_reports WHERE id = ?').get(id));
}

/**
 * 获取所有报告
 */
function getAllReports(limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM test_reports ORDER BY created_at DESC LIMIT ?').all(limit).map(normalizeReport);
}

/**
 * 添加测试结果
 */
function addTestResult(data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO test_results (report_id, case_id, case_title, category, priority, case_detail, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now'))
  `).run(
    data.reportId,
    data.caseId,
    data.caseTitle,
    data.category,
    data.priority,
    data.caseDetail ? JSON.stringify(data.caseDetail) : null
  );
  
  return result.lastInsertRowid;
}

/**
 * 更新测试结果
 */
function updateTestResult(id, updates) {
  const db = getDb();
  const sets = [];
  const params = [];
  
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.error_message !== undefined) { sets.push('error_message = ?'); params.push(updates.error_message); }
  if (updates.duration_ms !== undefined) { sets.push('duration_ms = ?'); params.push(updates.duration_ms); }
  if (updates.finished_at !== undefined) { sets.push('finished_at = ?'); params.push(updates.finished_at); }
  
  if (sets.length > 0) {
    params.push(id);
    db.prepare(`UPDATE test_results SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
}

/**
 * 添加测试步骤
 */
function addTestStep(data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO test_steps (result_id, step_index, description, action, status, screenshot_path, error_message, duration_ms, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    data.resultId,
    data.stepIndex,
    data.description,
    data.action || '',
    data.status || 'pending',
    data.screenshotPath || null,
    data.errorMessage || null,
    data.durationMs || 0
  );
  
  return result.lastInsertRowid;
}

/**
 * 更新测试步骤
 */
function updateTestStep(id, updates) {
  const db = getDb();
  const sets = [];
  const params = [];
  
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.screenshot_path !== undefined) { sets.push('screenshot_path = ?'); params.push(updates.screenshot_path); }
  if (updates.error_message !== undefined) { sets.push('error_message = ?'); params.push(updates.error_message); }
  if (updates.duration_ms !== undefined) { sets.push('duration_ms = ?'); params.push(updates.duration_ms); }
  
  if (sets.length > 0) {
    params.push(id);
    db.prepare(`UPDATE test_steps SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
}

/**
 * 获取报告详情（含所有结果和步骤）
 */
function getReportDetail(reportId) {
  const db = getDb();
  
  const report = normalizeReport(db.prepare('SELECT * FROM test_reports WHERE id = ?').get(reportId));
  if (!report) return null;
  
  const results = db.prepare('SELECT * FROM test_results WHERE report_id = ? ORDER BY id').all(reportId);
  
  for (const result of results) {
    if (result.case_detail) {
      try {
        result.case_detail = JSON.parse(result.case_detail);
      } catch (e) {
        result.case_detail = null;
      }
    }
    result.steps = db.prepare('SELECT * FROM test_steps WHERE result_id = ? ORDER BY step_index').all(result.id);
  }
  
  report.results = results;
  return report;
}

/**
 * 删除报告
 */
function deleteReport(id) {
  const db = getDb();
  
  // 删除关联的步骤和结果
  const results = db.prepare('SELECT id FROM test_results WHERE report_id = ?').all(id);
  for (const r of results) {
    db.prepare('DELETE FROM test_steps WHERE result_id = ?').run(r.id);
  }
  db.prepare('DELETE FROM test_results WHERE report_id = ?').run(id);
  db.prepare('DELETE FROM test_reports WHERE id = ?').run(id);
  
  // 删除截图文件
  const reportDir = path.join(REPORTS_DIR, id);
  if (fs.existsSync(reportDir)) {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
  
  return { success: true };
}

/**
 * 获取报告截图目录
 */
function getReportDir(reportId) {
  const dir = path.join(REPORTS_DIR, reportId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  createReport,
  updateReport,
  getReportById,
  getAllReports,
  addTestResult,
  updateTestResult,
  addTestStep,
  updateTestStep,
  getReportDetail,
  deleteReport,
  getReportDir,
  REPORTS_DIR,
};
