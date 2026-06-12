const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const CASES_FILE = path.join(DATA_DIR, 'cases.json');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 加载用例
function loadCases() {
  ensureDataDir();
  if (!fs.existsSync(CASES_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(CASES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('加载用例失败:', error);
    return [];
  }
}

// 保存用例
function saveCases(cases) {
  ensureDataDir();
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2), 'utf-8');
}

// 添加用例
function addCases(newCases) {
  const cases = loadCases();
  cases.push(...newCases);
  saveCases(cases);
  return cases;
}

// 更新用例状态
function updateCaseStatus(caseId, status, result = null) {
  const cases = loadCases();
  const index = cases.findIndex(c => c.id === caseId);
  if (index !== -1) {
    cases[index].status = status;
    cases[index].lastResult = result;
    cases[index].lastRun = new Date().toISOString();
    saveCases(cases);
  }
  return cases;
}

module.exports = { loadCases, saveCases, addCases, updateCaseStatus };
