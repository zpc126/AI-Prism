// input: 同源 Web API、canvas.js、手工 Bug 草稿、图片附件/粘贴截图、AI 完善请求、本地与服务端历史分析报告
// output: 视图切换、分析流程、支持图片和粘贴截图的 AI 完善提 Bug、思维导图数据、可恢复的历史分析报告展示
// position: Web 前端主逻辑，连接 UI 和后端 API

const API_BASE = '/api';

//#region debug-point h264-webcodecs-mirror-front
const DEBUG_H264_MIRROR_URL = 'http://127.0.0.1:7777/event';
function reportH264MirrorDebug(event, data = {}) {
  try {
    fetch(DEBUG_H264_MIRROR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'h264-webcodecs-mirror',
        runId: 'pre',
        hypothesisId: data.hypothesisId || 'front',
        event,
        timestamp: new Date().toISOString(),
        data
      }),
      keepalive: true
    }).catch(() => {});
  } catch (_) {}
}
//#endregion debug-point h264-webcodecs-mirror-front

const state = {
  currentView: 'input',
  requirement: '',
  cases: [],
  categories: [],
  mindMap: null,
  canvas: null,
  isAnalyzing: false,
  thinkQueue: [],
  isThinking: false,
  currentSessionId: null,
  selectedCategory: null,
  chatHistory: [],
  uploadedFiles: [], // 上传的文件
  rootTitle: '',
  projectName: '',
  requirementName: '',
  requirementVersion: 'V1.0',
  activeTab: 'cases' // 当前激活的 Tab
};

// 全局函数：移除上传的文件
window.removeFile = function(fileId) {
  if (window.event) window.event.stopPropagation();
  // 从状态中移除
  const file = state.uploadedFiles.find(f => f.id === fileId);
  state.uploadedFiles = state.uploadedFiles.filter(f => f.id !== fileId);
  state.rootTitle = '';
  
  // 如果文件有文本，从输入框中移除
  if (file && file.text) {
    const currentText = input.value;
    const newText = currentText.replace(file.text, '').trim();
    input.value = newText;
    state.requirement = newText;
  }
  
  // 从 DOM 中移除
  const el = document.getElementById(fileId);
  if (el) el.remove();
  
  // 隐藏上传区域（如果没有文件）
  if (state.uploadedFiles.length === 0) {
    const area = document.getElementById('file-upload-area');
    if (area) area.classList.add('hidden');
  }
  updateStartButton();
};

window.openUploadedFilePreview = function(fileId) {
  const file = state.uploadedFiles.find(f => f.id === fileId);
  if (!file) return;

  const previewSrc = file.base64 || file.previewSrc || '';
  const canPreviewImage = Boolean(previewSrc && (file.type === 'image' || file.visionInput || file.visionSource));
  const title = file.filename || '文件预览';
  const sourceLabel = file.visionSource === 'html-screenshot'
    ? 'HTML 渲染截图'
    : file.visionSource === 'html-bundle-screenshot'
      ? `HTML 原型包截图${file.renderedPage ? ` · ${file.renderedPage}` : ''}`
      : file.type === 'image'
        ? '原图'
        : '文本预览';

  const modal = document.createElement('div');
  modal.className = 'upload-preview-modal fixed inset-0 bg-black/35 backdrop-blur-sm z-[270] flex items-center justify-center p-5';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl border border-zinc-100 shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
      <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
        <div class="min-w-0">
          <div class="text-sm font-medium text-zinc-800 truncate">${escapeHtml(title)}</div>
          <div class="text-xs text-zinc-400 mt-0.5">${escapeHtml(sourceLabel)}${file.screenshot ? ` · ${file.screenshot.width || '-'}×${file.screenshot.height || '-'}` : ''}</div>
        </div>
        <button class="close-upload-preview text-zinc-400 hover:text-zinc-700 px-2 py-1 rounded-lg">关闭</button>
      </div>
      <div class="flex-1 overflow-auto bg-zinc-50 p-5">
        ${canPreviewImage ? `
          <img src="${previewSrc}" alt="${escapeHtml(title)}" class="mx-auto rounded-xl border border-zinc-200 bg-white shadow-sm max-w-none" style="max-height:none;" />
        ` : `
          <pre class="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-600 bg-white border border-zinc-100 rounded-xl p-4">${escapeHtml(file.text || '暂无可预览内容')}</pre>
        `}
        ${file.textFallback ? `
          <details class="mt-4 bg-white border border-zinc-100 rounded-xl p-4">
            <summary class="cursor-pointer text-xs text-zinc-500">查看辅助抽取文本</summary>
            <pre class="mt-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-500">${escapeHtml(file.textFallback)}</pre>
          </details>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close-upload-preview')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.remove();
  });
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const ANALYSIS_HISTORY_KEY = 'prism_analysis_reports';
const BUG_ISSUE_TEMPLATE = `# Bug

> 记录缺陷、错误行为或回归问题。若它属于 CR / INC / DEV case，请挂到对应父 case / epic 下。

## 摘要

<!-- 一句话说明哪里坏了。 -->

## 当前行为

<!-- 实际发生了什么。附截图、日志、接口响应、单号或 pipeline 链接。 -->

## 期望行为

<!-- 正常情况下应该是什么结果。 -->

## 复现步骤

1.
2.
3.

## 影响范围

| 字段 | 内容 |
| --- | --- |
| 严重度 | P0 / P1 / P2 / P3 / 待确认 |
| 影响用户 / 现场 |  |
| 影响仓库 / 服务 |  |
| 数据风险 | 无 / 读失败 / 写失败 / 错写 / 待确认 |

## 证据

<!-- 日志、截图、trace ID、配置、MR、发布 tag、测试用例链接。 -->

## 父 case / epic

<!-- 如果该 bug 属于某个 CR / INC / DEV case，在这里贴链接。 -->

## 验证信号

<!-- 用什么事实判断 bug 已修复。 -->`;
let analysisHistorySyncPromise = null;

function getAnalysisHistory() {
  try {
    const reports = JSON.parse(localStorage.getItem(ANALYSIS_HISTORY_KEY) || '[]');
    return Array.isArray(reports) ? reports : [];
  } catch {
    return [];
  }
}

function saveAnalysisHistory(report) {
  const reports = getAnalysisHistory();
  reports.unshift(report);
  localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(reports));
  updateAnalysisHistoryEntry();
}

function updateAnalysisHistoryReport(updatedReport) {
  const normalized = normalizeAnalysisHistoryReport(updatedReport);
  const reports = getAnalysisHistory();
  const index = reports.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    reports[index] = { ...reports[index], ...normalized };
  } else {
    reports.unshift(normalized);
  }
  localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(reports));
  updateAnalysisHistoryEntry();
  return normalized;
}

function saveAnalysisHistoryList(reports) {
  localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(reports));
}

function mergeAnalysisHistoryReports(localReports = [], incomingReports = []) {
  const byId = new Map();
  [...localReports, ...incomingReports]
    .map(normalizeAnalysisHistoryReport)
    .forEach(report => {
      if (!report.id) return;
      byId.set(report.id, { ...(byId.get(report.id) || {}), ...report });
    });
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function syncAnalysisHistoryFromServer() {
  if (analysisHistorySyncPromise) return analysisHistorySyncPromise;
  analysisHistorySyncPromise = fetch(`${API_BASE}/analysis-reports`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      const serverReports = Array.isArray(data.reports) ? data.reports : [];
      const merged = mergeAnalysisHistoryReports(getAnalysisHistory(), serverReports);
      saveAnalysisHistoryList(merged);
      return merged;
    })
    .finally(() => {
      analysisHistorySyncPromise = null;
    });
  return analysisHistorySyncPromise;
}

function normalizeAnalysisHistoryReport(report = {}) {
  const normalizedReport = normalizeAnalysisReportPayload(report.report || report);
  return {
    id: report.id || `analysis-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: report.title || '需求分析报告',
    createdAt: report.createdAt || report.time || report.date || new Date().toISOString(),
    summary: report.summary || normalizedReport.summary || '',
    requirement: report.requirement || report.source || '',
    plainText: report.plainText || report.content || report.text || report.markdown || report.rawText || report.raw || '',
    moduleCount: report.moduleCount ?? normalizedReport.modules.length,
    riskCount: report.riskCount ?? normalizedReport.cases.filter(c => c.category !== '待确认').length,
    questionCount: report.questionCount ?? normalizedReport.questions.length,
    report: normalizedReport
  };
}

function normalizeAnalysisReportPayload(payload = {}) {
  const source = unwrapAnalysisPayload(payload);
  const modules = normalizeAnalysisModules(source.modules || source.moduleList || []);
  const risks = collectAnalysisRisks(source);
  const cases = risks.map(normalizeAnalysisRisk);
  const questions = normalizeAnalysisQuestions(source.questions || cases
    .filter(c => c.category === '待确认')
    .map(c => c.title));
  return {
    type: source.type || 'analysis',
    name: source.name || '需求分析',
    summary: source.summary || source.overview || '',
    modules,
    testScope: source.testScope && typeof source.testScope === 'object'
      ? source.testScope
      : { inScope: [], outOfScope: [] },
    questions,
    acceptance: Array.isArray(source.acceptance) ? source.acceptance : [],
    testStrategy: Array.isArray(source.testStrategy) ? source.testStrategy : [],
    cases
  };
}

function unwrapAnalysisPayload(payload = {}) {
  const parsed = parseAnalysisMaybeJson(payload);
  const queue = [parsed];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    if (typeof current === 'object') seen.add(current);

    if (Array.isArray(current)) {
      const analysisItem = current.find(item => item?.type === 'analysis')
        || current.find(hasAnalysisSignals)
        || (current.some(item => item?.title || item?.caseName) ? { cases: current } : null);
      if (analysisItem) return unwrapAnalysisPayload(analysisItem);
      continue;
    }

    if (typeof current !== 'object') continue;
    if (Array.isArray(current.categories)) queue.push(current.categories);
    ['report', 'analysis', 'data', 'result', 'payload'].forEach(key => {
      if (current[key] && current[key] !== current) queue.push(parseAnalysisMaybeJson(current[key]));
    });
    if (hasAnalysisSignals(current)) return current;
  }

  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function parseAnalysisMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function hasAnalysisSignals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(
    value.type === 'analysis' ||
    value.summary ||
    value.overview ||
    value.modules ||
    value.moduleList ||
    value.cases ||
    value.risks ||
    value.issues ||
    value.questions ||
    value.acceptance ||
    value.testStrategy ||
    value.testScope
  );
}

function collectAnalysisRisks(source = {}) {
  if (Array.isArray(source.cases)) return source.cases;
  if (Array.isArray(source.risks)) return source.risks;
  if (Array.isArray(source.issues)) return source.issues;
  if (Array.isArray(source.categories)) {
    const analysis = source.categories.find(item => item?.type === 'analysis') || source.categories.find(hasAnalysisSignals);
    if (analysis) return collectAnalysisRisks(analysis);
    return source.categories.flatMap(category => (category?.cases || []).map(item => ({
      ...item,
      category: item.category || category.name || category.type || '风险'
    })));
  }
  return [];
}

function normalizeAnalysisModules(modules) {
  if (!Array.isArray(modules)) return [];
  return modules.map(module => {
    if (typeof module === 'string') {
      return { name: module, goal: '', flows: [], rules: [], data: [] };
    }
    return {
      name: module.name || module.module || module.title || '未命名模块',
      goal: module.goal || module.description || '',
      flows: Array.isArray(module.flows) ? module.flows : [],
      rules: Array.isArray(module.rules) ? module.rules : [],
      data: Array.isArray(module.data) ? module.data : []
    };
  });
}

function normalizeAnalysisRisk(item = {}, index = 0) {
  const steps = Array.isArray(item.steps)
    ? item.steps
    : [item.detail || item.description || item.testFocus || ''].filter(Boolean);
  return {
    ...item,
    id: item.id || `analysis-risk-${index + 1}`,
    title: item.title || item.name || `风险 ${index + 1}`,
    priority: item.priority || item.severity || 'P1',
    category: item.category || '风险',
    steps,
    expected: item.expected || item.suggestion || '',
    testFocus: item.testFocus || ''
  };
}

function normalizeAnalysisQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map(question => {
    if (typeof question === 'string') return question;
    return question.title || question.question || question.content || '';
  }).filter(Boolean);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器拒绝复制，请手动复制链接');
}

function showManualCopyUrl(url) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/20 backdrop-blur-sm z-[260] flex items-center justify-center p-6';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl border border-zinc-100 shadow-2xl w-full max-w-xl p-5">
      <div class="flex items-center justify-between gap-4 mb-3">
        <h3 class="text-base font-medium text-zinc-800">分享链接已生成</h3>
        <button class="close-manual-copy p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">关闭</button>
      </div>
      <p class="text-xs text-zinc-400 mb-3">浏览器限制了自动复制，请手动复制下面的链接。</p>
      <input class="manual-copy-url w-full px-3 py-2 text-sm border border-zinc-200 rounded-xl text-zinc-700 bg-zinc-50" value="${escapeHtml(url)}" readonly>
    </div>
  `;
  document.body.appendChild(modal);
  const input = modal.querySelector('.manual-copy-url');
  input?.focus();
  input?.select();
  modal.querySelector('.close-manual-copy')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.remove();
  });
}

async function getManualBugIssueDefaults() {
  try {
    const response = await fetch(`${API_BASE}/gitlab/config`);
    const data = await response.json();
    return data.success ? (data.config || {}) : {};
  } catch {
    return {};
  }
}

async function showManualBugIssueModal() {
  const config = await getManualBugIssueDefaults();
  const existing = document.getElementById('manual-bug-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.bugAttachments = [];
  modal.id = 'manual-bug-modal';
  modal.className = 'fixed inset-0 bg-black/20 backdrop-blur-sm z-[240] flex items-center justify-center p-6';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl border border-zinc-100 shadow-2xl w-full max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-medium text-zinc-800">提交 Bug</h3>
          <p class="text-xs text-zinc-400 mt-1">按模板编辑后提交到当前 GitLab 项目</p>
        </div>
        <button class="manual-bug-close p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">关闭</button>
      </div>
      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <label class="block text-xs font-medium text-zinc-500 mb-1.5">简单描述</label>
          <textarea id="manual-bug-brief" class="w-full h-24 px-3 py-2 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:border-zinc-400 resize-y" placeholder="只写一句也可以，例如：点击采购需求后弹窗没出来，控制台没有明显报错。"></textarea>
        </div>
        <div>
          <label class="block text-xs font-medium text-zinc-500 mb-1.5">图片证据</label>
          <div class="flex flex-wrap items-center gap-2">
            <button id="manual-bug-pick-images" class="px-3 py-2 text-sm text-zinc-600 border border-zinc-200 rounded-xl hover:bg-zinc-50 transition-colors" type="button">添加图片</button>
            <span class="text-xs text-zinc-400">支持直接粘贴截图、报错、页面状态；AI 会读取第一张图，提交时会上传全部图片。</span>
            <input id="manual-bug-images" class="hidden" type="file" accept="image/*" multiple>
          </div>
          <div id="manual-bug-image-list" class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3"></div>
        </div>
        <div>
          <label class="block text-xs font-medium text-zinc-500 mb-1.5">标题</label>
          <input id="manual-bug-title" class="w-full px-3 py-2 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:border-zinc-400" value="[Bug] " placeholder="[Bug] 一句话说明哪里坏了">
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-zinc-500 mb-1.5">Labels</label>
            <input id="manual-bug-labels" class="w-full px-3 py-2 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:border-zinc-400" value="${escapeHtml(config.labels || 'bug,Prism')}" placeholder="bug,Prism">
          </div>
          <div>
            <label class="block text-xs font-medium text-zinc-500 mb-1.5">Assignee IDs</label>
            <input id="manual-bug-assignees" class="w-full px-3 py-2 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:border-zinc-400" value="${escapeHtml(config.assigneeIds || '')}" placeholder="多个 ID 用英文逗号分隔">
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-zinc-500 mb-1.5">描述</label>
          <textarea id="manual-bug-description" class="w-full h-[420px] px-3 py-2 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:border-zinc-400 font-mono leading-6 resize-y">${escapeHtml(BUG_ISSUE_TEMPLATE)}</textarea>
        </div>
        <div id="manual-bug-result" class="hidden text-sm rounded-xl px-3 py-2"></div>
      </div>
      <div class="px-5 py-4 border-t border-zinc-100 flex items-center justify-between gap-3 bg-zinc-50">
        <button id="manual-bug-config" class="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 rounded-lg hover:bg-white transition-colors">GitLab 配置</button>
        <div class="flex items-center gap-2">
          <button id="manual-bug-enhance" class="px-4 py-2 text-sm text-zinc-700 border border-zinc-200 rounded-lg hover:bg-white transition-colors">AI 完善</button>
          <button class="manual-bug-close px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 rounded-lg hover:bg-white transition-colors">取消</button>
          <button id="manual-bug-submit" class="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors">提交 Issue</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelectorAll('.manual-bug-close').forEach(button => button.addEventListener('click', close));
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });
  modal.querySelector('#manual-bug-config')?.addEventListener('click', () => {
    window.settingsManager?.openGitLabSettings?.();
  });
  modal.querySelector('#manual-bug-pick-images')?.addEventListener('click', () => {
    modal.querySelector('#manual-bug-images')?.click();
  });
  modal.querySelector('#manual-bug-images')?.addEventListener('change', event => {
    addManualBugImages(modal, Array.from(event.target.files || []));
    event.target.value = '';
  });
  modal.querySelector('#manual-bug-enhance')?.addEventListener('click', () => enhanceManualBugIssue(modal));
  modal.querySelector('#manual-bug-submit')?.addEventListener('click', () => submitManualBugIssue(modal));

  // 粘贴图片支持
  modal.addEventListener('paste', async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length) {
      event.preventDefault();
      await addManualBugImages(modal, imageFiles);
    }
  });

  modal.querySelector('#manual-bug-brief')?.focus();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function addManualBugImages(modal, files = []) {
  const images = files.filter(file => file.type.startsWith('image/')).slice(0, 6 - (modal.bugAttachments?.length || 0));
  if (!images.length) {
    setManualBugResult(modal, '请选择图片文件');
    return;
  }

  for (const file of images) {
    if (file.size > 8 * 1024 * 1024) {
      setManualBugResult(modal, `${file.name} 超过 8MB，已跳过`);
      continue;
    }
    try {
      const base64 = await readFileAsDataUrl(file);
      modal.bugAttachments.push({
        id: `bug-image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        filename: file.name || 'bug-image.png',
        mimeType: file.type || 'image/png',
        size: file.size,
        base64,
      });
    } catch (error) {
      setManualBugResult(modal, error.message || '图片读取失败');
    }
  }
  renderManualBugImages(modal);
}

function renderManualBugImages(modal) {
  const list = modal.querySelector('#manual-bug-image-list');
  if (!list) return;
  const attachments = modal.bugAttachments || [];
  list.innerHTML = attachments.map(item => `
    <div class="relative group border border-zinc-100 rounded-xl overflow-hidden bg-zinc-50">
      <img src="${escapeHtml(item.base64)}" alt="${escapeHtml(item.filename)}" class="w-full aspect-video object-cover">
      <div class="px-2 py-1.5 text-[11px] text-zinc-500 truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</div>
      <button class="manual-bug-remove-image absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[11px] rounded-md bg-white/90 text-zinc-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity" data-image-id="${escapeHtml(item.id)}" type="button">移除</button>
    </div>
  `).join('');
  list.querySelectorAll('.manual-bug-remove-image').forEach(button => {
    button.addEventListener('click', () => {
      modal.bugAttachments = attachments.filter(item => item.id !== button.dataset.imageId);
      renderManualBugImages(modal);
    });
  });
}

function setManualBugResult(modal, message, type = 'error') {
  const resultEl = modal.querySelector('#manual-bug-result');
  if (!resultEl) return;
  resultEl.className = `text-sm rounded-xl px-3 py-2 ${type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`;
  resultEl.textContent = message;
}

function readManualBugDraft(modal) {
  return {
    brief: modal.querySelector('#manual-bug-brief')?.value.trim() || '',
    title: modal.querySelector('#manual-bug-title')?.value.trim() || '',
    description: modal.querySelector('#manual-bug-description')?.value.trim() || '',
    labels: modal.querySelector('#manual-bug-labels')?.value.trim() || '',
    assigneeIds: modal.querySelector('#manual-bug-assignees')?.value.trim() || '',
    attachments: (modal.bugAttachments || []).map(item => ({
      filename: item.filename,
      mimeType: item.mimeType,
      base64: item.base64,
    })),
  };
}

async function enhanceManualBugIssue(modal) {
  const button = modal.querySelector('#manual-bug-enhance');
  const draft = readManualBugDraft(modal);
  const isTemplateOnly = draft.description === BUG_ISSUE_TEMPLATE;
  if (!draft.brief && !draft.attachments.length && (!draft.title || draft.title === '[Bug]') && isTemplateOnly) {
    setManualBugResult(modal, '先简单写一句 Bug 现象，或添加一张截图，我再帮你补完整');
    return;
  }

  const originalText = button?.textContent || 'AI 完善';
  if (button) {
    button.disabled = true;
    button.textContent = '完善中...';
  }

  try {
    const response = await fetch(`${API_BASE}/gitlab/issues/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'AI 完善失败');
    if (data.draft?.title) modal.querySelector('#manual-bug-title').value = data.draft.title;
    if (data.draft?.description) modal.querySelector('#manual-bug-description').value = data.draft.description;
    setManualBugResult(modal, 'AI 已完善草稿，提交前可以继续修改', 'success');
  } catch (error) {
    setManualBugResult(modal, error.message || 'AI 完善失败');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function submitManualBugIssue(modal) {
  const button = modal.querySelector('#manual-bug-submit');
  const { title, description, labels, assigneeIds, attachments } = readManualBugDraft(modal);

  if (!title || title === '[Bug]') {
    setManualBugResult(modal, '请填写 Issue 标题');
    return;
  }
  if (!description) {
    setManualBugResult(modal, '请填写 Issue 描述');
    return;
  }

  const originalText = button?.textContent || '提交 Issue';
  if (button) {
    button.disabled = true;
    button.textContent = '提交中...';
  }

  try {
    const response = await fetch(`${API_BASE}/gitlab/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, labels, assigneeIds, attachments })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '提交 GitLab Issue 失败');
    const uploadedCount = data.attachments?.uploaded?.length || 0;
    const suffix = uploadedCount ? `，已上传 ${uploadedCount} 张图片` : '';
    setManualBugResult(modal, `GitLab Issue 已创建：#${data.issue?.iid || data.issue?.id || ''}${suffix}`, 'success');
    if (data.issue?.web_url) {
      window.open(data.issue.web_url, '_blank', 'noreferrer');
    }
  } catch (error) {
    setManualBugResult(modal, error.message || '提交 GitLab Issue 失败');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function copyAnalysisReportUrl(report, button) {
  const normalizedReport = normalizeAnalysisHistoryReport(report);
  const originalText = button?.textContent || '复制链接';
  let url = '';
  try {
    if (button) button.textContent = '生成链接...';
    const response = await fetch(`${API_BASE}/analysis-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: normalizedReport })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '分享链接生成失败');
    url = new URL(data.url, window.location.origin).toString();
    await copyTextToClipboard(url);
    if (button) {
      button.textContent = '链接已复制';
      setTimeout(() => { button.textContent = originalText; }, 1600);
    }
  } catch (error) {
    if (url) {
      showManualCopyUrl(url);
      if (button) {
        button.textContent = '手动复制';
        setTimeout(() => { button.textContent = originalText; }, 1600);
      }
      return;
    }
    if (button) {
      button.textContent = '生成失败';
      setTimeout(() => { button.textContent = originalText; }, 1600);
    }
    console.error('分享链接生成失败:', error);
  }
}

function updateAnalysisHistoryEntry() {
  const button = $('#btn-analysis-history');
  if (!button) return;
  const count = getAnalysisHistory().length;
  button.classList.toggle('hidden', state.activeTab !== 'analyze');
  button.textContent = count ? `历史报告 ${count}` : '历史报告';
  syncAnalysisHistoryFromServer()
    .then(reports => {
      if (state.activeTab === 'analyze') {
        button.textContent = reports.length ? `历史报告 ${reports.length}` : '历史报告';
      }
    })
    .catch(() => {});
}

function getChatHistory() {
  return state.chatHistory;
}

function loadLegacyChatHistory(sessionId) {
  try {
    const stored = JSON.parse(localStorage.getItem('prism_chat_histories') || '{}');
    return Object.entries(stored)
      .filter(([key, messages]) => key.startsWith(`${sessionId}::`) && Array.isArray(messages))
      .flatMap(([key, messages]) => {
        const category = key.split('::').slice(1).join('::');
        return messages.map(message => ({
          role: message.role,
          content: message.content,
          category: category === '全部' ? '' : category,
          createdAt: message.createdAt || Date.now()
        }));
      })
      .sort((left, right) => left.createdAt - right.createdAt);
  } catch (error) {
    console.warn('旧对话记录迁移失败:', error.message);
    return [];
  }
}

function saveChatMessage(role, content) {
  state.chatHistory.push({
    role,
    content,
    category: state.selectedCategory || '',
    createdAt: Date.now()
  });
  queueChatHistoryPersist();
}

function queueChatHistoryPersist() {
  clearTimeout(queueChatHistoryPersist.timer);
  if (!state.currentSessionId) return;
  queueChatHistoryPersist.timer = setTimeout(async () => {
    try {
      await fetch(`${API_BASE}/sessions/${state.currentSessionId}/chat-history`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatHistory: state.chatHistory }),
        keepalive: true
      });
    } catch (error) {
      console.error('保存对话记录失败:', error);
    }
  }, 180);
}

async function persistCurrentSession() {
  const caseCount = state.categories.reduce(
    (sum, category) => sum + (category.cases?.length || 0),
    0
  );
  const payload = {
    requirement: state.requirement || getMindMapRootTitle(),
    title: state.requirementName || state.rootTitle || getMindMapRootTitle(),
    projectName: state.projectName || '',
    requirementName: state.requirementName || state.rootTitle || getMindMapRootTitle(),
    requirementVersion: state.requirementVersion || 'V1.0',
    chatHistory: state.chatHistory,
    categories: state.categories,
    mindMap: state.mindMap,
    caseCount
  };
  const isUpdate = Boolean(state.currentSessionId);
  if (!isUpdate) {
    payload.id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  const response = await fetch(
    isUpdate ? `${API_BASE}/sessions/${state.currentSessionId}` : `${API_BASE}/sessions`,
    {
      method: isUpdate ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  const data = await response.json();
  if (!response.ok || !data.success || !data.session) {
    throw new Error(data.error || '会话保存失败');
  }
  state.currentSessionId = data.session.id;
  state.projectName = data.session.projectName || state.projectName || '';
  state.requirementName = data.session.requirementName || data.session.title || state.requirementName || state.rootTitle;
  state.requirementVersion = data.session.requirementVersion || state.requirementVersion || 'V1.0';
  return data.session;
}

function applyCaseUpdate(updatedCase, { persist = true } = {}) {
  if (!updatedCase?.id) return false;

  let sourceCategory = null;
  let caseIndex = -1;
  for (const category of state.categories || []) {
    const index = (category.cases || []).findIndex(item => String(item.id) === String(updatedCase.id));
    if (index !== -1) {
      sourceCategory = category;
      caseIndex = index;
      break;
    }
  }
  if (!sourceCategory) return false;

  const currentCase = sourceCategory.cases[caseIndex];
  const mergedCase = { ...currentCase, ...updatedCase, id: currentCase.id };
  const targetCategoryName = mergedCase.category || sourceCategory.name || sourceCategory.type;

  if (targetCategoryName !== (sourceCategory.name || sourceCategory.type)) {
    sourceCategory.cases.splice(caseIndex, 1);
    let targetCategory = state.categories.find(category =>
      (category.name || category.type) === targetCategoryName
    );
    if (!targetCategory) {
      targetCategory = { type: targetCategoryName, name: targetCategoryName, cases: [] };
      state.categories.push(targetCategory);
    }
    targetCategory.cases.push(mergedCase);
    state.categories = state.categories.filter(category => (category.cases || []).length > 0);
  } else {
    sourceCategory.cases[caseIndex] = mergedCase;
  }

  state.mindMap = buildMindMap(state.categories);
  state.canvas?.setMindMap(state.mindMap);
  renderCanvasModuleNav(targetCategoryName);
  if (persist) {
    persistCurrentSession().catch(error => {
      console.error('保存用例修改失败:', error);
      addIslandMessage('system', `用例修改未保存：${error.message}`);
    });
  }
  return true;
}

function deleteCaseNode(node) {
  if (!node) return false;
  const depth = node._depth || 0;
  const deletedIds = [];

  if (depth === 1) {
    const name = node.title;
    const removedCategory = (state.categories || []).find(
      category => (category.name || category.type) === name
    );
    (removedCategory?.cases || []).forEach(item => deletedIds.push(item.id));
    const before = state.categories.length;
    state.categories = (state.categories || []).filter(
      category => (category.name || category.type) !== name
    );
    if (state.categories.length === before) return false;
  } else {
    const matched = findCaseById(node.id);
    if (!matched) return false;
    deletedIds.push(node.id);
    matched.category.cases = (matched.category.cases || []).filter(
      item => String(item.id) !== String(node.id)
    );
    state.categories = (state.categories || []).filter(
      category => (category.cases || []).length > 0
    );
  }

  deletedIds.forEach(id => {
    if (state.canvas?.state?.caseStatus) {
      delete state.canvas.state.caseStatus[id];
    }
  });
  state.canvas?.persistCaseStatus?.();
  if (depth === 1 && state.selectedCategory === node.title) {
    state.selectedCategory = null;
  }
  state.mindMap = buildMindMap(state.categories);
  state.canvas?.setMindMap(state.mindMap);
  renderCanvasModuleNav(state.selectedCategory);
  addIslandMessage('system', depth === 1 ? '模块已删除并保存' : '用例已删除并保存');
  persistCurrentSession().catch(error => {
    console.error('删除用例失败:', error);
    addIslandMessage('system', `删除未保存：${error.message}`);
  });
  return true;
}

function showDeleteCaseConfirm(node) {
  if (!node) return;
  const isModule = (node._depth || 0) === 1;
  const title = node.title || (isModule ? '当前模块' : '当前用例');
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-black/35 backdrop-blur-sm';
  modal.innerHTML = `
    <div class="w-[360px] rounded-2xl bg-white shadow-2xl border border-zinc-100 overflow-hidden">
      <div class="p-5 border-b border-zinc-100">
        <div class="text-base font-semibold text-zinc-900">${isModule ? '删除模块' : '删除用例'}</div>
        <div class="mt-2 text-sm text-zinc-500 leading-6">
          ${isModule
            ? `将删除「${escapeHtml(title)}」模块下的全部用例，删除后会立即保存。`
            : `将删除「${escapeHtml(title)}」这条用例，删除后会立即保存。`}
        </div>
      </div>
      <div class="p-4 flex justify-end gap-2 bg-zinc-50">
        <button class="delete-node-cancel px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 rounded-xl hover:bg-white">取消</button>
        <button class="delete-node-ok px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-xl">确认删除</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.delete-node-cancel')?.addEventListener('click', close);
  modal.querySelector('.delete-node-ok')?.addEventListener('click', () => {
    deleteCaseNode(node);
    close();
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });
}

function persistCanvasChatChanges() {
  state.mindMap = buildMindMap(state.categories);
  renderCanvasModuleNav(state.selectedCategory);
  persistCurrentSession().catch(error => {
    console.error('保存对话调整失败:', error);
    addIslandMessage('system', `对话调整未保存：${error.message}`);
  });
}

function findCaseById(caseId) {
  for (const category of state.categories || []) {
    const found = (category.cases || []).find(item => String(item.id) === String(caseId));
    if (found) return { caseData: found, category };
  }
  return null;
}

function findExpectedInNode(node) {
  if (!node) return '';
  if (node.type === 'expected') return node.title || '';
  for (const child of node.children || []) {
    const expected = findExpectedInNode(child);
    if (expected) return expected;
  }
  return '';
}

function hasAnalysisInput() {
  return Boolean(state.requirement || state.uploadedFiles.length > 0);
}

function updateStartButton() {
  const btnStart = $('#btn-start');
  if (btnStart) {
    btnStart.disabled = !['report', 'scripts'].includes(state.activeTab) && !hasAnalysisInput();
  }
}

function deriveRootTitle(requirement = state.requirement) {
  const imageFile = state.uploadedFiles.find(file => (file.type === 'image' || file.visionInput || file.visionSource) && file.filename);
  if (imageFile) {
    const filename = imageFile.filename.replace(/\.[^.]+$/, '').trim();
    if (filename && !/^(截图|屏幕截图|image|img|photo|微信图片|未命名)/i.test(filename)) {
      return filename;
    }
  }

  const text = String(requirement || '').trim();
  const moduleMatch = text.match(/(?:页面|模块|产品|项目)(?:\/模块)?名称\s*[:：]?\s*\n?\s*([^\n。；：:]{2,30})/);
  if (moduleMatch) return moduleMatch[1].replace(/^[#*\-\d.\s]+/, '').trim();

  const productMatch = text.match(/([\u4e00-\u9fa5A-Za-z0-9_-]{2,24}(?:工作站|系统|平台|页面|模块|应用|后台|商城|中心))/);
  if (productMatch) return productMatch[1].trim();

  const firstLine = text.split(/\n|。|；/).map(line => line.replace(/^[#*\-\d.\s]+/, '').trim()).find(Boolean);
  return firstLine && firstLine.length <= 20 ? firstLine : '测试用例';
}

function getMindMapRootTitle() {
  if (!state.rootTitle) state.rootTitle = deriveRootTitle();
  return state.rootTitle || '测试用例';
}

function updateEngineHeaderMeta() {
  const summaryEl = $('#requirement-summary');
  const metaEl = $('#requirement-meta');
  if (!summaryEl) return;

  const requirementName = state.requirementName || state.rootTitle || getMindMapRootTitle();
  const projectName = state.projectName || '';
  const version = state.requirementVersion || '';
  const mainTitle = projectName ? `${projectName} / ${requirementName}` : requirementName;
  summaryEl.textContent = mainTitle || '未命名需求';
  summaryEl.title = mainTitle || '';

  if (metaEl) {
    const metaParts = [version && `版本 ${version}`, state.currentSessionId && '已保存'].filter(Boolean);
    metaEl.textContent = metaParts.join(' · ');
    metaEl.classList.toggle('hidden', metaParts.length === 0);
  }
}

function getVisionFilesPayload() {
  return state.uploadedFiles
    .filter(file => file.base64 && (file.type === 'image' || file.visionInput || file.visionSource))
    .map(file => ({
      imageBase64: file.base64,
      filename: file.filename || file.name || '',
      sourceType: file.visionSource || file.type || '',
      contextText: file.textFallback || file.text || ''
    }));
}

function getRequirementPayloadText(fallbackText = '用户上传了视觉需求材料，请直接阅读图片/原型截图。') {
  return String(state.requirement || '').trim() || fallbackText;
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  initViewInput();
  initViewEngine();
  loadHomeStats();
  switchView('input');
});

function formatStatNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
  if (number >= 10000) return `${(number / 10000).toFixed(1).replace(/\.0$/, '')}w`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(number);
}

async function loadHomeStats() {
  try {
    const response = await fetch(`${API_BASE}/stats/home`);
    const data = await response.json();
    if (!data.success) return;
    const stats = data.stats || {};
    const pairs = {
      '#stat-generated-cases': stats.generatedCases,
      '#stat-automation-runs': stats.automationRuns,
      '#stat-model-calls': stats.modelCalls,
      '#stat-model-tokens': stats.modelTokens,
      '#stat-automation-reports': stats.automationReports,
      '#stat-regression-cases': stats.regressionCases,
    };
    Object.entries(pairs).forEach(([selector, value]) => {
      const el = $(selector);
      if (el) el.textContent = formatStatNumber(value);
    });
  } catch (error) {
    console.warn('首页统计加载失败:', error.message);
  }
}

function switchView(viewName) {
  state.currentView = viewName;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${viewName}`).classList.add('active');
  $('#canvas-module-nav')?.classList.toggle('hidden', viewName !== 'engine');
  
  if (viewName === 'engine' && !state.canvas) {
    state.canvas = new Canvas('canvas-container');
    state.canvas.onRunCase = (node) => {
      executeSingleCase(node);
    };
    
    state.canvas.onEditCase = (node) => {
      showEditCaseModal(node);
    };
    state.canvas.onDeleteCase = (node) => {
      showDeleteCaseConfirm(node);
    };
  }
  if (viewName === 'engine') renderCanvasModuleNav();
}

// ========== 视图 1: 输入 ==========
function initViewInput() {
  const input = $('#requirement-input');
  const btnStart = $('#btn-start');
  const tabDesc = $('#tab-desc');
  
  // Tab 配置
  const tabConfig = {
    cases: {
      placeholder: '粘贴需求文本、飞书文档链接、Figma 链接，或直接描述你想测什么...',
      desc: '生成结构化测试用例，输出为思维导图',
      btnText: '开始'
    },
    analyze: {
      placeholder: '粘贴需求文档，我帮你拆模块、理流程、找风险、定测试范围...',
      desc: '输出需求摘要、模块拆解、风险问题、待确认项和测试策略',
      btnText: '分析'
    },
    run: {
      placeholder: '描述你想在页面上执行的操作，比如：点击登录按钮，输入用户名...',
      desc: '用自然语言驱动浏览器，执行点击、输入等操作',
      btnText: '执行'
    },
    regression: {
      placeholder: '描述 Bug 的表现、复现步骤、期望行为...',
      desc: '根据 Bug 描述自动生成回归测试用例',
      btnText: '生成'
    },
    report: {
      placeholder: '这里会显示自动化执行产生的历史测试报告',
      desc: '查看自动化执行结果、步骤和截图',
      btnText: '查看报告'
    },
    scripts: {
      placeholder: '脚本首次成功执行后会自动进入脚本库',
      desc: '查看、编辑并直接执行已沉淀的自动化脚本',
      btnText: '打开脚本库'
    }
  };
  
  // Tab 切换
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tab = btn.dataset.tab;
      state.activeTab = tab;
      
      const config = tabConfig[tab];
      input.placeholder = config.placeholder;
      tabDesc.textContent = config.desc;
      btnStart.textContent = config.btnText;
      updateStartButton();
      updateAnalysisHistoryEntry();
    });
  });

  $('#btn-analysis-history')?.addEventListener('click', showAnalysisHistoryModal);
  updateAnalysisHistoryEntry();
  $('#btn-submit-bug')?.addEventListener('click', showManualBugIssueModal);

  input.addEventListener('input', () => {
    state.requirement = input.value.trim();
    state.rootTitle = '';
    updateStartButton();
    
    // 输入验证反馈
    const hint = $('#input-hint');
    if (hint) {
      if (state.requirement && state.requirement.length < 10) {
        hint.textContent = '内容太短，描述更多细节能生成更好的用例';
        hint.className = 'text-xs text-amber-500 mt-2 text-center';
      } else {
        hint.textContent = '';
      }
    }
  });

  // 文件上传
  state.uploadedFiles = [];
  const fileInput = $('#file-input');
  const fileUploadArea = $('#file-upload-area');
  const uploadedFiles = $('#uploaded-files');
  
  // 上传处理函数
  async function handleFileUpload(files) {
    if (files.length === 0) return;
    
    // 显示上传中状态
    fileUploadArea.classList.remove('hidden');
    
    for (const file of files) {
      const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      // 添加上传中的文件标签
      const tag = document.createElement('div');
      tag.id = fileId;
      tag.className = 'flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-xs';
      tag.innerHTML = `
        <svg class="w-3.5 h-3.5 text-zinc-400 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-zinc-600">${escapeHtml(file.name)}</span>
      `;
      uploadedFiles.appendChild(tag);
      
      // 上传文件
      try {
        const formData = new FormData();
        formData.append('file', file, file.name);
        
        const response = await fetch(`${API_BASE}/files/upload`, {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
          // 更新标签为成功状态
          const isImage = file.type.startsWith('image/');
          const isVisionDocument = Boolean(data.data.visionInput && data.data.base64);
          const previewSrc = isImage ? URL.createObjectURL(file) : data.data.base64;
          tag.className = 'flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-xs cursor-pointer hover:bg-zinc-100 transition-colors';
          tag.setAttribute('onclick', `openUploadedFilePreview('${fileId}')`);
          tag.title = '点击预览';
          tag.innerHTML = (isImage || isVisionDocument) ? `
            <img src="${previewSrc}" class="w-8 h-8 object-cover rounded" />
            <span class="text-zinc-600">${escapeHtml(file.name)}</span>
            ${isVisionDocument ? '<span class="text-[10px] text-blue-500">已转截图</span>' : ''}
            <span class="text-[10px] text-zinc-400">查看</span>
            <button class="ml-1 text-zinc-400 hover:text-zinc-600" onclick="removeFile('${fileId}')" title="移除">&times;</button>
          ` : `
            <svg class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <span class="text-zinc-600">${escapeHtml(file.name)}</span>
            <span class="text-[10px] text-zinc-400">可预览</span>
            <button class="ml-1 text-zinc-400 hover:text-zinc-600" onclick="removeFile('${fileId}')" title="移除">&times;</button>
          `;
          
          // 保存解析结果
          state.uploadedFiles.push({ id: fileId, ...data.data });
          state.rootTitle = '';
          updateStartButton();
          
          // 将解析的文本添加到输入框
          if (data.data.text && !isVisionDocument) {
            const currentText = input.value;
            const newText = currentText ? currentText + '\n\n' + data.data.text : data.data.text;
            input.value = newText;
            state.requirement = newText;
            updateStartButton();
          }
        } else {
          throw new Error(data.error);
        }
      } catch (error) {
        // 更新标签为失败状态
        tag.className = 'flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-md text-xs';
        tag.innerHTML = `
          <svg class="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
          <span class="text-red-600">${escapeHtml(file.name)}</span>
          <span class="text-red-400 text-xs">${error.message}</span>
        `;
      }
    }
    
    // 清空文件输入
    fileInput.value = '';
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFileUpload(Array.from(e.target.files));
    });
  }
  
  // 拖拽图片支持
  const requirementCard = document.querySelector('.requirement-card');
  if (requirementCard) {
    // 阻止默认行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      requirementCard.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    // 拖拽视觉反馈
    requirementCard.addEventListener('dragenter', () => {
      requirementCard.classList.add('ring-2', 'ring-zinc-300');
    });
    
    requirementCard.addEventListener('dragleave', (e) => {
      if (!requirementCard.contains(e.relatedTarget)) {
        requirementCard.classList.remove('ring-2', 'ring-zinc-300');
      }
    });
    
    requirementCard.addEventListener('drop', async (e) => {
      requirementCard.classList.remove('ring-2', 'ring-zinc-300');
      
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      
      // 直接调用上传函数
      handleFileUpload(files);
    });
  }
  
  // Prism Logo 点击进入大脑
  const scoutLogo = $('#scout-logo');
  if (scoutLogo) {
    scoutLogo.addEventListener('click', () => {
      scoutLogo.classList.add('prism-logo-clicked');
      window.setTimeout(() => {
        scoutLogo.classList.remove('prism-logo-clicked');
        switchView('brain');
        if (typeof loadBrainData === 'function') {
          loadBrainData();
        }
      }, 180);
    });
  }
  
  // 历史记录按钮
  const btnGoHistory = $('#btn-go-history');
  if (btnGoHistory) {
    btnGoHistory.addEventListener('click', (e) => {
      e.stopPropagation();
      loadSessionHistory();
    });
  }
  
  // 示例按钮 - 点击填入示例文本
  $$('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const example = btn.dataset.example;
      input.value = example;
      state.requirement = example;
      state.rootTitle = '';
      btnStart.disabled = false;
      // 聚焦输入框，让用户看到内容
      input.focus();
    });
  });

  btnStart.addEventListener('click', async () => {
    if (['report', 'scripts'].includes(state.activeTab)) {
      startAnalysis();
      return;
    }
    if (!hasAnalysisInput()) return;
    state.requirement = input.value.trim();
    state.rootTitle = deriveRootTitle(state.requirement);
    startAnalysis();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (['report', 'scripts'].includes(state.activeTab)) {
        startAnalysis();
        return;
      }
      if (hasAnalysisInput()) {
        state.requirement = input.value.trim();
        state.rootTitle = deriveRootTitle(state.requirement);
        startAnalysis();
      }
    }
  });
}

// ========== 视图 2: 分析引擎 ==========
function initViewEngine() {
  $('#btn-back')?.addEventListener('click', () => {
    if (state.canvas) {
      state.canvas.clear();
      state.canvas = null;
    }
    $('#canvas-module-nav')?.classList.add('hidden');
    state.thinkQueue = [];
    state.isThinking = false;
    switchView('input');
  });

  // 大脑按钮
  $('#btn-brain')?.addEventListener('click', () => {
    switchView('brain');
    if (typeof loadBrainData === 'function') {
      loadBrainData();
    }
  });
  
  // ========== 灵动岛 ==========
  initDynamicIsland();
  
  // ========== 代跑弹窗 ==========
  initRunModal();

  $('#btn-zoom-fit')?.addEventListener('click', () => {
    state.canvas?.fitToView();
  });
}

// ========== 灵动岛状态更新 ==========
function updateChatIslandStatus(status, text) {
  const statusText = $('#island-status-text');
  const hintText = $('#island-hint-text');
  
  if (!statusText) return;
  
  statusText.textContent = text || '就绪';
  
  // ready 状态时显示引导提示
  if (hintText) {
    hintText.classList.toggle('hidden', status !== 'ready');
  }
}

// ========== 灵动岛初始化 ==========
function initDynamicIsland() {
  const collapsed = $('#island-collapsed');
  const expanded = $('#island-expanded');
  const btnCollapse = $('#btn-island-collapse');
  const btnSend = $('#btn-island-send');
  const input = $('#island-input');
  
  // 点击收起状态展开（但不包括按钮区域）
  collapsed?.addEventListener('click', (e) => {
    // 如果点击的是按钮，不展开
    if (e.target.closest('button')) return;
    collapsed.classList.add('hidden');
    expanded.classList.remove('hidden');
    expanded.setAttribute('aria-hidden', 'false');
    setTimeout(() => input?.focus(), 100);
  });
  
  // 收起
  btnCollapse?.addEventListener('click', () => {
    expanded.classList.add('hidden');
    expanded.setAttribute('aria-hidden', 'true');
    collapsed.classList.remove('hidden');
  });
  
  // 发送消息
  btnSend?.addEventListener('click', () => sendIslandMessage());
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendIslandMessage();
  });
  if (btnSend) btnSend._bound = true;
  
  // 代跑按钮（灵动岛内）
  $('#btn-island-run')?.addEventListener('click', () => showRunModal());
  
  // 复制按钮
  $('#btn-island-copy')?.addEventListener('click', (e) => {
    e.stopPropagation();
    copyCases();
  });
  
  // 导出按钮
  $('#btn-island-export')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportCases();
  });
}

// ========== 灵动岛消息 ==========
async function sendIslandMessage() {
  const input = $('#island-input');
  const sendButton = $('#btn-island-send');
  const message = input.value.trim();
  if (!message || sendButton?.disabled) return;
  if (sendButton) sendButton.disabled = true;
  
  // 添加用户消息
  addIslandMessage('user', message);
  const previousHistory = getChatHistory().slice();
  saveChatMessage('user', message);
  input.value = '';
  
  // 显示思考状态
  const thinkingId = addIslandThinking();
  const stopWaitingFeedback = startIslandThinkingFeedback(thinkingId);
  
  let newCasesAdded = 0;
  let casesUpdated = 0;
  let scoutReply = '';
  let replyShown = false;
  const categoryMap = {};
  const requestController = new AbortController();
  const requestTimeout = null;
  
  // 复制已有分类
  if (state.categories) {
    state.categories.forEach(cat => {
      categoryMap[cat.name] = { ...cat, cases: [...(cat.cases || [])] };
    });
  }
  
  // 收集当前所有用例
  const allCases = [];
  if (state.categories) {
    state.categories.forEach(cat => {
      if (cat.cases) allCases.push(...cat.cases);
    });
  }
  
  try {
    const response = await fetch(`${API_BASE}/canvas-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        cases: allCases,
        selectedCategory: state.selectedCategory,
        history: previousHistory
      }),
      signal: requestController.signal
    });
    
    if (!response.ok || !response.body) {
      throw new Error(`Canvas chat failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            
            if (currentEvent === 'case' && payload.case) {
              const c = payload.case;
              const catName = c.category || '未分类';
              
              if (!categoryMap[catName]) {
                categoryMap[catName] = { type: catName, name: catName, cases: [] };
              }
              categoryMap[catName].cases.push(c);
              
              state.categories = Object.values(categoryMap);
              const newNode = state.canvas?.addCaseNode(catName, c);
              renderCanvasModuleNav(catName);
              if (newNode) focusNewCaseNode(newNode);
              newCasesAdded++;
              
              // 更新状态
              updateChatIslandStatus('analyzing', `已添加 ${newCasesAdded} 条用例...`);
            } else if (currentEvent === 'reply' && payload.text) {
              scoutReply = payload.text;
              if (!replyShown) {
                addIslandMessage('scout', scoutReply);
                saveChatMessage('assistant', scoutReply);
                replyShown = true;
              }
              stopWaitingFeedback();
              removeIslandThinking(thinkingId);
            } else if (currentEvent === 'update' && payload.case) {
              if (applyCaseUpdate(payload.case)) {
                casesUpdated++;
                updateChatIslandStatus('analyzing', `已修改 ${casesUpdated} 条用例...`);
              }
            } else if (currentEvent === 'progress') {
              updateIslandThinking(
                thinkingId,
                payload.message || '模型正在处理',
                payload.elapsed ? `已等待 ${payload.elapsed} 秒 · 完整上下文 ${payload.cases || allCases.length} 条用例` : '正在准备上下文'
              );
              updateChatIslandStatus('analyzing', payload.message || '模型正在处理');
            } else if (currentEvent === 'complete') {
              stopWaitingFeedback();
              removeIslandThinking(thinkingId);
            }
          } catch (e) {}
        }
      }
    }
    
    // 移除思考状态
    removeIslandThinking(thinkingId);
    
    // 构建 Prism 的回复
    if (casesUpdated > 0) {
      scoutReply = `已直接修改导图中的 ${casesUpdated} 条用例`;
      showDanmaku('协作', `修改 ${casesUpdated} 条用例`);
    } else if (newCasesAdded > 0) {
      scoutReply = `收到！已补充 ${newCasesAdded} 条用例，你看看还需要调整吗？`;
      showDanmaku('协作', `新增 ${newCasesAdded} 条用例`);
      persistCanvasChatChanges();
    } else {
      scoutReply = '收到，我来看看怎么调整...';
    }
    
    // 显示 Prism 回复
    if (!replyShown) {
      addIslandMessage('scout', scoutReply);
      saveChatMessage('assistant', scoutReply);
    }
    const totalCases = state.categories.reduce((sum, cat) => sum + (cat.cases?.length || 0), 0);
    updateChatIslandStatus('ready', `${totalCases} 条用例就绪`);
    
  } catch (err) {
    removeIslandThinking(thinkingId);
    const timedOut = err?.name === 'AbortError';
    const errorReply = timedOut ? '模型响应超时了，请再试一次' : '出了点问题，稍后再试试';
    addIslandMessage('scout', errorReply);
    saveChatMessage('assistant', errorReply);
    updateChatIslandStatus('error', timedOut ? '响应超时' : '请求失败');
  } finally {
    stopWaitingFeedback();
    if (requestTimeout) clearTimeout(requestTimeout);
    if (sendButton) sendButton.disabled = false;
    input?.focus();
  }
}

function addIslandMessage(role, content) {
  const chat = $('#island-chat');
  if (!chat) return;
  
  const div = document.createElement('div');
  div.className = 'island-message';
  
  if (role === 'user') {
    div.innerHTML = `
      <div class="flex justify-end">
        <div class="bg-zinc-900 text-white rounded-2xl rounded-tr-md px-3.5 py-2.5 text-xs max-w-[80%] leading-relaxed">
          ${escapeHtml(content)}
        </div>
      </div>
    `;
  } else if (role === 'scout') {
    div.innerHTML = `
      <div class="flex gap-2">
        <div class="w-6 h-6 rounded-full overflow-hidden shrink-0">
          <span class="prism-avatar" aria-hidden="true"></span>
        </div>
        <div class="bg-zinc-50 rounded-2xl rounded-tl-md px-3.5 py-2.5 text-xs text-zinc-700 max-w-[80%] leading-relaxed">
          ${escapeHtml(content)}
        </div>
      </div>
    `;
  } else {
    // system 消息 - 居中显示
    div.innerHTML = `
      <div class="flex justify-center">
        <span class="text-xs text-zinc-400">${escapeHtml(content)}</span>
      </div>
    `;
  }
  
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ========== 代跑弹窗 ==========
function initRunModal() {
  const modal = $('#run-modal');
  const btnCancel = $('#btn-run-cancel');
  const btnConfirm = $('#btn-run-confirm');
  const btnAdbConnect = $('#btn-adb-connect');
  const btnAdbPair = $('#btn-adb-pair');
  const btnAdbMirror = $('#btn-adb-mirror');
  
  // 取消
  btnCancel?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  
  // 确认执行
  btnConfirm?.addEventListener('click', () => {
    modal.classList.add('hidden');
    startExecution();
  });

  btnAdbConnect?.addEventListener('click', connectWirelessAdb);
  btnAdbPair?.addEventListener('click', pairWirelessAdb);
  btnAdbMirror?.addEventListener('click', openDeviceMirrorIsland);
  initDeviceMirrorIsland();
  
  // 点击背景关闭
  modal?.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('backdrop-blur-sm')) {
      modal.classList.add('hidden');
    }
  });
  
  // 执行进度弹窗关闭
  const execModal = $('#execution-modal');
  const btnExecClose = $('#btn-execution-close');
  
  btnExecClose?.addEventListener('click', async () => {
    await stopActiveExecution({ hideAfter: true });
    execModal.classList.add('hidden');
  });
  
  execModal?.addEventListener('click', (e) => {
    if (e.target === execModal || e.target.classList.contains('backdrop-blur-sm')) {
      stopActiveExecution({ hideAfter: true }).finally(() => {
        execModal.classList.add('hidden');
      });
    }
  });
}

function showRunModal() {
  const modal = $('#run-modal');
  const caseCount = $('#run-case-count');
  
  // 计算用例数量
  const allCases = getAllCases();
  if (caseCount) {
    caseCount.textContent = `${allCases.length} 条`;
  }
  refreshAdbDeviceStatus();
  
  modal.classList.remove('hidden');
}

async function refreshAdbDeviceStatus() {
  const statusText = $('#adb-device-status');
  const detailText = $('#adb-device-detail');
  const dot = $('#adb-device-dot');
  const mirrorButton = $('#btn-adb-mirror');
  if (!statusText) return null;
  try {
    const response = await fetch(`${API_BASE}/device/adb`);
    const data = await response.json();
    const status = data.status || {};
    if (status.connected) {
      statusText.textContent = `Android 已连接${status.active?.model ? ` · ${status.active.model}` : ''}`;
      detailText.textContent = status.active?.serial || '设备可用于手机端自动测试';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0';
      if (mirrorButton) {
        mirrorButton.disabled = false;
        mirrorButton.textContent = '投屏';
      }
    } else {
      statusText.textContent = status.available ? '未连接 Android 设备' : 'ADB 不可用';
      detailText.textContent = status.error || '请插入 USB 数据线，或输入无线 ADB 地址';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0';
      if (mirrorButton) {
        mirrorButton.disabled = true;
        mirrorButton.textContent = '投屏';
      }
    }
    return status;
  } catch (error) {
    statusText.textContent = '设备状态检查失败';
    detailText.textContent = error.message;
    dot.className = 'w-2.5 h-2.5 rounded-full bg-red-400 shrink-0';
    if (mirrorButton) mirrorButton.disabled = true;
    return null;
  }
}

async function connectWirelessAdb() {
  const button = $('#btn-adb-connect');
  const input = $('#adb-wireless-address');
  const address = input?.value.trim();
  if (!address) {
    $('#adb-device-detail').textContent = '请输入手机的 IP:端口';
    return;
  }
  button.disabled = true;
  button.textContent = '连接中...';
  try {
    const response = await fetch(`${API_BASE}/device/adb/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '连接失败');
    await refreshAdbDeviceStatus();
  } catch (error) {
    $('#adb-device-status').textContent = '无线 ADB 连接失败';
    $('#adb-device-detail').textContent = error.message;
    $('#adb-device-dot').className = 'w-2.5 h-2.5 rounded-full bg-red-400 shrink-0';
  } finally {
    button.disabled = false;
    button.textContent = '连接';
  }
}

async function pairWirelessAdb() {
  const button = $('#btn-adb-pair');
  const address = $('#adb-pair-address')?.value.trim();
  const code = $('#adb-pair-code')?.value.trim();
  if (!address || !code) {
    $('#adb-device-detail').textContent = '请输入配对地址和 6 位配对码';
    return;
  }
  button.disabled = true;
  button.textContent = '配对中...';
  try {
    const response = await fetch(`${API_BASE}/device/adb/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, code })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '配对失败');
    $('#adb-device-status').textContent = '无线调试配对成功';
    $('#adb-device-detail').textContent = '请使用上方连接地址继续连接设备';
    $('#adb-device-dot').className = 'w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0';
  } catch (error) {
    $('#adb-device-status').textContent = '无线 ADB 配对失败';
    $('#adb-device-detail').textContent = error.message;
    $('#adb-device-dot').className = 'w-2.5 h-2.5 rounded-full bg-red-400 shrink-0';
  } finally {
    button.disabled = false;
    button.textContent = '配对';
  }
}

const deviceMirrorState = {
  timer: null,
  ws: null,
  decoder: null,
  canvasContext: null,
  expanded: false,
  running: false,
  loading: false,
  frameCount: 0,
  videoInfo: null,
  mode: 'snapshot',
};

const DEVICE_MIRROR_MIN_DELAY = 120;

function initDeviceMirrorIsland() {
  $('#btn-device-mirror-expand')?.addEventListener('click', () => setDeviceMirrorExpanded(true));
  $('#btn-device-mirror-collapse')?.addEventListener('click', () => setDeviceMirrorExpanded(false));
  $('#btn-device-mirror-close')?.addEventListener('click', closeDeviceMirrorIsland);
  $('#btn-device-mirror-refresh')?.addEventListener('click', () => {
    showSnapshotMirrorStatus('手动刷新网页内预览');
    clearDeviceMirrorTimer();
    if (!deviceMirrorState.running) {
      deviceMirrorState.running = true;
    }
    refreshDeviceMirrorFrame(true);
  });
  $('#device-mirror-collapsed')?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    setDeviceMirrorExpanded(true);
  });
}

async function openDeviceMirrorIsland() {
  const status = await refreshAdbDeviceStatus();
  if (!status?.connected) {
    const detail = $('#adb-device-detail');
    if (detail) detail.textContent = '请先连接 Android 设备，再打开投屏';
    return;
  }

  const island = $('#device-mirror-island');
  if (!island) return;
  island.classList.remove('hidden');
  setDeviceMirrorExpanded(true);

  openBrowserScrcpyMirror();
}

function setDeviceMirrorExpanded(expanded) {
  deviceMirrorState.expanded = expanded;
  $('#device-mirror-collapsed')?.classList.toggle('hidden', expanded);
  $('#device-mirror-expanded')?.classList.toggle('hidden', !expanded);
}

function closeDeviceMirrorIsland() {
  closeBrowserScrcpyMirror();
  stopDeviceMirrorPolling();
  stopScrcpyMirror();
  $('#device-mirror-island')?.classList.add('hidden');
}

function showBrowserScrcpyMirrorStatus(status = {}) {
  deviceMirrorState.mode = 'browser-scrcpy';
  stopDeviceMirrorPolling();
  $('#device-mirror-title').textContent = 'Android 真机投屏';
  $('#device-mirror-subtitle').textContent = '浏览器内 scrcpy 视频流';
  $('#device-mirror-detail').textContent = 'H264 + WebCodecs · 不走 ADB 截图轮询';
  $('#device-mirror-status').textContent = status.message || `已连接 ${status.device?.model || 'Android 真机'}`;
  const empty = $('#device-mirror-empty');
  const img = $('#device-mirror-img');
  const canvas = $('#device-mirror-canvas');
  if (img) img.removeAttribute('src');
  img?.classList.add('hidden');
  canvas?.classList.remove('hidden');
  empty?.classList.toggle('hidden', Boolean(status.ready));
  if (empty) empty.textContent = status.message || '正在启动浏览器内视频流...';
}

function showNativeScrcpyMirrorStatus(status = {}) {
  deviceMirrorState.mode = 'scrcpy-window';
  stopDeviceMirrorPolling();
  $('#device-mirror-title').textContent = 'Android 原生投屏';
  $('#device-mirror-subtitle').textContent = 'scrcpy 独立窗口已启动';
  $('#device-mirror-detail').textContent = '浏览器内视频流不可用，已改用原生 scrcpy 窗口';
  $('#device-mirror-status').textContent = status.message || `原生窗口投屏中 · ${status.device?.model || 'Android 真机'}`;
  const empty = $('#device-mirror-empty');
  const img = $('#device-mirror-img');
  const canvas = $('#device-mirror-canvas');
  img?.classList.add('hidden');
  canvas?.classList.add('hidden');
  empty?.classList.remove('hidden');
  if (empty) empty.textContent = '请查看电脑上的 scrcpy 独立窗口';
}

async function startNativeScrcpyMirror(reason = '') {
  closeBrowserScrcpyMirror(false);
  try {
    $('#device-mirror-status').textContent = '正在启动原生 scrcpy 窗口...';
    const response = await fetch(`${API_BASE}/device/scrcpy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxSize: 1024, maxFps: 60 })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '原生 scrcpy 启动失败');
    showNativeScrcpyMirrorStatus({
      ...data.status,
      message: reason ? `已启动原生 scrcpy：${reason}` : '已启动原生 scrcpy 窗口'
    });
    return true;
  } catch (error) {
    showSnapshotMirrorStatus(error.message || '原生 scrcpy 启动失败');
    startDeviceMirrorPolling();
    return false;
  }
}

function showSnapshotMirrorStatus(reason = '') {
  deviceMirrorState.mode = 'snapshot';
  closeBrowserScrcpyMirror(true);
  $('#device-mirror-title').textContent = 'Android 投屏';
  $('#device-mirror-subtitle').textContent = 'ADB 截图预览模式';
  $('#device-mirror-detail').textContent = reason
    ? `scrcpy 不可用，已降级截图：${reason}`
    : '通过 ADB 截图实时刷新';
  const empty = $('#device-mirror-empty');
  const img = $('#device-mirror-img');
  const canvas = $('#device-mirror-canvas');
  img?.classList.remove('hidden');
  canvas?.classList.add('hidden');
  if (empty) {
    empty.textContent = '正在获取手机画面...';
  }
}

async function stopScrcpyMirror() {
  try {
    await fetch(`${API_BASE}/device/scrcpy/stop`, { method: 'POST' });
  } catch (error) {
    console.warn('停止 scrcpy 失败:', error.message);
  } finally {
    deviceMirrorState.mode = 'snapshot';
  }
}

function getDeviceMirrorWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/device-mirror`;
}

function openBrowserScrcpyMirror() {
  closeBrowserScrcpyMirror(false);
  showBrowserScrcpyMirrorStatus({ message: '正在连接浏览器内视频流...' });
  //#region debug-point h264-webcodecs-mirror-open
  reportH264MirrorDebug('browser-mirror-open', {
    hypothesisId: 'H5',
    href: window.location.href,
    protocol: window.location.protocol,
    isSecureContext: window.isSecureContext,
    hasVideoDecoder: 'VideoDecoder' in window,
    userAgent: navigator.userAgent
  });
  //#endregion debug-point h264-webcodecs-mirror-open

  if (!('VideoDecoder' in window)) {
    const secureHint = window.isSecureContext
      ? '当前浏览器不支持 WebCodecs'
      : '当前地址不是安全上下文，Chrome 会屏蔽 WebCodecs；建议用 http://localhost:3000 或 http://127.0.0.1:3000 打开';
    startNativeScrcpyMirror(secureHint);
    return;
  }

  const ws = new WebSocket(getDeviceMirrorWsUrl());
  deviceMirrorState.ws = ws;
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    //#region debug-point h264-webcodecs-mirror-ws-open
    reportH264MirrorDebug('ws-open', { hypothesisId: 'H1', url: getDeviceMirrorWsUrl() });
    //#endregion debug-point h264-webcodecs-mirror-ws-open
    showBrowserScrcpyMirrorStatus({ message: '视频流已连接，等待首帧...' });
  };

  ws.onmessage = (event) => {
    //#region debug-point h264-webcodecs-mirror-ws-message
    reportH264MirrorDebug('ws-message', {
      hypothesisId: 'H1',
      kind: typeof event.data,
      byteLength: typeof event.data === 'string' ? event.data.length : event.data?.byteLength || 0
    });
    //#endregion debug-point h264-webcodecs-mirror-ws-message
    if (typeof event.data === 'string') {
      handleDeviceMirrorMessage(event.data);
      return;
    }
    handleDeviceMirrorFrame(event.data);
  };

  ws.onerror = () => {
    //#region debug-point h264-webcodecs-mirror-ws-error
    reportH264MirrorDebug('ws-error', { hypothesisId: 'H1', readyState: ws.readyState });
    //#endregion debug-point h264-webcodecs-mirror-ws-error
    startNativeScrcpyMirror('浏览器视频流连接失败');
  };

  ws.onclose = () => {
    //#region debug-point h264-webcodecs-mirror-ws-close
    reportH264MirrorDebug('ws-close', { hypothesisId: 'H1', readyState: ws.readyState, mode: deviceMirrorState.mode });
    //#endregion debug-point h264-webcodecs-mirror-ws-close
    if (deviceMirrorState.mode === 'browser-scrcpy') {
      $('#device-mirror-status').textContent = '视频流已关闭';
    }
  };
}

function closeBrowserScrcpyMirror(callStop = true) {
  if (deviceMirrorState.ws) {
    deviceMirrorState.ws.onclose = null;
    deviceMirrorState.ws.close();
    deviceMirrorState.ws = null;
  }
  if (deviceMirrorState.decoder) {
    try { deviceMirrorState.decoder.close(); } catch (_) {}
    deviceMirrorState.decoder = null;
  }
  deviceMirrorState.canvasContext = null;
  deviceMirrorState.videoInfo = null;
  if (callStop) {
    fetch(`${API_BASE}/device/scrcpy/stop`, { method: 'POST' }).catch(() => {});
  }
}

function handleDeviceMirrorMessage(raw) {
  let message = null;
  try {
    message = JSON.parse(raw);
  } catch (_) {
    return;
  }

  if (message.type === 'status') {
    showBrowserScrcpyMirrorStatus({ message: message.message });
    return;
  }

  if (message.type === 'info') {
    deviceMirrorState.videoInfo = message;
    //#region debug-point h264-webcodecs-mirror-info
    reportH264MirrorDebug('mirror-info', {
      hypothesisId: 'H4',
      deviceName: message.deviceName,
      codec: message.codec,
      width: message.width,
      height: message.height
    });
    //#endregion debug-point h264-webcodecs-mirror-info
    const canvas = $('#device-mirror-canvas');
    if (canvas) {
      canvas.width = message.width || 360;
      canvas.height = message.height || 720;
      deviceMirrorState.canvasContext = canvas.getContext('2d');
    }
    showBrowserScrcpyMirrorStatus({
      ready: true,
      device: message.device,
      message: `${message.deviceName || message.device?.model || 'Android'} · ${message.width}×${message.height}`,
    });
    return;
  }

  if (message.type === 'error') {
    startNativeScrcpyMirror(message.error || '浏览器视频流启动失败');
    return;
  }

  if (message.type === 'end' && deviceMirrorState.mode === 'browser-scrcpy') {
    $('#device-mirror-status').textContent = '视频流已停止';
  }
}

function handleDeviceMirrorFrame(data) {
  const bytes = new Uint8Array(data);
  //#region debug-point h264-webcodecs-mirror-frame
  reportH264MirrorDebug('frame-received', {
    hypothesisId: 'H1',
    bytes: bytes.length,
    keyframe: bytes[0] === 1,
    hasInfo: Boolean(deviceMirrorState.videoInfo),
    decoderState: deviceMirrorState.decoder?.state || 'none',
    frameCount: deviceMirrorState.frameCount
  });
  //#endregion debug-point h264-webcodecs-mirror-frame
  if (bytes.length <= 1 || !deviceMirrorState.videoInfo) return;

  const keyframe = bytes[0] === 1;
  const payload = bytes.slice(1);
  try {
    ensureDeviceMirrorDecoder(payload);
  } catch (error) {
    console.warn('投屏 VideoDecoder 初始化失败:', error.message);
    startNativeScrcpyMirror('视频解码初始化失败');
    return;
  }
  if (!deviceMirrorState.decoder || deviceMirrorState.decoder.state !== 'configured') return;

  try {
    deviceMirrorState.decoder.decode(new EncodedVideoChunk({
      type: keyframe ? 'key' : 'delta',
      timestamp: deviceMirrorState.frameCount * 33333,
      data: payload,
    }));
    //#region debug-point h264-webcodecs-mirror-decode
    reportH264MirrorDebug('decode-submitted', {
      hypothesisId: 'H2',
      keyframe,
      payloadBytes: payload.length,
      decoderState: deviceMirrorState.decoder?.state,
      frameCount: deviceMirrorState.frameCount
    });
    //#endregion debug-point h264-webcodecs-mirror-decode
    deviceMirrorState.frameCount += 1;
    $('#device-mirror-status').textContent = `实时视频流 · ${deviceMirrorState.frameCount} 帧`;
  } catch (error) {
    console.warn('投屏视频解码失败:', error.message);
    //#region debug-point h264-webcodecs-mirror-decode-error
    reportH264MirrorDebug('decode-throw', { hypothesisId: 'H2', message: error.message, name: error.name });
    //#endregion debug-point h264-webcodecs-mirror-decode-error
  }
}

function ensureDeviceMirrorDecoder(firstFrame) {
  if (deviceMirrorState.decoder) return;

  const info = deviceMirrorState.videoInfo || {};
  const codec = parseAvcCodecString(firstFrame) || 'avc1.42E01F';
  const canvas = $('#device-mirror-canvas');
  const ctx = deviceMirrorState.canvasContext || canvas?.getContext('2d');
  deviceMirrorState.canvasContext = ctx;

  const decoder = new VideoDecoder({
    output(frame) {
      const target = $('#device-mirror-canvas');
      const context = deviceMirrorState.canvasContext || target?.getContext('2d');
      //#region debug-point h264-webcodecs-mirror-output
      reportH264MirrorDebug('decoder-output', {
        hypothesisId: 'H3',
        displayWidth: frame.displayWidth,
        displayHeight: frame.displayHeight,
        canvasFound: Boolean(target),
        contextFound: Boolean(context),
        canvasHidden: target?.classList.contains('hidden') || false
      });
      //#endregion debug-point h264-webcodecs-mirror-output
      if (target && context) {
        if (target.width !== frame.displayWidth || target.height !== frame.displayHeight) {
          target.width = frame.displayWidth;
          target.height = frame.displayHeight;
        }
        context.drawImage(frame, 0, 0, target.width, target.height);
      }
      $('#device-mirror-empty')?.classList.add('hidden');
      frame.close();
    },
    error(error) {
      console.warn('投屏 VideoDecoder 错误:', error.message);
      startNativeScrcpyMirror('视频解码失败');
    }
  });

  const config = {
    codec,
    codedWidth: info.width || 360,
    codedHeight: info.height || 720,
    optimizeForLatency: true,
    avc: { format: 'annexb' },
  };
  decoder.configure(config);
  deviceMirrorState.decoder = decoder;
}

function parseAvcCodecString(bytes) {
  for (let i = 0; i < bytes.length - 8; i += 1) {
    const startCode4 = bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1;
    const startCode3 = bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1;
    const nalOffset = startCode4 ? i + 4 : startCode3 ? i + 3 : -1;
    if (nalOffset < 0) continue;
    if ((bytes[nalOffset] & 0x1f) !== 7) continue;
    const profile = bytes[nalOffset + 1];
    const compatibility = bytes[nalOffset + 2];
    const level = bytes[nalOffset + 3];
    return `avc1.${[profile, compatibility, level].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return '';
}

function startDeviceMirrorPolling() {
  if (deviceMirrorState.running) return;
  deviceMirrorState.running = true;
  deviceMirrorState.frameCount = 0;
  refreshDeviceMirrorFrame(true);
}

function stopDeviceMirrorPolling() {
  deviceMirrorState.running = false;
  deviceMirrorState.loading = false;
  clearDeviceMirrorTimer();
}

function clearDeviceMirrorTimer() {
  if (!deviceMirrorState.timer) return;
  clearTimeout(deviceMirrorState.timer);
  deviceMirrorState.timer = null;
}

function scheduleNextDeviceMirrorFrame(delay = DEVICE_MIRROR_MIN_DELAY) {
  clearDeviceMirrorTimer();
  if (!deviceMirrorState.running) return;
  deviceMirrorState.timer = setTimeout(() => refreshDeviceMirrorFrame(false), delay);
}

function refreshDeviceMirrorFrame(manual = false) {
  if (deviceMirrorState.loading) return;
  const img = $('#device-mirror-img');
  const empty = $('#device-mirror-empty');
  const status = $('#device-mirror-status');
  const subtitle = $('#device-mirror-subtitle');
  if (!img) return;

  deviceMirrorState.loading = true;
  const startedAt = Date.now();
  if (status) status.textContent = manual ? '正在刷新画面...' : `实时刷新中 · ${deviceMirrorState.frameCount} 帧`;
  img.onload = () => {
    deviceMirrorState.loading = false;
    deviceMirrorState.frameCount += 1;
    empty?.classList.add('hidden');
    const cost = Date.now() - startedAt;
    if (status) status.textContent = `已刷新 · ${deviceMirrorState.frameCount} 帧`;
    if (subtitle) subtitle.textContent = `同步中 · ${cost}ms/帧`;
    scheduleNextDeviceMirrorFrame(cost > 900 ? 60 : DEVICE_MIRROR_MIN_DELAY);
  };
  img.onerror = () => {
    deviceMirrorState.loading = false;
    empty?.classList.remove('hidden');
    if (empty) empty.textContent = '获取画面失败，请确认 ADB 已连接';
    if (status) status.textContent = '投屏失败';
    if (subtitle) subtitle.textContent = 'ADB 截图失败';
    stopDeviceMirrorPolling();
  };
  img.src = `${API_BASE}/device/adb/screenshot?width=420&quality=72&t=${Date.now()}`;
}

// ========== 执行用例 ==========
function getAllCases() {
  if (!state.categories) return [];
  const cases = [];
  state.categories.forEach(cat => {
    if (cat.cases) {
      cat.cases.forEach(c => {
        const categoryName = cat.name || cat.type || c.category || '';
        const hierarchy = inferExecutionHierarchy(c, categoryName);
        cases.push({
          ...c,
          productName: hierarchy.productName,
          moduleName: hierarchy.moduleName,
          category: categoryName
        });
      });
    }
  });
  return cases;
}

function inferExecutionHierarchy(caseData = {}, categoryName = '') {
  const steps = Array.isArray(caseData.steps) ? caseData.steps : [];
  const stepText = steps.join('\n');
  const webDirectoryMatch = stepText.match(/在\s*Web\s*目录(?:中)?找到并进入\s*([^\n，。；]+)/i);
  const nestedEntryMatch = [...stepText.matchAll(/在\s*([^\n，。；]+?)\s*中找到并进入\s*([^\n，。；]+)/g)]
    .find(match => !/Web\s*目录/i.test(match[1]));
  const clean = value => String(value || '')
    .replace(/(页面|模块|菜单|入口)$/g, '')
    .trim();
  const rootTitle = getMindMapRootTitle();
  const isGenericRoot = /^(需求简述|测试用例|未命名需求|需求分析报告)$/i.test(rootTitle)
    || /需求|文档|报告/.test(rootTitle || '');
  const rawProductName = clean(caseData.productName);
  const isGenericProduct = /^(需求简述|测试用例|未命名需求|需求分析报告)$/i.test(rawProductName)
    || /需求|文档|报告/.test(rawProductName || '');
  const productName = (!isGenericProduct ? rawProductName : '')
    || clean(webDirectoryMatch?.[1])
    || (!isGenericRoot ? clean(rootTitle) : '');
  const moduleName = clean(caseData.moduleName)
    || clean(nestedEntryMatch?.[2])
    || clean(categoryName);
  return { productName, moduleName };
}

function executeSingleCase(node) {
  if ((node?._depth || 0) === 1) {
    executeModuleCases(node);
    return;
  }
  const fallbackCase = {
    id: node.id,
    title: node.title,
    priority: node.priority || 'P1',
    productName: node.productName || '',
    moduleName: node.moduleName || node.category || '',
    category: node.category || node.moduleName || '',
    steps: node.children?.filter(child => child.type === 'step').map(child => child.title) || [],
    expected: node.children
      ?.flatMap(child => child.children || [])
      .find(child => child.type === 'expected')?.title || ''
  };
  const matchedCase = getAllCases().find(item => String(item.id) === String(node.id));
  const testCase = matchedCase || {
    ...fallbackCase,
    ...inferExecutionHierarchy(fallbackCase, fallbackCase.category)
  };
  runCases([testCase], {
    title: `${testCase.title || '单条用例'} 测试 ${new Date().toLocaleString('zh-CN')}`,
    scopeName: testCase.title || '单条用例'
  });
}

function getCasesUnderNode(node) {
  const allCases = getAllCases();
  if (!node) return [];
  const childIds = new Set((node.children || []).map(child => String(child.id)));
  const title = String(node.title || '').trim();
  return allCases.filter(item =>
    childIds.has(String(item.id)) ||
    String(item.category || '') === title ||
    String(item.moduleName || '') === title
  );
}

function executeModuleCases(node) {
  const cases = getCasesUnderNode(node);
  if (!cases.length) {
    addIslandMessage?.('system', `「${node?.title || '该模块'}」下面没有可执行用例`);
    return;
  }
  runCases(cases, {
    title: `${getMindMapRootTitle()} / ${node.title} 测试 ${new Date().toLocaleString('zh-CN')}`,
    scopeName: node.title
  });
}

// ========== 执行状态灵动岛管理 ==========
const islandState = {
  isExpanded: false,
  completedCount: 0,
  total: 0,
  logs: [],
  isRunning: false,
  isStopping: false,
  abortController: null,
  lastReportId: null
};

function showIsland() {
  const island = $('#execution-island');
  const collapsed = $('#exec-island-collapsed');
  const expanded = $('#exec-island-expanded');
  
  island.classList.remove('hidden');
  collapsed.classList.remove('hidden');
  expanded.classList.add('hidden');
  islandState.isExpanded = false;
  islandState.logs = [];
  islandState.lastReportId = null;
  const reportButton = $('#btn-exec-view-report');
  reportButton?.classList.add('hidden');
  
  // 绑定事件
  bindIslandEvents();
}

function hideIsland() {
  const island = $('#execution-island');
  island.classList.add('hidden');
}

async function stopActiveExecution({ hideAfter = false, silent = false } = {}) {
  if (!islandState.isRunning) {
    if (hideAfter) hideIsland();
    return;
  }
  if (islandState.isStopping) return;

  islandState.isStopping = true;
  const controller = islandState.abortController;
  if (!silent) {
    updateIslandStatus('正在停止', '正在终止执行任务...');
    addIslandLog('system', '正在停止执行并关闭测试浏览器...');
  }

  try {
    const response = await fetch(`${API_BASE}/stop`, { method: 'POST' });
    const result = await response.json();
    if (!silent) {
      addIslandLog(
        result.success ? 'success' : 'info',
        result.success ? '执行任务已停止，测试浏览器已关闭' : (result.message || '停止指令已发送')
      );
    }
  } catch (error) {
    if (!silent) {
      console.error('停止失败:', error);
      addIslandLog('error', '停止指令发送失败');
    }
  } finally {
    controller?.abort();
    islandState.isRunning = false;
    islandState.isStopping = false;
    islandState.abortController = null;
    if (hideAfter) hideIsland();
  }
}

function bindIslandEvents() {
  const btnExpand = $('#btn-exec-island-expand');
  const btnCollapse = $('#btn-exec-island-collapse');
  const btnClose = $('#btn-exec-island-close');
  const btnStop = $('#btn-exec-island-stop');
  const btnViewReport = $('#btn-exec-view-report');
  
  if (btnExpand) btnExpand.onclick = () => toggleIslandExpanded(true);
  if (btnCollapse) btnCollapse.onclick = () => toggleIslandExpanded(false);
  if (btnClose) {
    btnClose.onclick = () => {
      if (islandState.isRunning) {
        stopActiveExecution({ hideAfter: true });
      } else {
        hideIsland();
      }
    };
  }
  if (btnStop) btnStop.onclick = async () => {
    btnStop.disabled = true;
    btnStop.innerHTML = '<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>';
    await stopActiveExecution({ hideAfter: true });
    btnStop.disabled = false;
    btnStop.innerHTML = '';
  };
  if (btnViewReport) {
    btnViewReport.onclick = () => {
      if (islandState.lastReportId) {
        openExecutionReport(islandState.lastReportId);
      }
    };
  }
}

function toggleIslandExpanded(expand) {
  const collapsed = $('#exec-island-collapsed');
  const expanded = $('#exec-island-expanded');
  
  if (expand) {
    collapsed.classList.add('hidden');
    expanded.classList.remove('hidden');
    islandState.isExpanded = true;
    
    // 滚动到底部
    const logList = $('#exec-island-log-list');
    if (logList) logList.scrollTop = logList.scrollHeight;
  } else {
    expanded.classList.add('hidden');
    collapsed.classList.remove('hidden');
    islandState.isExpanded = false;
  }
}

function updateIslandProgress(completed, total) {
  islandState.completedCount = completed;
  islandState.total = total;
  
  const progressText = $('#exec-island-progress-text');
  const expandedCount = $('#exec-island-expanded-count');
  const progressFill = $('#exec-island-progress-fill');
  const expandedProgress = $('#exec-island-expanded-progress');
  
  const percent = total > 0 ? (completed / total) * 100 : 0;
  
  if (progressText) progressText.textContent = `${completed}/${total}`;
  if (expandedCount) expandedCount.textContent = `${completed}/${total}`;
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (expandedProgress) expandedProgress.style.width = `${percent}%`;
}

function updateIslandStatus(status, subtitle) {
  const titleEl = $('#exec-island-title');
  const subtitleEl = $('#exec-island-subtitle');
  const expandedStatus = $('#exec-island-expanded-status');
  const container = $('#exec-island-collapsed');
  
  if (titleEl) titleEl.textContent = status;
  if (subtitleEl) subtitleEl.textContent = subtitle || '';
  if (expandedStatus) expandedStatus.textContent = subtitle || status;
  
  // 更新状态样式
  container?.classList.remove('island-done', 'island-failed');
  if (status === '执行完成') {
    container?.classList.add('island-done');
  } else if (status === '执行失败' || status === '执行出错') {
    container?.classList.add('island-failed');
  }
}

function addIslandLog(type, message) {
  // 保存到状态
  islandState.logs.push({ type, message, time: new Date() });
  
  // 更新收起状态的副标题
  const subtitle = $('#exec-island-subtitle');
  if (subtitle && type !== 'divider') {
    subtitle.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;
  }
  
  // 如果展开状态存在，添加日志
  const logList = $('#exec-island-log-list');
  if (!logList) return;
  
  // 分隔线
  if (type === 'divider') {
    const div = document.createElement('div');
    div.className = 'h-px bg-white/5 my-1';
    logList.appendChild(div);
    return;
  }
  
  const item = document.createElement('div');
  item.className = 'island-log-item';
  
  let iconClass = 'island-log-icon-info';
  let iconSymbol = 'i';
  let textClass = '';
  
  switch (type) {
    case 'success':
      iconClass = 'island-log-icon-success';
      iconSymbol = '✓';
      textClass = 'island-log-text-success';
      break;
    case 'error':
      iconClass = 'island-log-icon-error';
      iconSymbol = '✗';
      textClass = 'island-log-text-error';
      break;
    case 'system':
      iconClass = 'island-log-icon-system';
      iconSymbol = '·';
      textClass = 'island-log-text-system';
      break;
    case 'thinking':
      iconClass = 'island-log-icon-thinking';
      iconSymbol = '→';
      textClass = 'island-log-text-thinking';
      break;
    default:
      iconClass = 'island-log-icon-info';
      iconSymbol = '·';
      break;
  }
  
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  item.innerHTML = `
    <div class="island-log-icon ${iconClass}">
      <span style="font-size:10px">${iconSymbol}</span>
    </div>
    <span class="island-log-text ${textClass}">${escapeHtml(message)}</span>
    <span class="island-log-time">${time}</span>
  `;
  
  logList.appendChild(item);
  
  // 自动滚动到底部
  if (islandState.isExpanded) {
    logList.scrollTop = logList.scrollHeight;
  }
}

async function startExecution() {
  return runCases(getAllCases());
}

async function runCases(selectedCases, runOptions = {}) {
  const allCases = Array.isArray(selectedCases) ? selectedCases : [];
  const total = allCases.length;
  const hasMobileSteps = allCases.some(testCase =>
    (testCase.steps || []).some(step =>
      /\[(手机|移动端|小程序|H5|App)\]|手机端|移动端|小程序|Android|安卓|\bApp\b|\bH5\b/i.test(step)
    )
  );
  
  if (total === 0) {
    // 显示提示
    const island = $('#execution-island');
    island.classList.remove('hidden');
    updateIslandStatus('无用例', '请先生成测试用例');
    setTimeout(() => hideIsland(), 2000);
    return;
  }
  if (hasMobileSteps) {
    const deviceStatus = await refreshAdbDeviceStatus();
    if (!deviceStatus?.connected) {
      updateChatIslandStatus('error', '请先连接 Android 真机');
      showRunModal();
      return;
    }
  }
  
  // 显示灵动岛
  showIsland();
  islandState.isRunning = true;
  islandState.isStopping = false;
  const executionController = new AbortController();
  islandState.abortController = executionController;
  updateIslandStatus('正在执行', '准备中...');
  updateIslandProgress(0, total);
  
  // 读取目标 URL
  const targetUrlInput = $('#run-target-url');
  const targetUrl = targetUrlInput ? targetUrlInput.value.trim() : '';
  
  // 读取执行模式
  const executorMode = document.querySelector('input[name="executor-mode"]:checked');
  const usePIEngine = executorMode?.value !== 'enhanced';
  
  // 如果用户提供了目标 URL，注入到用例中
  const casesToRun = allCases.map(c => {
    const steps = [...(c.steps || [])];
    if (targetUrl && !steps.some(step => /https?:\/\/[^\s]+/.test(step))) {
      steps.unshift(`打开 ${targetUrl}`);
    }
    const entryStepCount = targetUrl ? 1 : 0;
    const hierarchySteps = [];
    if (c.productName && !steps.some(step => step.includes(c.productName))) {
      hierarchySteps.push(`在 Web 目录中找到并进入 ${c.productName}`);
    }
    if (
      c.moduleName &&
      c.moduleName !== c.productName &&
      !steps.some(step => step.includes(c.moduleName))
    ) {
      hierarchySteps.push(`在 ${c.productName || '当前产品'} 中找到并进入 ${c.moduleName}`);
    }
    steps.splice(entryStepCount, 0, ...hierarchySteps);
    return { ...c, steps };
  });
  
  // 初始日志
  addIslandLog('info', `共 ${total} 条用例，开始执行...`);
  if (runOptions.scopeName) {
    addIslandLog('system', `执行范围: ${runOptions.scopeName}`);
  }
  if (targetUrl) {
    addIslandLog('system', `测试地址: ${targetUrl}`);
  }
  if (usePIEngine) {
    addIslandLog('system', '使用 Prism Engine 智能模式');
  }
  
  try {
    const response = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: executionController.signal,
      body: JSON.stringify({
        cases: casesToRun,
        options: { 
          title: runOptions.title || `${getMindMapRootTitle()}测试 ${new Date().toLocaleString('zh-CN')}`,
          productName: getMindMapRootTitle(),
          targetUrl,
          usePIEngine: usePIEngine
        }
      })
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let completedCount = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            
            if (currentEvent === 'log' && payload.text) {
              const type = payload.type || 'info';
              addIslandLog(type, payload.text);
              
              // 更新进度
              if (payload.text.includes('通过') || payload.text.includes('失败') || payload.text.includes('异常')) {
                completedCount++;
                updateIslandProgress(completedCount, total);
              }
              
              // 更新状态文字
              if (payload.text.includes('正在启动')) {
                updateIslandStatus('正在执行', '正在启动浏览器...');
              } else if (payload.text.includes('已启动')) {
                updateIslandStatus('正在执行', '浏览器已启动');
              } else if (payload.text.includes('开始执行')) {
                updateIslandStatus('正在执行', payload.text);
              }
            }
            
            if (currentEvent === 'complete') {
              islandState.isRunning = false;
              islandState.abortController = null;
              const hasFailed = Number(payload.failed || 0) > 0 || payload.success === false;
              updateIslandStatus(hasFailed ? '执行失败' : '执行完成', `${payload.passed || 0} 通过, ${payload.failed || 0} 失败`);
              updateIslandProgress(total, total);
              
              if (payload.reportId) {
                islandState.lastReportId = payload.reportId;
                const reportButton = $('#btn-exec-view-report');
                reportButton?.classList.remove('hidden');
                addIslandLog(hasFailed ? 'error' : 'success', '测试报告已生成，点击“查看报告”可再次打开');
                openExecutionReport(payload.reportId);
              }
            }
            
            if (currentEvent === 'error') {
              updateIslandStatus('执行出错', payload.error || '未知错误');
              addIslandLog('error', payload.error || '未知错误');
            }
          } catch (e) {}
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError' || executionController.signal.aborted) return;
    updateIslandStatus('执行失败', error.message);
    addIslandLog('error', `连接失败: ${error.message}`);
  } finally {
    if (islandState.abortController === executionController) {
      islandState.isRunning = false;
      islandState.abortController = null;
    }
  }
}

window.addEventListener('pagehide', () => {
  if (!islandState.isRunning) return;
  try {
    navigator.sendBeacon(`${API_BASE}/stop`, new Blob([], { type: 'application/json' }));
  } catch {}
  islandState.abortController?.abort();
});

// 保留旧函数兼容（但不再使用）
function addExecutionLog(type, message) {
  addIslandLog(type, message);
}

// ========== 复制和导出 ==========
function copyCases() {
  const allCases = getAllCases();
  const text = allCases.map(c => {
    const status = state.canvas?.state.caseStatus[c.id];
    const statusStr = status === 'pass' ? ' [✓通过]' 
      : status === 'fail' ? ' [✗不通过]' 
      : status === 'confirmed' ? ' [✦已确认]'
      : status === 'unconfirmed' ? ' [?未确认]'
      : status === 'pending' ? ' [⋯待确认]'
      : '';
    let result = `【${c.priority || 'P1'}】${c.title}${statusStr}\n`;
    if (c.source) {
      result += `  来源：${c.source}\n`;
    }
    if (c.steps) {
      c.steps.forEach((step, i) => {
        result += `  ${i + 1}. ${step}\n`;
      });
    }
    if (c.expected) {
      result += `  预期：${c.expected}\n`;
    }
    return result;
  }).join('\n');
  
  navigator.clipboard.writeText(text).then(() => {
    addIslandMessage('system', '已复制到剪贴板，可直接粘贴到团队文档或聊天');
  });
}

function exportCases() {
  // 显示导出选项
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.3)';
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl w-full max-w-sm mx-4" style="box-shadow: 0 4px 24px rgba(0,0,0,0.08)">
      <div class="p-5 border-b border-zinc-100">
        <h3 class="text-base font-medium text-zinc-800">导出用例</h3>
      </div>
      <div class="p-5 space-y-3">
        <button class="export-option w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors" data-format="zentao">
          <div class="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 10h16M4 14h10M4 18h10"/></svg>
          </div>
          <div class="text-left">
            <p class="text-sm font-medium text-zinc-800">禅道导入 CSV</p>
            <p class="text-xs text-zinc-400">模块、标题、步骤、预期、优先级</p>
          </div>
        </button>
        <button class="export-option w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors" data-format="excel">
          <div class="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <div class="text-left">
            <p class="text-sm font-medium text-zinc-800">Excel (.xlsx)</p>
            <p class="text-xs text-zinc-400">可导入 Jira、禅道、飞书多维表格</p>
          </div>
        </button>
        <button class="export-option w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors" data-format="csv">
          <div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <div class="text-left">
            <p class="text-sm font-medium text-zinc-800">CSV (.csv)</p>
            <p class="text-xs text-zinc-400">通用格式，可用 Excel 打开</p>
          </div>
        </button>
        <button class="export-option w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors" data-format="xmind">
          <div class="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
            <svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <div class="text-left">
            <p class="text-sm font-medium text-zinc-800">XMind (.xmind)</p>
            <p class="text-xs text-zinc-400">思维导图格式</p>
          </div>
        </button>
      </div>
      <div class="p-4 border-t border-zinc-100">
        <button class="close-export-modal w-full py-2 text-sm text-zinc-500 hover:text-zinc-700">取消</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.close-export-modal').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  
  modal.querySelectorAll('.export-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      modal.remove();
      
      if (format === 'zentao') {
        exportToZentaoCsv();
      } else if (format === 'excel') {
        exportToExcel();
      } else if (format === 'csv') {
        exportToCsv();
      } else if (format === 'xmind') {
        exportToXmind();
      }
    });
  });
}

function addCaseDownloadMessage(totalCases) {
  const chat = $('#island-chat');
  const count = totalCases || getAllCases().length;
  if (!chat || !count) return;

  chat.querySelector('.case-download-card')?.remove();

  const div = document.createElement('div');
  div.className = 'island-message case-download-card';
  div.innerHTML = `
    <div class="flex gap-2">
      <div class="w-6 h-6 rounded-full overflow-hidden shrink-0">
        <span class="prism-avatar" aria-hidden="true"></span>
      </div>
      <div class="bg-amber-50 border border-amber-100 rounded-2xl rounded-tl-md px-3.5 py-3 text-xs text-amber-800 max-w-[86%] leading-relaxed">
        <div class="font-medium">用例文档已准备好</div>
        <div class="mt-1 text-amber-700/80">共 ${count} 条，可下载为禅道导入 CSV。</div>
        <button class="download-zentao-cases mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium">下载禅道 CSV</button>
      </div>
    </div>`;

  chat.appendChild(div);
  div.querySelector('.download-zentao-cases')?.addEventListener('click', exportToZentaoCsv);
  chat.scrollTop = chat.scrollHeight;
}

// ========== 导出 XMind ==========
async function exportToXmind() {
  if (!state.mindMap) {
    addIslandMessage('system', '没有可导出的用例');
    return;
  }
  
  try {
    const zip = new JSZip();
    
    // 构建 content.xml
    const contentXml = buildXmindContentXml(state.mindMap);
    zip.file('content.xml', contentXml);
    
    // 构建 metadata.xml
    const metadataXml = buildXmindMetadataXml();
    zip.file('metadata.xml', metadataXml);
    
    // 生成 ZIP 文件
    const blob = await zip.generateAsync({ type: 'blob' });
    
    // 下载
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scout-cases-${Date.now()}.xmind`;
    a.click();
    URL.revokeObjectURL(url);
    
    addIslandMessage('system', '已导出 XMind 文件');
  } catch (error) {
    console.error('导出 XMind 失败:', error);
    addIslandMessage('system', '导出失败: ' + error.message);
  }
}

function buildXmindContentXml(mindMap) {
  const timestamp = Date.now();
  
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
`;
  xml += `<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"
`;
  xml += `    xmlns:fo="http://www.w3.org/1999/XSL/Format"
`;
  xml += `    xmlns:svg="http://www.w3.org/2000/svg"
`;
  xml += `    xmlns:xhtml="http://www.w3.org/1999/xhtml"
`;
  xml += `    xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">
`;
  xml += `  <sheet id="sheet_${timestamp}" timestamp="${timestamp}">
`;
  xml += `    <topic id="root_${timestamp}" timestamp="${timestamp}">
`;
  xml += `      <title>${escapeXml(mindMap.title || '测试用例')}</title>
`;
  
  // 递归添加子节点
  if (mindMap.children && mindMap.children.length > 0) {
    xml += `      <children>
`;
    xml += `        <topics structure-class="org.xmind.ui.map.unbalanced">
`;
    mindMap.children.forEach((child, index) => {
      xml += buildXmindTopicXml(child, `${timestamp}_${index}`, 1);
    });
    xml += `        </topics>
`;
    xml += `      </children>
`;
  }
  
  xml += `    </topic>
`;
  xml += `  </sheet>
`;
  xml += `</xmap-content>`;
  
  return xml;
}

function buildXmindTopicXml(node, idSuffix, depth) {
  const id = `topic_${idSuffix}`;
  let xml = `          <topic id="${id}" timestamp="${Date.now()}">
`;
  xml += `            <title>${escapeXml(node.title || '')}</title>
`;
  
  // 添加样式
  if (node.type === 'step' || node.type === 'expected') {
    xml += `            <labels>
`;
    xml += `              <label>${node.type === 'step' ? '步骤' : '预期'}</label>
`;
    xml += `            </labels>
`;
  }
  
  // 添加优先级标记
  if (node.priority) {
    xml += `            <marker-refs>
`;
    xml += `              <marker-ref marker-id="priority-${node.priority.replace('P', '')}"/>
`;
    xml += `            </marker-refs>
`;
  }
  
  // 递归添加子节点
  if (node.children && node.children.length > 0) {
    xml += `            <children>
`;
    xml += `              <topics structure-class="org.xmind.ui.map.unbalanced">
`;
    node.children.forEach((child, index) => {
      xml += buildXmindTopicXml(child, `${idSuffix}_${index}`, depth + 1);
    });
    xml += `              </topics>
`;
    xml += `            </children>
`;
  }
  
  xml += `          </topic>
`;
  return xml;
}

function buildXmindMetadataXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<metadata xmlns="urn:xmind:xmap:xmlns:meta:2.0" version="2.0">
  <Author>
    <Name>Prism</Name>
  </Author>
  <Create>
    <Time>${now}</Time>
  </Create>
</metadata>`;
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ========== 导出 Excel ==========
function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadTextFile(content, filename, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\ufeff' + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function priorityToZentao(priority) {
  const normalized = String(priority || 'P2').toUpperCase();
  if (normalized === 'P0') return '1';
  if (normalized === 'P1') return '2';
  if (normalized === 'P2') return '3';
  return '4';
}

function exportToZentaoCsv() {
  const allCases = getAllCases();
  if (!allCases.length) {
    addIslandMessage('system', '没有可导出的用例');
    return;
  }

  try {
    const rows = [[
      '所属模块',
      '用例标题',
      '前置条件',
      '步骤',
      '预期',
      '关键词',
      '优先级',
      '用例类型',
      '适用阶段'
    ]];

    allCases.forEach(item => {
      const steps = (item.steps || []).map((step, index) => `${index + 1}. ${step}`).join('\n');
      const tags = [item.productName, item.category, item.source].filter(Boolean).join(' ');
      rows.push([
        item.moduleName || item.category || '未分类',
        item.title || '',
        item.source || '',
        steps,
        item.expected || '',
        tags,
        priorityToZentao(item.priority),
        '功能测试',
        '功能测试阶段'
      ]);
    });

    const csvContent = rows.map(row => row.map(csvCell).join(',')).join('\n');
    const name = (getMindMapRootTitle() || 'prism-cases').replace(/[\\/:*?"<>|]/g, '_');
    downloadTextFile(csvContent, `${name}-zentao-${Date.now()}.csv`);
    addIslandMessage('system', '已下载禅道导入 CSV');
  } catch (error) {
    console.error('导出禅道 CSV 失败:', error);
    addIslandMessage('system', '导出失败: ' + error.message);
  }
}

function exportToExcel() {
  if (!state.categories || state.categories.length === 0) {
    addIslandMessage('system', '没有可导出的用例');
    return;
  }
  
  try {
    // 构建 CSV 内容（用 tab 分隔，Excel 可直接打开）
    const rows = [['分类', '用例标题', '优先级', '来源', '步骤', '预期结果', '状态']];
    
    state.categories.forEach(cat => {
      (cat.cases || []).forEach(c => {
        const steps = (c.steps || []).map((s, i) => `${i+1}. ${s}`).join('\n');
        const status = state.canvas?.state.caseStatus[c.id] || '未标记';
        rows.push([cat.name, c.title, c.priority || 'P1', c.source || '', steps, c.expected || '', status]);
      });
    });
    
    // 转为 CSV
    const csvContent = rows.map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    // 添加 BOM 头，确保中文正常显示
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scout-cases-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    addIslandMessage('system', '已导出 Excel 文件');
  } catch (error) {
    console.error('导出 Excel 失败:', error);
    addIslandMessage('system', '导出失败: ' + error.message);
  }
}

// ========== 导出 CSV ==========
function exportToCsv() {
  if (!state.categories || state.categories.length === 0) {
    addIslandMessage('system', '没有可导出的用例');
    return;
  }
  
  try {
    const rows = [['分类', '用例标题', '优先级', '来源', '步骤', '预期结果', '状态']];
    
    state.categories.forEach(cat => {
      (cat.cases || []).forEach(c => {
        const steps = (c.steps || []).map((s, i) => `${i+1}. ${s}`).join(' | ');
        const status = state.canvas?.state.caseStatus[c.id] || '未标记';
        rows.push([cat.name, c.title, c.priority || 'P1', c.source || '', steps, c.expected || '', status]);
      });
    });
    
    const csvContent = rows.map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scout-cases-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    addIslandMessage('system', '已导出 CSV 文件');
  } catch (error) {
    console.error('导出 CSV 失败:', error);
    addIslandMessage('system', '导出失败: ' + error.message);
  }
}

// ========== 开始分析（流式） ==========
async function startAnalysis() {
  console.log('[startAnalysis] 当前 Tab:', state.activeTab, 'isAnalyzing:', state.isAnalyzing);
  if (state.isAnalyzing) {
    console.log('[startAnalysis] 正在执行中，跳过');
    return;
  }
  state.isAnalyzing = true;
  
  try {
    // 根据当前 Tab 执行不同功能
    if (state.activeTab === 'analyze') {
      await startRequirementAnalysis();
      return;
    }
    if (state.activeTab === 'run') {
      await startAIRun();
      return;
    }
    if (state.activeTab === 'regression') {
      await startBugRegression();
      return;
    }
    if (state.activeTab === 'report') {
      await startTestReport();
      return;
    }
    if (state.activeTab === 'scripts') {
      await openScriptWorkspace();
      return;
    }

  state.currentSessionId = null;
  state.chatHistory = [];
  state.selectedCategory = null;
  state.projectName = '';
  state.requirementName = getMindMapRootTitle();
  state.requirementVersion = 'V1.0';
  const visionFiles = getVisionFilesPayload();
  const requirementContent = getRequirementPayloadText('用户上传了视觉需求材料，请直接阅读图片/原型截图生成测试用例。');
  
  switchView('engine');
  if (state.canvas) state.canvas.clear();
  state.categories = [];
  renderCanvasModuleNav();
  
  // 显示需求/项目信息
  updateEngineHeaderMeta();
  
  const chatArea = $('#scout-chat');
  
  // 清空对话区
  if (chatArea) chatArea.innerHTML = '';
  
  // Prism 开始对话
  await scoutSay('收到，让我看看这个需求...', 800);
  
  // 更新状态栏
  const engineStatus = $('#engine-status');
  if (engineStatus) engineStatus.textContent = '用例正在生成';
  
  // 启动动态思考过程，最后一步时跳转到画布
  startThinkingProcess(requirementContent, () => {
    // 思考过程结束，立即跳转到画布
    transitionToCanvas(() => {
      const genId = () => Math.random().toString(36).substr(2, 9);
      const root = { id: genId(), title: getMindMapRootTitle(), _depth: 0, children: [] };
      state.mindMap = root;
      state.canvas?.setMindMap(root);
      
      // 显示画布 Loading 状态
      state.canvas?.showLoading('正在连接模型...');
      state.canvas?.updateLoadingProgress(10, '正在连接模型...');
    });
  });
  
  const displayedCaseIds = new Set();
  
  try {
    // 尝试流式生成 — 分隔符协议
    let finalData;
    
    try {
      const response = await fetch(`${API_BASE}/generate-cases-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: requirementContent,
          productName: getMindMapRootTitle(),
          visionFiles
        })
      });
      
      if (!response.ok) throw new Error('Stream API not available');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let firstCaseShown = false;
      const categoryMap = {}; // { categoryName: { type, name, cases: [] } }
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));

              if (currentEvent === 'progress' && payload.message) {
                const progress = payload.message.includes('分析') ? 35 : 20;
                state.canvas?.updateLoadingProgress(progress, payload.message);
                if (engineStatus) engineStatus.textContent = payload.message;
              }

              if (currentEvent === 'analysis' && payload.modules) {
                state.canvas?.updateLoadingProgress(50, `已识别 ${payload.modules.length} 个模块`);
                if (engineStatus) engineStatus.textContent = `已识别 ${payload.modules.length} 个模块`;
              }
              
              // 单条用例事件 — 立刻渲染
              if (currentEvent === 'case' && payload.case) {
                const c = payload.case;
                const catName = c.category || '未分类';
                
                if (!firstCaseShown) {
                  firstCaseShown = true;
                  stopThinkingProcess();
                  // 隐藏画布 Loading
                  state.canvas?.hideLoading();
                }
                
                // 添加到分类 map
                if (!categoryMap[catName]) {
                  categoryMap[catName] = { type: catName, name: catName, cases: [] };
                }
                categoryMap[catName].cases.push(c);
                const generatedCount = Object.values(categoryMap)
                  .reduce((sum, category) => sum + category.cases.length, 0);
                if (engineStatus) engineStatus.textContent = `已生成 ${generatedCount} 条用例`;
                
                // 更新 state
                state.categories = Object.values(categoryMap);
                renderCanvasModuleNav(catName);
                
                // 弹幕排队显示
                showDanmaku(catName, c);
                
                // 增量更新画布并聚焦新节点
                const newNode = state.canvas?.addCaseNode(catName, c);
                if (newNode) {
                  focusNewCaseNode(newNode);
                }
              }
              
              // 完成事件
              if (currentEvent === 'complete' && payload.categories) {
                finalData = payload;
              }
            } catch (e) {}
          }
        }
      }
      
      // 使用最终数据（兜底）
      if (finalData) {
        state.categories = finalData.categories;
      }
    } catch (e) {
      // 流式失败，使用普通 API
      console.log('流式不可用，使用普通 API');
      
      stopThinkingProcess();
      // 隐藏画布 Loading
      state.canvas?.hideLoading();
      await scoutSay('正在一次性生成用例...', 0);
      
      const response = await fetch(`${API_BASE}/generate-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: requirementContent,
          productName: getMindMapRootTitle(),
          visionFiles
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        state.categories = data.cases;
        
        // 非流式也要逐条展示
        await scoutSay('用例生成完毕，逐条展示给你看 ↓', 300);
        for (const cat of state.categories) {
          for (const c of (cat.cases || [])) {
            showDanmaku(cat.name, c);
            await sleep(400);
          }
        }
      } else {
        throw new Error(data.error);
      }
    }
    
    // 构建思维导图（画布已在流式过程中增量更新，这里不再重刷）
    stopThinkingProcess();
    stopDanmaku();
    state.mindMap = buildMindMap(state.categories);
    
    // 完成
    const totalCases = state.categories.reduce((sum, cat) => sum + (cat.cases?.length || 0), 0);
    
    console.log('[保存调试] totalCases:', totalCases, 'mindMap:', state.mindMap ? 'exists' : 'null', 'categories:', state.categories.length);
    
    // 适配视图，确保所有节点可见
    if (state.mindMap) {
      // 不再重绘画布，因为已经在流式过程中增量更新了
      await sleep(50);
      state.canvas.fitToView();
      renderCanvasModuleNav();
      
      // 更新状态栏
      if (engineStatus) engineStatus.textContent = '用例已就绪';
      
      // 生成覆盖率分析
      const coverage = analyzeCoverage(state.categories);
      
      // Prism 完成对话
      await scoutSay(`好了，一共写了 ${totalCases} 条用例，你看看有没有要调整的`, 0);
      await scoutSay(coverage, 0);
      
      // 更新灵动岛状态并显示
      updateChatIslandStatus('ready', `${totalCases} 条用例就绪`);
      
      const island = $('#dynamic-island');
      if (island) {
        island.classList.remove('hidden');
        island.style.opacity = '0';
        island.style.transform = 'translateX(-50%) translateY(16px)';
        await sleep(50);
        island.style.opacity = '1';
        island.style.transform = 'translateX(-50%) translateY(0)';
      }
      
      // 保存会话
      await saveSession(totalCases);
      updateEngineHeaderMeta();
      
      // 显示画布对话条
      showCanvasChat();
      addCaseDownloadMessage(totalCases);
    }
    
  } catch (error) {
    console.error('分析失败:', error);
    await scoutSay(`出了点问题：${error.message}`, 0);
  } finally {
    stopThinkingProcess();
    // 确保隐藏画布 Loading
    state.canvas?.hideLoading();
    state.isAnalyzing = false;
  }
  } catch (error) {
    console.error('[startAnalysis] 异常:', error);
    state.isAnalyzing = false;
  }
}

// ========== 在聊天区渲染单条用例 ==========
// ========== 弹幕队列系统 ==========
const danmakuQueue = [];
let danmakuActive = false;

function showDanmaku(categoryName, c) {
  // 弹幕内容：真诚表达“我帮你考虑了什么”
  const reasons = [
    `帮你想到了「${c.title}」这个场景`,
    `这条是怕你漏掉「${c.title}」`,
    `「${c.title}」容易出问题，帮你加了`,
    `想到了${categoryName}里的「${c.title}」`,
    `帮你覆盖一下「${c.title}」`,
  ];
  let text = reasons[Math.floor(Math.random() * reasons.length)];
  if (c.source) {
    text += ` ← ${c.source}`;
  }
  
  // 入队
  danmakuQueue.push({ text });
  processDanmakuQueue();
}

function processDanmakuQueue() {
  if (danmakuActive || danmakuQueue.length === 0) return;
  danmakuActive = true;
  
  const { text } = danmakuQueue.shift();
  
  const el = document.createElement('div');
  el.className = 'danmaku';
  el.textContent = text;
  document.body.appendChild(el);
  
  requestAnimationFrame(() => {
    el.classList.add('danmaku-show');
  });
  
  // 3 秒后淡出，然后处理下一条
  setTimeout(() => {
    el.classList.add('danmaku-hide');
    setTimeout(() => {
      el.remove();
      danmakuActive = false;
      processDanmakuQueue();
    }, 400);
  }, 3000);
}

// 停止弹幕队列（生成完成后调用）
function stopDanmaku() {
  danmakuQueue.length = 0;
  // 等当前这条自然结束即可
}

// ========== 画布协作对话（融入灵动岛） ==========
function showCanvasChat() {
  // 显示灵动岛
  const island = $('#dynamic-island');
  if (island && island.classList.contains('hidden')) {
    island.classList.remove('hidden');
    island.style.opacity = '0';
    island.style.transform = 'translateX(-50%) translateY(16px)';
    requestAnimationFrame(() => {
      island.style.opacity = '1';
      island.style.transform = 'translateX(-50%) translateY(0)';
    });
  }
  
  // 更新灵动岛状态提示
  updateChatIslandStatus('ready', '可协作调整');
  
  const input = $('#island-input');
  const sendBtn = $('#btn-island-send');
  
  let isChatting = false;
  
  // 清空之前的欢迎消息，重新生成
  const chat = $('#island-chat');
  if (chat) {
    // 构建分类列表
    let categoryHtml = '';
    if (state.categories && state.categories.length > 0) {
      const catItems = state.categories.map(cat => {
        const count = cat.cases?.length || 0;
        return `<span class="island-category-tag" data-category="${cat.name}">${cat.name} (${count})</span>`;
      }).join('');
      categoryHtml = `
        <div class="flex flex-wrap gap-1.5 mt-2">
          ${catItems}
        </div>
      `;
    }
    
    chat.innerHTML = `
      <div class="island-message">
        <div class="flex gap-2">
          <div class="w-6 h-6 rounded-full overflow-hidden shrink-0">
            <span class="prism-avatar" aria-hidden="true"></span>
          </div>
          <div class="bg-zinc-50 rounded-2xl rounded-tl-md px-3.5 py-2.5 text-xs text-zinc-600 leading-relaxed">
            用例已生成，告诉我怎么调整
            ${categoryHtml}
          </div>
        </div>
      </div>
    `;

    const history = getChatHistory();
    if (history.length) {
      const divider = document.createElement('div');
      divider.className = 'island-history-divider';
      divider.innerHTML = '<span>上次对话</span>';
      chat.appendChild(divider);
      history.forEach(item => {
        const categoryPrefix = item.category && item.role === 'user' ? `[${item.category}] ` : '';
        addIslandMessage(item.role === 'assistant' ? 'scout' : item.role, categoryPrefix + item.content);
      });
    }
    
    // 分类标签点击事件
    chat.querySelectorAll('.island-category-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const catName = tag.dataset.category;
        state.selectedCategory = catName;
        // 高亮选中
        chat.querySelectorAll('.island-category-tag').forEach(t => t.classList.remove('selected'));
        tag.classList.add('selected');
        // 更新输入框提示
        const input = $('#island-input');
        if (input) {
          input.placeholder = `针对「${catName}」进行调整...`;
          input.focus();
        }
      });
    });
  }
  
  // 输入框事件
  input?.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim();
  });
  
  // 发送消息
  async function sendMessage() {
    const msg = input?.value?.trim();
    if (!msg || isChatting) return;
    
    input.value = '';
    sendBtn.disabled = true;
    isChatting = true;
    
    // 添加用户消息
    const userMsg = state.selectedCategory 
      ? `[${state.selectedCategory}] ${msg}` 
      : msg;
    addIslandMessage('user', userMsg);
    const previousHistory = getChatHistory().slice();
    saveChatMessage('user', msg);
    
    // 收集当前用例
    const allCases = [];
    if (state.categories) {
      state.categories.forEach(cat => {
        (cat.cases || []).forEach(c => allCases.push(c));
      });
    }
    
    // 显示思考状态
    const thinkingId = addIslandThinking();
    const stopWaitingFeedback = startIslandThinkingFeedback(thinkingId);
    
    let newCasesAdded = 0;
    let casesUpdated = 0;
    let scoutReply = '';
    let replyShown = false;
    const categoryMap = {};
    const requestController = new AbortController();
    const requestTimeout = null;
    
    // 复制已有分类
    if (state.categories) {
      state.categories.forEach(cat => {
        categoryMap[cat.name] = { ...cat, cases: [...(cat.cases || [])] };
      });
    }
    
    try {
      const response = await fetch(`${API_BASE}/canvas-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: msg, 
          cases: allCases,
          selectedCategory: state.selectedCategory,
          history: previousHistory
        }),
        signal: requestController.signal
      });
      
      if (!response.ok || !response.body) {
        throw new Error(`Canvas chat failed: ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let textBuffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              
              if (currentEvent === 'case' && payload.case) {
                const c = payload.case;
                const catName = c.category || '未分类';
                
                if (!categoryMap[catName]) {
                  categoryMap[catName] = { type: catName, name: catName, cases: [] };
                }
                categoryMap[catName].cases.push(c);
                
                state.categories = Object.values(categoryMap);
                const newNode = state.canvas?.addCaseNode(catName, c);
                renderCanvasModuleNav(catName);
                if (newNode) focusNewCaseNode(newNode);
                newCasesAdded++;
                
                // 更新状态
                updateChatIslandStatus('analyzing', `已添加 ${newCasesAdded} 条用例...`);
              } else if (currentEvent === 'reply' && payload.text) {
                scoutReply = payload.text;
                if (!replyShown) {
                  addIslandMessage('scout', scoutReply);
                  saveChatMessage('assistant', scoutReply);
                  replyShown = true;
                }
                stopWaitingFeedback();
                removeIslandThinking(thinkingId);
              } else if (currentEvent === 'update' && payload.case) {
                if (applyCaseUpdate(payload.case)) {
                  casesUpdated++;
                  updateChatIslandStatus('analyzing', `已修改 ${casesUpdated} 条用例...`);
                }
              } else if (currentEvent === 'progress') {
                updateIslandThinking(
                  thinkingId,
                  payload.message || '模型正在处理',
                  payload.elapsed ? `已等待 ${payload.elapsed} 秒 · 完整上下文 ${payload.cases || allCases.length} 条用例` : '正在准备上下文'
                );
                updateChatIslandStatus('analyzing', payload.message || '模型正在处理');
              } else if (currentEvent === 'complete') {
                stopWaitingFeedback();
                removeIslandThinking(thinkingId);
              }
            } catch (e) {}
          }
        }
      }
      
      // 移除思考状态
      removeIslandThinking(thinkingId);
      
      // 构建 Prism 的回复
      if (casesUpdated > 0) {
        scoutReply = `已直接修改导图中的 ${casesUpdated} 条用例`;
        showDanmaku('协作', `修改 ${casesUpdated} 条用例`);
      } else if (newCasesAdded > 0) {
        scoutReply = `收到！已补充 ${newCasesAdded} 条用例，你看看还需要调整吗？`;
        // 弹幕提示新用例
        showDanmaku('协作', `新增 ${newCasesAdded} 条用例`);
        persistCanvasChatChanges();
      } else {
        scoutReply = '好的，我理解你的意思了。还有什么需要调整的吗？';
      }
      
      // 显示 Prism 回复
      if (!replyShown) {
        addIslandMessage('scout', scoutReply);
        saveChatMessage('assistant', scoutReply);
      }
      
    } catch (e) {
      removeIslandThinking(thinkingId);
      const errorReply = e?.name === 'AbortError' ? '模型响应超时了，请再试一次' : '出了点问题，请稍后再试';
      addIslandMessage('scout', errorReply);
      saveChatMessage('assistant', errorReply);
    } finally {
      stopWaitingFeedback();
      if (requestTimeout) clearTimeout(requestTimeout);
      isChatting = false;
      updateChatIslandStatus('ready', '可协作调整');
    }
  }
  
  // 绑定事件（避免重复绑定）
  if (!sendBtn._bound) {
    sendBtn.addEventListener('click', sendMessage);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    sendBtn._bound = true;
  }
}

// 添加灵动岛思考状态
function addIslandThinking() {
  const chat = $('#island-chat');
  if (!chat) return null;
  
  const id = 'thinking-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'island-message flex gap-2';
  div.innerHTML = `
    <div class="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 overflow-hidden">
      <span class="prism-avatar" aria-hidden="true"></span>
    </div>
    <div class="island-thinking-bubble">
      <div class="island-thinking-copy">
        <strong class="island-thinking-label">正在理解你的调整</strong>
        <small class="island-thinking-time">刚刚开始</small>
        <div class="island-thinking-progress"><span></span></div>
      </div>
      <div class="island-thinking-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return id;
}

function startIslandThinkingFeedback(thinkingId) {
  const startedAt = Date.now();
  let stopped = false;
  const phases = [
    { after: 0, label: '正在理解你的调整', status: '正在读取当前用例' },
    { after: 3, label: '正在整理相关用例', status: '正在构建修改上下文' },
    { after: 8, label: '模型正在分析', status: '结果生成后会立即显示' },
    { after: 18, label: '仍在认真处理', status: '复杂调整可能需要一点时间' }
  ];

  const update = () => {
    if (stopped) return;
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const phase = [...phases].reverse().find(item => seconds >= item.after) || phases[0];
    const thinking = document.getElementById(thinkingId);
    const label = thinking?.querySelector('.island-thinking-label');
    const time = thinking?.querySelector('.island-thinking-time');
    const progress = thinking?.querySelector('.island-thinking-progress span');
    if (label) label.textContent = thinking?.dataset.label || phase.label;
    if (time) time.textContent = thinking?.dataset.detail || (seconds < 1 ? '刚刚开始' : `已等待 ${seconds} 秒`);
    if (progress) progress.style.width = `${Math.min(92, 10 + seconds * 4)}%`;
    updateChatIslandStatus('analyzing', thinking?.dataset.status || phase.status);
  };

  update();
  const timer = setInterval(update, 1000);
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}

function updateIslandThinking(thinkingId, label, detail) {
  const thinking = document.getElementById(thinkingId);
  if (!thinking) return;
  if (label) thinking.dataset.label = label;
  if (label) thinking.dataset.status = label;
  if (detail) thinking.dataset.detail = detail;
  const labelEl = thinking.querySelector('.island-thinking-label');
  const detailEl = thinking.querySelector('.island-thinking-time');
  if (labelEl && label) labelEl.textContent = label;
  if (detailEl && detail) detailEl.textContent = detail;
}

// 移除灵动岛思考状态
function removeIslandThinking(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ========== Prism 说话 ==========
async function scoutSay(text, delayAfter = 1000) {
  const chatArea = $('#scout-chat');
  if (!chatArea) return;
  
  const msg = document.createElement('div');
  msg.className = 'flex gap-3 scout-message';
  msg.innerHTML = `
    <div class="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
      <span class="prism-avatar" aria-hidden="true"></span>
    </div>
    <div class="flex-1">
      <p class="text-sm text-zinc-600 leading-relaxed scout-text"></p>
    </div>
  `;
  
  chatArea.appendChild(msg);
  
  // 打字效果
  const textEl = msg.querySelector('.scout-text');
  for (let i = 0; i < text.length; i++) {
    textEl.textContent = text.substring(0, i + 1);
    await sleep(30);
  }
  
  chatArea.scrollTop = chatArea.scrollHeight;
  
  if (delayAfter > 0) {
    await sleep(delayAfter);
  }
}

// ========== 更新最后一条 Prism 消息 ==========
function updateLastPrismMessage(text) {
  const chatArea = $('#scout-chat');
  if (!chatArea) return;
  
  const messages = chatArea.querySelectorAll('.scout-text');
  if (messages.length > 0) {
    messages[messages.length - 1].textContent = text;
  }
}

function setEngineWorkspaceWidth(mode = 'normal') {
  const workspace = $('#engine-center > div');
  if (!workspace) return;
  workspace.classList.toggle('max-w-lg', mode !== 'wide');
  workspace.classList.toggle('max-w-4xl', mode === 'wide');
}

function createAnalysisProgressCard() {
  const chatArea = $('#scout-chat');
  if (!chatArea) return null;

  const startedAt = Date.now();
  const phases = [
    '正在连接模型',
    '正在阅读需求内容',
    '正在拆模块和流程',
    '正在识别风险与边界',
    '正在整理分析报告'
  ];

  const card = document.createElement('div');
  card.className = 'analysis-progress-card flex gap-3 scout-message';
  card.innerHTML = `
    <div class="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
      <span class="prism-avatar" aria-hidden="true"></span>
    </div>
    <div class="flex-1">
      <div class="bg-white border border-zinc-100 rounded-xl p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="analysis-progress-title text-sm font-medium text-zinc-800">正在连接模型</div>
            <div class="analysis-progress-sub text-xs text-zinc-400 mt-1">已等待 0 秒，模型正在处理，不是卡住</div>
          </div>
          <div class="analysis-progress-spinner w-5 h-5 rounded-full border-2 border-zinc-200 border-t-indigo-500 animate-spin shrink-0"></div>
        </div>
        <div class="mt-3 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div class="analysis-progress-fill h-full bg-indigo-500 rounded-full transition-all duration-500" style="width: 12%"></div>
        </div>
        <div class="analysis-stream mt-3 hidden border border-zinc-100 rounded-lg bg-zinc-50 p-2 max-h-44 overflow-auto">
          <pre class="analysis-stream-text whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-500"></pre>
        </div>
        <div class="analysis-progress-tip text-[11px] text-zinc-400 mt-2">下面会实时显示模型输出，看到文字流就说明还在跑。</div>
      </div>
    </div>
  `;
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;

  let index = 0;
  const update = (title) => {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const phase = title || phases[Math.min(index, phases.length - 1)];
    const percent = Math.min(92, 12 + elapsed * 2 + index * 12);
    card.querySelector('.analysis-progress-title').textContent = phase;
    card.querySelector('.analysis-progress-sub').textContent = `已等待 ${elapsed} 秒，模型正在处理，不是卡住`;
    card.querySelector('.analysis-progress-fill').style.width = `${percent}%`;
    if (elapsed >= 30) {
      card.querySelector('.analysis-progress-tip').textContent = '还在持续等待模型。自定义模型慢一点没关系，只要连接不断就会继续接收。';
    }
    chatArea.scrollTop = chatArea.scrollHeight;
  };

  const timer = setInterval(() => {
    index = Math.min(index + 1, phases.length - 1);
    update();
  }, 6000);

  return {
    update,
    appendToken(text) {
      if (!text) return;
      const stream = card.querySelector('.analysis-stream');
      const streamText = card.querySelector('.analysis-stream-text');
      stream?.classList.remove('hidden');
      streamText.textContent += text;
      stream.scrollTop = stream.scrollHeight;
      card.querySelector('.analysis-progress-title').textContent = '模型正在输出分析内容';
      card.querySelector('.analysis-progress-sub').textContent = `已收到 ${streamText.textContent.length} 个字符，持续生成中`;
      card.querySelector('.analysis-progress-fill').style.width = '88%';
      chatArea.scrollTop = chatArea.scrollHeight;
    },
    done(title = '分析完成，正在展示报告') {
      clearInterval(timer);
      card.querySelector('.analysis-progress-title').textContent = title;
      card.querySelector('.analysis-progress-sub').textContent = '模型已返回，报告整理好了';
      card.querySelector('.analysis-progress-fill').style.width = '100%';
      card.querySelector('.analysis-progress-spinner')?.classList.remove('animate-spin', 'border-t-indigo-500');
      card.querySelector('.analysis-progress-spinner')?.classList.add('border-green-500');
    },
    fail(title = '分析失败') {
      clearInterval(timer);
      card.querySelector('.analysis-progress-title').textContent = title;
      card.querySelector('.analysis-progress-sub').textContent = '这次请求没有正常完成，可以稍后重试';
      card.querySelector('.analysis-progress-fill').classList.remove('bg-indigo-500');
      card.querySelector('.analysis-progress-fill').classList.add('bg-red-500');
      card.querySelector('.analysis-progress-spinner')?.classList.remove('animate-spin', 'border-t-indigo-500');
      card.querySelector('.analysis-progress-spinner')?.classList.add('border-red-400');
    },
    stop() {
      clearInterval(timer);
    }
  };
}

// ========== Agent 动态思考过程（优雅版） ==========
let _thinkInterval = null;

function startThinkingProcess(requirement, onLastStep) {
  const chatArea = $('#scout-chat');
  if (!chatArea) return;

  const steps = [
    { icon: '→', text: '在看你的需求...' },
    { icon: '→', text: '梳理一下要测哪些东西...' },
    { icon: '→', text: '想想哪些场景容易出问题...' },
    { icon: '→', text: '把正常流程和异常情况都考虑到...' },
    { icon: '✓', text: '差不多了，开始写用例...', isLast: true },
  ];

  // 创建思考步骤容器（带优雅动画）
  const container = document.createElement('div');
  container.id = 'thinking-steps';
  container.className = 'thinking-steps-container';
  chatArea.appendChild(container);

  let index = 0;
  const showNextStep = () => {
    if (index >= steps.length) return;
    
    // 移除上一条的 active 标记
    const prev = container.querySelector('.thinking-step-active');
    if (prev) {
      prev.classList.remove('thinking-step-active');
      prev.classList.add('thinking-step-done');
    }

    const step = steps[index];
    const div = document.createElement('div');
    div.className = `thinking-step thinking-step-active ${step.highlight ? 'thinking-step-highlight' : ''}`;
    
    if (step.highlight) {
      div.innerHTML = `
        <span class="thinking-icon">${step.icon}</span>
        <span class="thinking-text">${step.text}</span>
        <span class="thinking-cursor"></span>
      `;
    } else {
      div.innerHTML = `
        <span class="thinking-icon">${step.icon}</span>
        <span class="thinking-text">${step.text}</span>
      `;
    }
    
    container.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
    index++;
  };

  // 立即显示第一条，之后每 3 秒一条
  showNextStep();
  _thinkInterval = setInterval(() => {
    showNextStep();
    if (index >= steps.length) {
      clearInterval(_thinkInterval);
      _thinkInterval = null;
      // 最后一步显示后，调用回调（跳转到画布）
      if (onLastStep) onLastStep();
    }
  }, 3000);
}

// 用后端分析结果更新思考过程


function stopThinkingProcess() {
  if (_thinkInterval) {
    clearInterval(_thinkInterval);
    _thinkInterval = null;
  }
  // 最后一步标记完成
  const active = document.querySelector('.thinking-step-active');
  if (active) {
    active.classList.remove('thinking-step-active');
    active.classList.add('thinking-step-done');
    const cursor = active.querySelector('.thinking-cursor');
    if (cursor) cursor.remove();
  }
}

// ========== 跳转到画布的平滑过渡 ==========
function transitionToCanvas(callback) {
  const engineCenter = $('#engine-center');
  if (!engineCenter) {
    callback?.();
    return;
  }
  
  // 添加淡出动画
  engineCenter.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
  engineCenter.style.opacity = '0';
  engineCenter.style.transform = 'scale(0.98) translateY(-20px)';
  
  setTimeout(() => {
    engineCenter.classList.add('hidden');
    // 淡入画布
    const canvasContainer = $('#canvas-container');
    if (canvasContainer) {
      canvasContainer.style.opacity = '0';
      canvasContainer.style.transform = 'scale(0.98)';
      canvasContainer.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
      
      requestAnimationFrame(() => {
        canvasContainer.style.opacity = '1';
        canvasContainer.style.transform = 'scale(1)';
      });
    }
    
    // 显示底部状态栏
    const statusBar = $('#canvas-status-bar');
    if (statusBar) {
      statusBar.style.opacity = '1';
    }
    
    callback?.();
  }, 500);
}

// ========== 新用例聚焦效果 ==========
function focusNewCaseNode(nodeElement) {
  if (!nodeElement) return;

  // 添加聚焦动画类
  nodeElement.classList.add('node-focus-new');

  // 在画布内部平移到新节点，避免触发外层滚动导致整体界面不可滑动
  state.canvas?.focusNode?.(nodeElement);

  // 2 秒后移除聚焦效果
  setTimeout(() => {
    nodeElement.classList.remove('node-focus-new');
  }, 2000);
}

// ========== 需求分析 ==========
async function startRequirementAnalysis() {
  console.log('[分析] 开始需求分析...');
  switchView('engine');
  setEngineWorkspaceWidth('wide');
  const visionFiles = getVisionFilesPayload();
  const requirementContent = getRequirementPayloadText('用户上传了视觉需求材料，请直接阅读图片/原型截图进行需求分析。');
  
  const engineStatus = $('#engine-status');
  const engineCenter = $('#engine-center');
  const chatArea = $('#scout-chat');
  
  // 清空对话区
  if (chatArea) chatArea.innerHTML = '';
  
  // 更新状态
  if (engineStatus) engineStatus.textContent = '正在分析需求';
  
  await scoutSay('收到，让我分析一下这个需求...', 800);
  await scoutSay('检查逻辑漏洞...', 600);
  await scoutSay('拆解测试点...', 600);
  const progressCard = createAnalysisProgressCard();
  
  console.log('[分析] 调用 API...');
  
  try {
    progressCard?.update('正在发送给模型分析');

    const response = await fetch(`${API_BASE}/analyze-requirement-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: requirementContent,
        productName: getMindMapRootTitle(),
        mode: 'analyze',
        visionFiles
      })
    });

    if (!response.ok || !response.body) {
      throw new Error('流式分析接口不可用');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let finalCases = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;

        const payload = JSON.parse(line.slice(6));
        if (currentEvent === 'token') {
          progressCard?.appendToken(payload.text || '');
        } else if (currentEvent === 'progress') {
          progressCard?.update(payload.message || '模型正在分析');
          if (engineStatus) engineStatus.textContent = payload.message || '正在分析需求';
        } else if (currentEvent === 'complete') {
          finalCases = payload.cases;
        } else if (currentEvent === 'error') {
          throw new Error(payload.error || '分析失败');
        }
      }
    }

    if (!finalCases) throw new Error('模型没有返回分析报告');

    if (engineStatus) engineStatus.textContent = '分析完成';
    progressCard?.done();

    await scoutSay('分析完成，我整理成报告了 ↓', 300);

    console.log('[分析] 显示结果...');
    const savedReport = showAnalysisResult(finalCases);
    if (savedReport) {
      saveAnalysisHistory(savedReport);
    }
    console.log('[分析] 结果已显示');
  } catch (error) {
    console.error('[分析] 错误:', error);
    if (engineStatus) engineStatus.textContent = '分析失败';
    progressCard?.fail('分析失败');
    await scoutSay(`出了点问题：${error.message}`, 0);
  } finally {
    progressCard?.stop();
    state.isAnalyzing = false;
  }
}

// ========== 显示需求分析结果（内联） ==========
function showAnalysisResult(categories) {
  const chatArea = $('#scout-chat');
  if (!chatArea) return;

  const report = categories?.[0] || {};
  const risks = (report.cases || []).filter(c => c.category !== '待确认');
  const questions = report.questions?.length
    ? report.questions
    : (report.cases || []).filter(c => c.category === '待确认').map(c => c.title);
  const modules = Array.isArray(report.modules) ? report.modules : [];
  const testScope = report.testScope || {};
  const acceptance = Array.isArray(report.acceptance) ? report.acceptance : [];
  const testStrategy = Array.isArray(report.testStrategy) ? report.testStrategy : [];

  const renderList = (items, emptyText = '暂无') => {
    if (!items || items.length === 0) {
      return `<p class="text-xs text-zinc-400">${emptyText}</p>`;
    }
    return `<ul class="space-y-1.5">${items.map(item => `
      <li class="flex gap-2 text-xs text-zinc-600 leading-relaxed">
        <span class="w-1 h-1 rounded-full bg-zinc-300 mt-2 shrink-0"></span>
        <span>${escapeHtml(item)}</span>
      </li>
    `).join('')}</ul>`;
  };

  const renderSection = (title, html) => `
    <div class="p-3 border border-zinc-100 rounded-xl bg-white">
      <div class="text-xs font-medium text-zinc-700 mb-2">${title}</div>
      ${html}
    </div>
  `;

  const modulesHtml = modules.length ? modules.map(module => `
    <div class="p-3 border border-zinc-100 rounded-xl bg-white">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-medium text-zinc-800">${escapeHtml(module.name || '未命名模块')}</div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">模块</span>
      </div>
      ${module.goal ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed">${escapeHtml(module.goal)}</p>` : ''}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <div>
          <div class="text-[11px] font-medium text-zinc-500 mb-1.5">关键流程</div>
          ${renderList(module.flows || [], '暂无流程')}
        </div>
        <div>
          <div class="text-[11px] font-medium text-zinc-500 mb-1.5">业务规则</div>
          ${renderList(module.rules || [], '暂无规则')}
        </div>
        <div>
          <div class="text-[11px] font-medium text-zinc-500 mb-1.5">数据/权限</div>
          ${renderList(module.data || [], '暂无数据点')}
        </div>
      </div>
    </div>
  `).join('') : renderSection('模块拆解', '<p class="text-xs text-zinc-400">模型未识别到明确模块，可补充更完整需求后重新分析。</p>');

  const categoryColors = {
    '边界未定义': 'bg-amber-500',
    '逻辑漏洞': 'bg-red-500',
    '歧义描述': 'bg-orange-500',
    '遗漏场景': 'bg-purple-500',
    '数据风险': 'bg-cyan-500',
    '技术风险': 'bg-blue-500',
    '体验问题': 'bg-green-500'
  };

  const risksHtml = risks.length ? risks.map(c => {
    const colorClass = categoryColors[c.category] || 'bg-zinc-400';
    if (c.category === '格式异常') {
      return `
        <div class="p-3 border border-amber-100 rounded-xl bg-amber-50">
          <div class="flex items-center gap-2">
            <span class="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">格式异常</span>
            <span class="text-sm text-amber-900 font-medium">${escapeHtml(c.title || '模型返回格式异常')}</span>
          </div>
          <p class="text-xs text-amber-700 mt-1.5">模型返回了内容，但不是稳定的结构化 JSON。下面保留原文，方便复制排查。</p>
          <details class="mt-2">
            <summary class="text-xs text-amber-800 cursor-pointer">查看模型原文</summary>
            <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed bg-white/70 border border-amber-100 rounded-lg p-2 text-zinc-600">${escapeHtml(c.steps?.[0] || '')}</pre>
          </details>
        </div>
      `;
    }
    return `
      <div class="p-3 border border-zinc-100 rounded-xl bg-white">
        <div class="flex items-start gap-2">
          <span class="w-1.5 h-1.5 rounded-full ${colorClass} mt-2 shrink-0"></span>
          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded">${escapeHtml(c.category || '风险')}</span>
              <span class="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-500 rounded">${escapeHtml(c.priority || 'P1')}</span>
              <span class="text-sm text-zinc-800 font-medium">${escapeHtml(c.title || '')}</span>
            </div>
            ${c.steps?.[0] ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed">${escapeHtml(c.steps[0])}</p>` : ''}
            ${c.expected ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed"><span class="text-zinc-400">建议：</span>${escapeHtml(c.expected)}</p>` : ''}
            ${c.testFocus ? `<p class="text-xs text-blue-600 mt-1.5 leading-relaxed"><span class="text-blue-400">测试关注：</span>${escapeHtml(c.testFocus)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('') : renderSection('风险问题', '<p class="text-xs text-zinc-400">暂未识别到高风险问题。</p>');

  const scopeHtml = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${renderSection('建议覆盖', renderList(testScope.inScope || []))}
      ${renderSection('暂不覆盖/需确认', renderList(testScope.outOfScope || []))}
    </div>
  `;
  
  const totalIssues = risks.length + questions.length;
  
  // 生成纯文本用于复制
  const plainText = [
    `# 需求分析报告`,
    report.summary ? `\n## 摘要\n${report.summary}` : '',
    modules.length ? `\n## 模块拆解\n${modules.map(m => `- ${m.name || '未命名模块'}：${m.goal || ''}\n  流程：${(m.flows || []).join('；') || '暂无'}\n  规则：${(m.rules || []).join('；') || '暂无'}\n  数据：${(m.data || []).join('；') || '暂无'}`).join('\n')}` : '',
    risks.length ? `\n## 风险问题\n${risks.map(c => `- [${c.priority || 'P1'}][${c.category || '风险'}] ${c.title}\n  ${c.steps?.[0] || ''}\n  建议：${c.expected || ''}${c.testFocus ? `\n  测试关注：${c.testFocus}` : ''}`).join('\n')}` : '',
    questions.length ? `\n## 待确认问题\n${questions.map(q => `- ${q}`).join('\n')}` : '',
    acceptance.length ? `\n## 验收标准\n${acceptance.map(item => `- ${item}`).join('\n')}` : '',
    testStrategy.length ? `\n## 测试策略\n${testStrategy.map(item => `- ${item}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
  
  const historyReport = {
    id: `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: getMindMapRootTitle() || '需求分析报告',
    requirement: state.requirement,
    createdAt: new Date().toISOString(),
    summary: report.summary || '',
    moduleCount: modules.length,
    riskCount: risks.length,
    questionCount: questions.length,
    report,
    plainText
  };

  const reportEl = document.createElement('div');
  reportEl.className = 'scout-message';
  reportEl.innerHTML = `
    <div class="flex gap-3">
      <div class="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
        <span class="prism-avatar" aria-hidden="true"></span>
      </div>
      <div class="flex-1">
        <div class="bg-white border border-zinc-100 rounded-xl overflow-hidden" style="box-shadow: 0 1px 3px rgba(0,0,0,0.04)">
          <!-- 报告头部 -->
          <div class="px-4 py-3 border-b border-zinc-50 flex items-center justify-between">
            <div>
              <span class="text-sm font-medium text-zinc-700">需求分析报告</span>
              <span class="text-xs text-zinc-400 ml-2">${modules.length} 个模块 · ${risks.length} 个风险 · ${questions.length} 个问题</span>
            </div>
            <button class="copy-report p-1.5 hover:bg-zinc-50 rounded-md transition-colors" title="复制报告">
              <svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
            </button>
          </div>
          <!-- 报告内容 -->
          <div class="p-4 space-y-3 max-h-[32rem] overflow-y-auto bg-zinc-50/40">
            ${report.summary ? `
              <div class="p-3 rounded-xl bg-zinc-900 text-white">
                <div class="text-[11px] text-zinc-300 mb-1">需求摘要</div>
                <p class="text-sm leading-relaxed">${escapeHtml(report.summary)}</p>
              </div>
            ` : ''}
            ${modulesHtml}
            <div class="space-y-2">
              <div class="text-xs font-medium text-zinc-700">风险与测试关注</div>
              ${risksHtml}
            </div>
            ${scopeHtml}
            ${renderSection('待确认问题', renderList(questions, '暂无待确认问题'))}
            ${renderSection('验收标准', renderList(acceptance, '暂无验收标准'))}
            ${renderSection('测试策略', renderList(testStrategy, '暂无测试策略'))}
          </div>
          <!-- 报告底部 -->
          <div class="px-4 py-2.5 bg-zinc-50 border-t border-zinc-100">
            <p class="text-[11px] text-zinc-400">建议先确认待确认问题，再进入用例生成和自动化沉淀</p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  chatArea.appendChild(reportEl);
  
  // 复制功能
  const copyBtn = reportEl.querySelector('.copy-report');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(plainText);
        copyBtn.innerHTML = `<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>`;
        }, 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
    });
  }
  
  // 滚动到底部
  chatArea.scrollTop = chatArea.scrollHeight;
  return historyReport;
}

async function showAnalysisHistoryModal() {
  const reports = await syncAnalysisHistoryFromServer()
    .catch(() => getAnalysisHistory().map(normalizeAnalysisHistoryReport));
  const existing = document.getElementById('analysis-history-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'analysis-history-modal';
  modal.className = 'fixed inset-0 bg-black/20 backdrop-blur-sm z-[220] flex items-center justify-center p-6';
  modal.innerHTML = `
    <div class="analysis-history-modal bg-white rounded-2xl border border-zinc-100 shadow-2xl w-full max-w-4xl max-h-[82vh] overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 class="text-base font-medium text-zinc-800">历史分析报告</h3>
          <p class="text-xs text-zinc-400 mt-1">保留最近 ${reports.length} 份需求分析结果</p>
        </div>
        <button id="close-analysis-history" class="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">关闭</button>
      </div>
      <div class="analysis-history-list flex-1 overflow-y-auto p-4 space-y-3">
        ${reports.length ? reports.map(item => `
          <article class="analysis-history-card border border-zinc-100 rounded-xl bg-zinc-50/40 p-4 cursor-pointer" data-report-id="${escapeHtml(item.id)}">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="text-sm font-medium text-zinc-800 truncate">${escapeHtml(item.title || '需求分析报告')}</div>
                <div class="text-xs text-zinc-400 mt-1">${formatDateTime(item.createdAt)} · ${item.moduleCount || 0} 模块 · ${item.riskCount || 0} 风险 · ${item.questionCount || 0} 问题</div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="open-analysis-history px-2.5 py-1.5 text-xs bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors">查看完整</button>
                <button class="edit-analysis-history px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg text-zinc-500 hover:bg-white transition-colors">改标题</button>
                <button class="copy-analysis-history px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg text-zinc-500 hover:bg-white transition-colors">复制链接</button>
              </div>
            </div>
            ${item.summary ? `<p class="text-xs text-zinc-500 leading-relaxed mt-3 line-clamp-2">${escapeHtml(item.summary)}</p>` : ''}
            ${item.requirement ? `<details class="mt-3"><summary class="text-xs text-zinc-400 cursor-pointer">查看原始需求</summary><p class="text-xs text-zinc-500 leading-relaxed mt-2 whitespace-pre-wrap">${escapeHtml(item.requirement)}</p></details>` : ''}
          </article>
        `).join('') : '<div class="py-16 text-center text-sm text-zinc-400">还没有历史分析报告</div>'}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('#close-analysis-history')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', event => {
    if (event.target === modal) modal.remove();
  });
  modal.querySelectorAll('[data-report-id]').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('button') || event.target.closest('details')) return;
      const report = reports.find(item => item.id === card.dataset.reportId);
      if (report) showAnalysisHistoryDetail(report);
    });
  });
  modal.querySelectorAll('.open-analysis-history').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-report-id]');
      const report = reports.find(item => item.id === card?.dataset.reportId);
      if (report) showAnalysisHistoryDetail(report);
    });
  });
  modal.querySelectorAll('.edit-analysis-history').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-report-id]');
      const report = reports.find(item => item.id === card?.dataset.reportId);
      if (report) showEditAnalysisTitleModal(report, () => showAnalysisHistoryModal());
    });
  });
  modal.querySelectorAll('.copy-analysis-history').forEach(button => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-report-id]');
      const report = reports.find(item => item.id === card?.dataset.reportId);
      if (!report) return;
      await copyAnalysisReportUrl(report, button);
    });
  });
}

function showAnalysisHistoryDetail(saved) {
  saved = normalizeAnalysisHistoryReport(saved);
  const report = normalizeAnalysisReportPayload(saved.report || saved);
  const risks = (report.cases || []).filter(c => c.category !== '待确认');
  const questions = report.questions?.length
    ? report.questions
    : (report.cases || []).filter(c => c.category === '待确认').map(c => c.title);
  const modules = Array.isArray(report.modules) ? report.modules : [];
  const testScope = report.testScope || {};
  const acceptance = Array.isArray(report.acceptance) ? report.acceptance : [];
  const testStrategy = Array.isArray(report.testStrategy) ? report.testStrategy : [];
  const detail = document.createElement('div');
  detail.className = 'fixed inset-0 bg-black/25 backdrop-blur-sm z-[230] flex items-center justify-center p-6';
  detail.innerHTML = `
    <div class="bg-white rounded-2xl border border-zinc-100 shadow-2xl w-full max-w-5xl max-h-[88vh] overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 class="text-base font-medium text-zinc-800">${escapeHtml(saved.title || '需求分析报告')}</h3>
          <p class="text-xs text-zinc-400 mt-1">${formatDateTime(saved.createdAt)} · ${modules.length} 个模块 · ${risks.length} 个风险 · ${questions.length} 个问题</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="edit-analysis-detail px-3 py-1.5 text-xs bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors">编辑</button>
          <button class="copy-analysis-detail px-3 py-1.5 text-xs border border-zinc-200 rounded-lg text-zinc-500 hover:bg-zinc-50 transition-colors">复制链接</button>
          <button class="close-analysis-detail p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">关闭</button>
        </div>
      </div>
      <div class="p-5 overflow-y-auto bg-zinc-50/60 space-y-4">
        ${renderAnalysisReportBody({ report, risks, questions, modules, testScope, acceptance, testStrategy, saved })}
      </div>
      <div class="px-5 py-3 bg-white border-t border-zinc-100 text-[11px] text-zinc-400">
        历史报告仅保存在当前浏览器，清理浏览器数据后会消失。
      </div>
    </div>
  `;
  document.body.appendChild(detail);
  detail.querySelector('.close-analysis-detail')?.addEventListener('click', () => detail.remove());
  detail.addEventListener('click', event => {
    if (event.target === detail) detail.remove();
  });
  detail.querySelector('.edit-analysis-detail')?.addEventListener('click', () => {
    showEditAnalysisTitleModal(saved, updated => {
      detail.remove();
      showAnalysisHistoryDetail(updated);
    });
  });
  detail.querySelector('.copy-analysis-detail')?.addEventListener('click', async event => {
    await copyAnalysisReportUrl(saved, event.currentTarget);
  });
}

function showEditAnalysisTitleModal(report, onSaved) {
  const saved = normalizeAnalysisHistoryReport(report);
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/20 backdrop-blur-sm z-[260] flex items-center justify-center p-6';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl border border-zinc-100 shadow-2xl w-full max-w-md p-5">
      <div class="flex items-center justify-between gap-4 mb-4">
        <h3 class="text-base font-medium text-zinc-800">修改报告标题</h3>
        <button class="close-edit-title p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">关闭</button>
      </div>
      <label class="block text-xs text-zinc-500 mb-2">标题</label>
      <input class="edit-analysis-title w-full px-3 py-2 text-sm border border-zinc-200 rounded-xl text-zinc-700 focus:outline-none focus:border-zinc-400" value="${escapeHtml(saved.title || '需求分析报告')}" maxlength="80">
      <div class="flex items-center justify-end gap-2 mt-5">
        <button class="cancel-edit-title px-3 py-2 text-xs border border-zinc-200 rounded-lg text-zinc-500 hover:bg-zinc-50 transition-colors">取消</button>
        <button class="save-edit-title px-3 py-2 text-xs bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const input = modal.querySelector('.edit-analysis-title');
  input?.focus();
  input?.select();
  const close = () => modal.remove();
  const save = () => {
    const title = input?.value.trim() || '需求分析报告';
    const updated = updateAnalysisHistoryReport({ ...saved, title });
    close();
    onSaved?.(updated);
  };
  modal.querySelector('.close-edit-title')?.addEventListener('click', close);
  modal.querySelector('.cancel-edit-title')?.addEventListener('click', close);
  modal.querySelector('.save-edit-title')?.addEventListener('click', save);
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') save();
    if (event.key === 'Escape') close();
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });
}

function renderAnalysisReportBody({ report, risks, questions, modules, testScope, acceptance, testStrategy, saved }) {
  const renderList = (items, emptyText = '暂无') => {
    if (!items || items.length === 0) {
      return `<p class="text-xs text-zinc-400">${emptyText}</p>`;
    }
    return `<ul class="space-y-1.5">${items.map(item => `
      <li class="flex gap-2 text-xs text-zinc-600 leading-relaxed">
        <span class="w-1 h-1 rounded-full bg-zinc-300 mt-2 shrink-0"></span>
        <span>${escapeHtml(item)}</span>
      </li>
    `).join('')}</ul>`;
  };
  const renderSection = (title, html) => `
    <div class="p-3 border border-zinc-100 rounded-xl bg-white">
      <div class="text-xs font-medium text-zinc-700 mb-2">${title}</div>
      ${html}
    </div>
  `;
  const hasStructuredReport = Boolean(report.summary || modules.length || risks.length || questions.length || acceptance.length || testStrategy.length || testScope.inScope?.length || testScope.outOfScope?.length);
  if (!hasStructuredReport) {
    const fallbackText = saved?.plainText || saved?.summary || saved?.requirement || JSON.stringify(saved?.report || {}, null, 2);
    return renderSection('报告内容', `<p class="text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap">${escapeHtml(fallbackText && fallbackText !== '{}' ? fallbackText : '这是一份旧版历史报告，暂无结构化内容。')}</p>`);
  }
  const modulesHtml = modules.length ? modules.map(module => `
    <div class="p-3 border border-zinc-100 rounded-xl bg-white">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-medium text-zinc-800">${escapeHtml(module.name || '未命名模块')}</div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">模块</span>
      </div>
      ${module.goal ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed">${escapeHtml(module.goal)}</p>` : ''}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <div><div class="text-[11px] font-medium text-zinc-500 mb-1.5">关键流程</div>${renderList(module.flows || [], '暂无流程')}</div>
        <div><div class="text-[11px] font-medium text-zinc-500 mb-1.5">业务规则</div>${renderList(module.rules || [], '暂无规则')}</div>
        <div><div class="text-[11px] font-medium text-zinc-500 mb-1.5">数据/权限</div>${renderList(module.data || [], '暂无数据点')}</div>
      </div>
    </div>
  `).join('') : renderSection('模块拆解', '<p class="text-xs text-zinc-400">模型未识别到明确模块。</p>');
  const categoryStyles = {
    '边界未定义': { dot: 'bg-amber-500', tag: 'bg-amber-50 text-amber-700', border: 'border-l-amber-400' },
    '逻辑漏洞': { dot: 'bg-red-500', tag: 'bg-red-50 text-red-600', border: 'border-l-red-400' },
    '歧义描述': { dot: 'bg-orange-500', tag: 'bg-orange-50 text-orange-600', border: 'border-l-orange-400' },
    '遗漏场景': { dot: 'bg-purple-500', tag: 'bg-purple-50 text-purple-600', border: 'border-l-purple-400' },
    '数据风险': { dot: 'bg-cyan-500', tag: 'bg-cyan-50 text-cyan-600', border: 'border-l-cyan-400' },
    '技术风险': { dot: 'bg-blue-500', tag: 'bg-blue-50 text-blue-600', border: 'border-l-blue-400' },
    '体验问题': { dot: 'bg-green-500', tag: 'bg-green-50 text-green-600', border: 'border-l-green-400' }
  };
  const priorityTagClass = priority => {
    if (priority === 'P0' || priority === 'P1') return 'bg-red-50 text-red-500';
    if (priority === 'P2') return 'bg-amber-50 text-amber-600';
    return 'bg-zinc-100 text-zinc-500';
  };
  const risksHtml = risks.length ? risks.map(c => {
    const style = categoryStyles[c.category] || { dot: 'bg-zinc-400', tag: 'bg-zinc-100 text-zinc-500', border: 'border-l-zinc-300' };
    return `
    <div class="p-3 border border-zinc-100 border-l-4 ${style.border} rounded-xl bg-white">
      <div class="flex items-start gap-2">
        <span class="w-1.5 h-1.5 rounded-full ${style.dot} mt-2 shrink-0"></span>
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] px-1.5 py-0.5 ${style.tag} rounded">${escapeHtml(c.category || '风险')}</span>
            <span class="text-[10px] px-1.5 py-0.5 ${priorityTagClass(c.priority)} rounded">${escapeHtml(c.priority || 'P1')}</span>
            <span class="text-sm text-zinc-800 font-medium">${escapeHtml(c.title || '')}</span>
          </div>
          ${c.steps?.[0] ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed">${escapeHtml(c.steps[0])}</p>` : ''}
          ${c.expected ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed"><span class="text-zinc-400">建议：</span>${escapeHtml(c.expected)}</p>` : ''}
          ${c.testFocus ? `<p class="text-xs text-blue-600 mt-1.5 leading-relaxed"><span class="text-blue-400">测试关注：</span>${escapeHtml(c.testFocus)}</p>` : ''}
        </div>
      </div>
    </div>
  `;
  }).join('') : renderSection('风险问题', '<p class="text-xs text-zinc-400">暂未识别到高风险问题。</p>');
  return `
    ${report.summary ? `<div class="p-4 rounded-xl bg-zinc-900 text-white"><div class="text-[11px] text-zinc-300 mb-1">需求摘要</div><p class="text-sm leading-relaxed">${escapeHtml(report.summary)}</p></div>` : ''}
    ${modulesHtml}
    <div class="space-y-2"><div class="text-xs font-medium text-zinc-700">风险与测试关注</div>${risksHtml}</div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${renderSection('建议覆盖', renderList(testScope.inScope || []))}
      ${renderSection('暂不覆盖/需确认', renderList(testScope.outOfScope || []))}
    </div>
    ${renderSection('待确认问题', renderList(questions, '暂无待确认问题'))}
    ${renderSection('验收标准', renderList(acceptance, '暂无验收标准'))}
    ${renderSection('测试策略', renderList(testStrategy, '暂无测试策略'))}
  `;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ========== AI 代跑 ==========
async function startAIRun() {
  // 直接用主页输入框的内容，不弹窗
  const command = state.requirement;
  if (!command) {
    state.isAnalyzing = false;
    return;
  }
  await executeAIRun(command);
}

// ========== AI 代跑命令弹窗 ==========
function showRunCommandModal() {
  const modal = document.createElement('div');
  modal.id = 'run-command-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.3)';
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl w-full max-w-md mx-4" style="box-shadow: 0 4px 24px rgba(0,0,0,0.08)">
      <div class="p-5 border-b border-zinc-100">
        <div class="flex justify-between items-center">
          <h3 class="text-base font-medium text-zinc-800">自动测试</h3>
          <button class="close-run-modal text-zinc-400 hover:text-zinc-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="p-5">
        <p class="text-sm text-zinc-500 mb-4">描述你想在页面上执行的操作，Prism 会接管浏览器帮你完成。</p>
        <textarea id="run-command-input" class="w-full p-3 border border-zinc-200 rounded-lg text-sm resize-none focus:outline-none focus:border-zinc-400" rows="4" placeholder="比如：打开登录页面，输入用户名 test@example.com，密码 123456，点击登录按钮"></textarea>
        <div class="mt-4 flex justify-end gap-2">
          <button class="close-run-modal px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">取消</button>
          <button id="btn-confirm-run" class="px-4 py-2 text-sm bg-zinc-800 text-white rounded-lg hover:bg-zinc-700">开始执行</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelectorAll('.close-run-modal').forEach(btn => {
    btn.addEventListener('click', () => modal.remove());
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  
  modal.querySelector('#btn-confirm-run').addEventListener('click', () => {
    const command = modal.querySelector('#run-command-input').value.trim();
    if (command) {
      modal.remove();
      executeAIRun(command);
    }
  });
}

// ========== 执行 AI 代跑 ==========
async function executeAIRun(command, testCase = null) {
  // 使用灵动岛样式
  
  // 移除已有终端面板
  const existing = $('#auto-run-island');
  if (existing) {
    const isRunning = existing.dataset.running === '1';
    if (isRunning) {
      await fetch(`${API_BASE}/stop`, { method: 'POST' }).catch(() => null);
    }
    existing.remove();
  }
  
  // 创建灵动岛
  const island = document.createElement('div');
  island.id = 'auto-run-island';
  island.className = 'auto-run-island';
  island.innerHTML = `
    <div class="auto-run-pill">
      <div class="auto-run-spinner">
        <div class="auto-run-spinner-dot"></div>
      </div>
      <div class="auto-run-info">
        <span class="auto-run-title">Prism Agent</span>
        <span class="auto-run-subtitle">正在执行...</span>
      </div>
      <button class="auto-run-expand-btn" id="btn-auto-run-expand">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <button class="auto-run-report-btn hidden" id="btn-auto-run-report">查看报告</button>
      <button class="auto-run-close-btn" id="btn-auto-run-close">
        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
    </div>
    <div class="auto-run-expanded hidden" id="auto-run-expanded">
      <div class="auto-run-log-list" id="auto-run-log-list">
        <div class="auto-run-log-item">
          <div class="auto-run-log-icon auto-run-log-icon-system">
            <span style="font-size:10px">·</span>
          </div>
          <span class="auto-run-log-text auto-run-log-text-system">等待执行...</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(island);
  island.dataset.running = '1';
  const executionController = new AbortController();
  let stopRequested = false;
  
  // 绑定事件
  $('#btn-auto-run-expand').addEventListener('click', () => {
    const expanded = $('#auto-run-expanded');
    const pill = island.querySelector('.auto-run-pill');
    if (expanded.classList.contains('hidden')) {
      expanded.classList.remove('hidden');
      pill.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
    } else {
      expanded.classList.add('hidden');
      pill.style.borderBottom = 'none';
    }
  });
  
  $('#btn-auto-run-close').addEventListener('click', async () => {
    if (!runFinished && !stopRequested) {
      stopRequested = true;
      subtitle.textContent = '正在停止...';
      spinner.classList.add('auto-run-spinner-error');
      const stopRequest = fetch(`${API_BASE}/stop`, { method: 'POST' }).catch(() => null);
      executionController.abort();
      await stopRequest;
      finishRun('error', 'Agent 已停止');
    }
    island.style.opacity = '0';
    island.style.transform = 'scale(0.95) translateY(10px)';
    setTimeout(() => island.remove(), 300);
  });
  $('#btn-auto-run-report').addEventListener('click', () => {
    const reportId = island.dataset.reportId;
    if (reportId) openExecutionReport(reportId);
  });
  
  const logList = $('#auto-run-log-list');
  const subtitle = island.querySelector('.auto-run-subtitle');
  const spinner = island.querySelector('.auto-run-spinner');
  let runFinished = false;

  function finishRun(status, text) {
    if (runFinished) return;
    runFinished = true;
    island.dataset.running = '0';
    spinner.classList.add(`auto-run-spinner-${status}`);
    subtitle.textContent = text;
  }
  
  function appendLine(log) {
    // 更新副标题
    if (log.text && log.type !== 'divider') {
      subtitle.textContent = log.text.length > 25 ? log.text.substring(0, 25) + '...' : log.text;
    }
    
    const item = document.createElement('div');
    item.className = 'auto-run-log-item';
    
    let iconClass = 'auto-run-log-icon-info';
    let iconSymbol = '·';
    let textClass = '';
    
    switch (log.type) {
      case 'system':
        iconClass = 'auto-run-log-icon-system';
        iconSymbol = '·';
        textClass = 'auto-run-log-text-system';
        break;
      case 'command':
        iconClass = 'auto-run-log-icon-info';
        iconSymbol = '›';
        break;
      case 'thinking':
        iconClass = 'auto-run-log-icon-thinking';
        iconSymbol = '→';
        textClass = 'auto-run-log-text-thinking';
        break;
      case 'success':
        iconClass = 'auto-run-log-icon-success';
        iconSymbol = '✓';
        textClass = 'auto-run-log-text-success';
        break;
      case 'error':
        iconClass = 'auto-run-log-icon-error';
        iconSymbol = '✗';
        textClass = 'auto-run-log-text-error';
        break;
      default:
        iconClass = 'auto-run-log-icon-info';
        iconSymbol = '·';
    }
    
    if (log.type === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'h-px bg-white/5 my-1';
      logList.appendChild(divider);
      return;
    }
    
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    item.innerHTML = `
      <div class="auto-run-log-icon ${iconClass}">
        <span style="font-size:10px">${iconSymbol}</span>
      </div>
      <span class="auto-run-log-text ${textClass}">${escapeHtml(log.text || '')}</span>
      <span class="auto-run-log-time">${time}</span>
    `;
    
    logList.appendChild(item);
    logList.scrollTop = logList.scrollHeight;
  }
  
  appendLine({ type: 'system', text: command });
  appendLine({ type: 'system', text: '正在连接 Prism Engine...' });
  
  try {
    const response = await fetch(`${API_BASE}/execute-command-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: executionController.signal,
      body: JSON.stringify({ command, testCase })
    });
    if (!response.ok) {
      throw new Error(`执行接口返回 ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            if (currentEvent === 'log') {
              if (stopRequested) continue;
              appendLine(payload);
            } else if (currentEvent === 'complete') {
              if (stopRequested || payload.stopped) {
                finishRun('error', 'Agent 已停止');
                continue;
              }
              appendLine({ type: 'success', text: 'Agent 执行完毕' });
              if (payload.reportId) {
                island.dataset.reportId = payload.reportId;
                island.querySelector('#btn-auto-run-report')?.classList.remove('hidden');
                appendLine({ type: 'success', text: '测试报告已生成，可点击查看报告' });
              }
              finishRun('success', 'Agent 执行完毕');
            } else if (currentEvent === 'error') {
              appendLine({ type: 'error', text: payload.error });
              finishRun('error', 'Agent 执行失败');
            }
          } catch (e) {}
        }
      }
    }
    if (!runFinished) {
      appendLine({ type: 'error', text: '执行连接已结束，但未收到完成状态' });
      finishRun('error', '执行状态异常');
    }
  } catch (error) {
    if (stopRequested || executionController.signal.aborted || error.name === 'AbortError') {
      finishRun('error', 'Agent 已停止');
      return;
    }
    appendLine({ type: 'error', text: `连接失败: ${error.message}` });
    finishRun('error', 'Agent 执行失败');
  } finally {
    state.isAnalyzing = false;
  }
}

// ========== 覆盖率分析 ==========
function analyzeCoverage(categories) {
  if (!categories || categories.length === 0) return '';
  
  const categoryNames = categories.map(c => c.name);
  const totalCases = categories.reduce((sum, cat) => sum + (cat.cases?.length || 0), 0);
  const p0Count = categories.reduce((sum, cat) => 
    sum + (cat.cases?.filter(c => c.priority === 'P0').length || 0), 0);
  const p1Count = categories.reduce((sum, cat) => 
    sum + (cat.cases?.filter(c => c.priority === 'P1').length || 0), 0);
  
  let coverage = `帮你覆盖了 ${categoryNames.length} 个场景`;
  if (categoryNames.length <= 5) {
    coverage += `：${categoryNames.join('、')}`;
  }
  coverage += `。其中 P0 有 ${p0Count} 条，P1 有 ${p1Count} 条，建议优先执行。`;
  
  return coverage;
}

// ========== 用例编辑弹窗 ==========
function showEditCaseModal(node) {
  const matched = findCaseById(node.id);
  const caseData = matched?.caseData || {};
  const steps = Array.isArray(caseData.steps)
    ? caseData.steps
    : (node.children?.filter(c => c.type === 'step').map(c => c.title) || []);
  const expected = caseData.expected || findExpectedInNode(node);
  const title = caseData.title || node.title || '';
  const priority = caseData.priority || node.priority || 'P1';
  
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.3)';
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl w-full max-w-lg mx-4" style="box-shadow: 0 4px 24px rgba(0,0,0,0.08)">
      <div class="p-5 border-b border-zinc-100">
        <div class="flex justify-between items-center">
          <h3 class="text-base font-medium text-zinc-800">编辑用例</h3>
          <button class="close-edit-modal text-zinc-400 hover:text-zinc-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="p-5 space-y-4">
        <div>
          <label class="block text-xs text-zinc-500 mb-1">用例标题</label>
          <input id="edit-case-title" type="text" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400" value="${escapeHtml(title)}">
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">测试步骤</label>
          <textarea id="edit-case-steps" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm resize-none focus:outline-none focus:border-zinc-400" rows="4" placeholder="每行一个步骤">${escapeHtml(steps.join('\n'))}</textarea>
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">预期结果</label>
          <textarea id="edit-case-expected" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm resize-none focus:outline-none focus:border-zinc-400" rows="2">${escapeHtml(expected)}</textarea>
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">优先级</label>
          <select id="edit-case-priority" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400">
            <option value="P0" ${priority === 'P0' ? 'selected' : ''}>P0 - 最高</option>
            <option value="P1" ${priority === 'P1' ? 'selected' : ''}>P1 - 高</option>
            <option value="P2" ${priority === 'P2' ? 'selected' : ''}>P2 - 中</option>
            <option value="P3" ${priority === 'P3' ? 'selected' : ''}>P3 - 低</option>
          </select>
        </div>
      </div>
      <div class="p-4 border-t border-zinc-100 flex justify-end gap-2">
        <button class="close-edit-modal px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">取消</button>
        <button id="btn-save-edit" class="px-4 py-2 text-sm bg-zinc-800 text-white rounded-lg hover:bg-zinc-700">保存</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelectorAll('.close-edit-modal').forEach(btn => {
    btn.addEventListener('click', () => modal.remove());
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  
  modal.querySelector('#btn-save-edit').addEventListener('click', async () => {
    const saveButton = modal.querySelector('#btn-save-edit');
    const newTitle = modal.querySelector('#edit-case-title').value.trim();
    const newSteps = modal.querySelector('#edit-case-steps').value.split('\n').filter(s => s.trim());
    const newExpected = modal.querySelector('#edit-case-expected').value.trim();
    const newPriority = modal.querySelector('#edit-case-priority').value;
    
    if (!newTitle) return;

    saveButton.disabled = true;
    saveButton.textContent = '保存中...';
    try {
      const updated = applyCaseUpdate({
        id: node.id,
        title: newTitle,
        priority: newPriority,
        steps: newSteps,
        expected: newExpected
      }, { persist: false });
      if (!updated) throw new Error('找不到对应的用例数据');

      modal.remove();
      addIslandMessage('system', '用例已更新并保存');
      persistCurrentSession().catch(error => {
        console.error('保存用例修改失败:', error);
        addIslandMessage('system', `用例修改未保存：${error.message}`);
      });
    } catch (error) {
      saveButton.disabled = false;
      saveButton.textContent = '保存';
      addIslandMessage('system', `保存失败：${error.message}`);
    }
  });
}

// ========== Bug 回归 ==========
async function startBugRegression() {
  switchView('engine');
  if (state.canvas) state.canvas.clear();
  state.categories = [];
  renderCanvasModuleNav();
  
  const chatArea = $('#scout-chat');
  if (chatArea) chatArea.innerHTML = '';
  
  await scoutSay('收到，让我看看这个 Bug...', 800);
  await scoutSay('我来帮你生成回归用例...', 600);
  
  // 启动动态思考过程
  startThinkingProcess(state.requirement, () => {
    transitionToCanvas(() => {
      const genId = () => Math.random().toString(36).substr(2, 9);
      const root = { id: genId(), title: getMindMapRootTitle(), _depth: 0, children: [] };
      state.mindMap = root;
      state.canvas?.setMindMap(root);
    });
  });
  
  try {
    const response = await fetch(`${API_BASE}/generate-cases-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: state.requirement,
        productName: getMindMapRootTitle(),
        mode: 'regression'
      })
    });
    
    if (!response.ok) throw new Error('Stream API not available');
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let firstCaseShown = false;
    const categoryMap = {};
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            
            if (currentEvent === 'case' && payload.case) {
              const c = payload.case;
              const catName = c.category || '未分类';
              
              if (!firstCaseShown) {
                firstCaseShown = true;
                stopThinkingProcess();
              }
              
              if (!categoryMap[catName]) {
                categoryMap[catName] = { type: catName, name: catName, cases: [] };
              }
              categoryMap[catName].cases.push(c);
              state.categories = Object.values(categoryMap);
              renderCanvasModuleNav(catName);
              
              showDanmaku(catName, c);
              const newNode = state.canvas?.addCaseNode(catName, c);
              if (newNode) focusNewCaseNode(newNode);
            }
          } catch (e) {}
        }
      }
    }
    
    stopThinkingProcess();
    stopDanmaku();
    state.mindMap = buildMindMap(state.categories);
    renderCanvasModuleNav();
    
    const totalCases = state.categories.reduce((sum, cat) => sum + (cat.cases?.length || 0), 0);
    
    if (state.mindMap) {
      await sleep(50);
      state.canvas.fitToView();
      await scoutSay(`好了，帮你生成了 ${totalCases} 条回归用例，你看看`, 0);
      saveSession(totalCases);
      showCanvasChat();
      addCaseDownloadMessage(totalCases);
    }
    
  } catch (error) {
    console.error('Bug 回归失败:', error);
    await scoutSay(`出了点问题：${error.message}`, 0);
  } finally {
    stopThinkingProcess();
    state.isAnalyzing = false;
  }
}

// ========== 测试报告 ==========
async function startTestReport() {
  try {
    const response = await fetch(`${API_BASE}/reports?limit=50`);
    const data = await response.json();
    if (data.success) {
      showExecutionReportList(data.reports || []);
    } else {
      throw new Error(data.error || '报告列表加载失败');
    }
  } catch (error) {
    console.error('加载测试报告失败:', error);
    alert(`报告加载失败：${error.message}`);
  } finally {
    state.isAnalyzing = false;
  }
}

function formatReportTime(value) {
  if (!value) return '-';
  const date = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function showExecutionReportList(reports) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[220] flex items-center justify-center p-6';
  modal.style.background = 'rgba(0,0,0,0.45)';
  const cards = reports.length ? reports.map(report => {
    const passRate = report.total_cases
      ? Math.round((report.passed_cases / report.total_cases) * 100)
      : 0;
    const statusText = report.status === 'completed' ? '已完成' : report.status === 'running' ? '执行中' : report.status;
    return `
      <button class="execution-report-card w-full text-left p-4 rounded-xl border border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 transition-colors" data-report-id="${escapeHtml(report.id)}">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium text-zinc-800">${escapeHtml(report.title)}</div>
            <div class="text-xs text-zinc-400 mt-1">${formatReportTime(report.started_at)} · ${statusText}</div>
          </div>
          <div class="text-sm font-semibold ${report.failed_cases ? 'text-red-500' : 'text-emerald-600'}">${passRate}%</div>
        </div>
        <div class="flex gap-4 mt-3 text-xs text-zinc-500">
          <span>总计 ${report.total_cases}</span>
          <span class="text-emerald-600">通过 ${report.passed_cases}</span>
          <span class="text-red-500">失败 ${report.failed_cases}</span>
        </div>
      </button>
    `;
  }).join('') : '<div class="py-16 text-center text-sm text-zinc-400">还没有自动化测试报告</div>';

  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
      <div class="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 class="text-base font-medium text-zinc-800">自动化测试报告</h3>
          <p class="text-xs text-zinc-400 mt-1">共 ${reports.length} 份，点击查看执行步骤和截图</p>
        </div>
        <button class="close-execution-reports text-zinc-400 hover:text-zinc-700 text-xl">×</button>
      </div>
      <div class="p-5 overflow-y-auto space-y-3">${cards}</div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close-execution-reports').onclick = () => modal.remove();
  modal.onclick = event => {
    if (event.target === modal) modal.remove();
  };
  modal.querySelectorAll('.execution-report-card').forEach(button => {
    button.onclick = () => openExecutionReport(button.dataset.reportId);
  });
}

function openExecutionReport(reportId) {
  const existing = document.querySelector('.execution-report-viewer');
  existing?.remove();
  const modal = document.createElement('div');
  modal.className = 'execution-report-viewer fixed inset-0 z-[230] flex items-center justify-center p-4';
  modal.style.background = 'rgba(0,0,0,0.55)';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full h-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
      <div class="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <div class="text-sm font-medium text-zinc-800">自动化测试报告</div>
          <div class="text-xs text-zinc-400">${escapeHtml(reportId)}</div>
        </div>
        <button class="close-execution-report text-zinc-400 hover:text-zinc-700 text-xl">×</button>
      </div>
      <iframe title="自动化测试报告" src="/reports.html?id=${encodeURIComponent(reportId)}&t=${Date.now()}" class="w-full flex-1 border-0 bg-zinc-50"></iframe>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close-execution-report').onclick = () => modal.remove();
  modal.onclick = event => {
    if (event.target === modal) modal.remove();
  };
}

// ========== 自动化脚本库 ==========
let scriptLibraryState = { scripts: [], selectedId: null };

async function openScriptLibrary() {
  state.isAnalyzing = false;
  document.querySelector('.script-library-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'script-library-modal fixed inset-0 z-[240] bg-white flex flex-col';
  modal.innerHTML = `
    <header class="h-16 px-6 border-b border-zinc-200 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-zinc-900">自动化脚本库</h2>
        <p class="text-xs text-zinc-400 mt-0.5">成功执行后自动入库，下次优先直接回放，失败时再由 Agent 自愈</p>
      </div>
      <button class="close-script-library text-zinc-400 hover:text-zinc-800 text-2xl">×</button>
    </header>
    <div class="flex flex-1 min-h-0">
      <aside class="w-80 border-r border-zinc-200 flex flex-col bg-zinc-50/70">
        <div class="p-4 border-b border-zinc-200">
          <input class="script-search w-full px-3 py-2 text-sm bg-white border border-zinc-200 rounded-lg outline-none focus:border-zinc-400" placeholder="搜索脚本或模块">
        </div>
        <div class="script-list flex-1 overflow-y-auto p-3 space-y-2"></div>
      </aside>
      <main class="script-editor flex-1 overflow-y-auto"></main>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.close-script-library').onclick = () => modal.remove();
  modal.querySelector('.script-search').addEventListener('input', event => {
    renderScriptList(event.target.value.trim());
  });

  try {
    const response = await fetch(`${API_BASE}/scripts`);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '加载脚本失败');
    scriptLibraryState.scripts = data.scripts || [];
    scriptLibraryState.selectedId = scriptLibraryState.scripts[0]?.id || null;
    renderScriptList();
    renderScriptEditor();
  } catch (error) {
    modal.querySelector('.script-list').innerHTML =
      `<div class="p-4 text-sm text-red-500">${escapeHtml(error.message)}</div>`;
  }
}

function renderScriptList(keyword = '') {
  const container = document.querySelector('.script-library-modal .script-list');
  if (!container) return;
  const lowerKeyword = keyword.toLowerCase();
  const scripts = scriptLibraryState.scripts.filter(script => {
    const text = `${script.name} ${script.module_name} ${script.product_name}`.toLowerCase();
    return !lowerKeyword || text.includes(lowerKeyword);
  });

  container.innerHTML = scripts.length ? scripts.map(script => {
    const selected = script.id === scriptLibraryState.selectedId;
    const successRate = script.run_count
      ? Math.round((script.success_count / script.run_count) * 100)
      : null;
    return `
      <button class="script-list-item w-full text-left p-3 rounded-xl border transition-colors ${
        selected ? 'bg-white border-zinc-400 shadow-sm' : 'bg-white/60 border-zinc-200 hover:border-zinc-300'
      }" data-script-id="${escapeHtml(script.id)}">
        <div class="flex items-start justify-between gap-2">
          <div class="text-sm font-medium text-zinc-800 line-clamp-2">${escapeHtml(script.name)}</div>
          <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
            script.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400'
          }">${script.enabled ? '启用' : '停用'}</span>
        </div>
        <div class="text-xs text-zinc-400 mt-2">${escapeHtml(script.product_name || '未分类')} / ${escapeHtml(script.module_name || '未分类')}</div>
        <div class="flex gap-3 text-[11px] text-zinc-400 mt-2">
          <span>${script.steps.length} 个动作</span>
          <span>执行 ${script.run_count} 次</span>
          ${successRate === null ? '' : `<span>成功率 ${successRate}%</span>`}
        </div>
      </button>`;
  }).join('') : '<div class="text-sm text-zinc-400 text-center py-12">暂无脚本<br><span class="text-xs">成功执行用例后会自动入库</span></div>';

  container.querySelectorAll('.script-list-item').forEach(button => {
    button.onclick = () => {
      scriptLibraryState.selectedId = button.dataset.scriptId;
      renderScriptList(keyword);
      renderScriptEditor();
    };
  });
}

function renderScriptEditor() {
  const container = document.querySelector('.script-library-modal .script-editor');
  if (!container) return;
  const script = scriptLibraryState.scripts.find(item => item.id === scriptLibraryState.selectedId);
  if (!script) {
    container.innerHTML = '<div class="h-full flex items-center justify-center text-sm text-zinc-400">选择一个脚本查看和编辑</div>';
    return;
  }

  container.innerHTML = `
    <div class="max-w-4xl mx-auto p-8">
      <div class="flex items-start justify-between gap-6 mb-8">
        <div class="flex-1">
          <label class="text-xs text-zinc-400">脚本名称</label>
          <input id="script-name" class="mt-1 w-full text-xl font-semibold text-zinc-900 border-0 border-b border-zinc-200 py-2 outline-none focus:border-zinc-500" value="${escapeHtml(script.name)}">
          <div class="grid grid-cols-2 gap-4 mt-5">
            <label class="text-xs text-zinc-400">一级产品
              <input id="script-product" class="block mt-1 w-full px-3 py-2 text-sm text-zinc-700 border border-zinc-200 rounded-lg outline-none focus:border-zinc-400" value="${escapeHtml(script.product_name || '')}">
            </label>
            <label class="text-xs text-zinc-400">业务模块
              <input id="script-module" class="block mt-1 w-full px-3 py-2 text-sm text-zinc-700 border border-zinc-200 rounded-lg outline-none focus:border-zinc-400" value="${escapeHtml(script.module_name || '')}">
            </label>
          </div>
        </div>
        <div class="flex gap-2 pt-5">
          <button class="delete-script px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg">删除</button>
          <button class="save-script px-4 py-2 text-sm text-zinc-700 border border-zinc-300 hover:bg-zinc-50 rounded-lg">保存</button>
          <button class="run-script px-4 py-2 text-sm text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg">执行测试</button>
        </div>
      </div>
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="text-sm font-semibold text-zinc-800">执行动作</h3>
          <p class="text-xs text-zinc-400 mt-1">按顺序直接回放，不消耗大模型 Token</p>
        </div>
        <button class="add-script-step text-xs px-3 py-1.5 border border-zinc-200 hover:bg-zinc-50 rounded-lg">添加动作</button>
      </div>
      <div class="script-step-list space-y-2">${script.steps.map((step, index) => renderScriptStep(step, index)).join('')}</div>
      <label class="block mt-7 text-xs text-zinc-400">预期结果
        <textarea id="script-expected" rows="3" class="block mt-1 w-full px-3 py-2 text-sm text-zinc-700 border border-zinc-200 rounded-lg outline-none focus:border-zinc-400">${escapeHtml(script.expected || '')}</textarea>
      </label>
      <label class="mt-5 inline-flex items-center gap-2 text-sm text-zinc-600">
        <input id="script-enabled" type="checkbox" ${script.enabled ? 'checked' : ''}>
        自动执行时优先使用这个脚本
      </label>
      <div class="mt-8 pt-5 border-t border-zinc-100 text-xs text-zinc-400 flex gap-6">
        <span>执行次数：${script.run_count}</span>
        <span>成功次数：${script.success_count}</span>
        <span>最近状态：${escapeHtml(script.last_status || '未执行')}</span>
      </div>
    </div>`;
  bindScriptEditorEvents(script);
}

function renderScriptStep(step, index) {
  const actions = [
    ['navigate', '打开页面'],
    ['click', '点击'],
    ['fill', '输入'],
    ['wait', '等待元素'],
    ['scroll', '滚动'],
    ['assert_text', '验证页面文本'],
  ];
  return `
    <div class="script-step-row grid grid-cols-[36px_130px_1fr_1fr_36px] gap-2 items-center p-2 border border-zinc-200 rounded-xl bg-white">
      <span class="text-xs text-zinc-400 text-center">${index + 1}</span>
      <select class="step-action px-2 py-2 text-sm border border-zinc-200 rounded-lg bg-white">
        ${actions.map(([value, label]) => `<option value="${value}" ${step.action === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <input class="step-target px-3 py-2 text-sm border border-zinc-200 rounded-lg" placeholder="URL、按钮或输入框名称" value="${escapeHtml(step.target || '')}">
      <input class="step-value px-3 py-2 text-sm border border-zinc-200 rounded-lg" placeholder="输入值或滚动距离" value="${escapeHtml(step.value || '')}">
      <button class="remove-script-step text-zinc-300 hover:text-red-500 text-xl">×</button>
    </div>`;
}

function bindScriptEditorEvents(script) {
  const editor = document.querySelector('.script-library-modal .script-editor');
  editor.querySelector('.add-script-step').onclick = () => {
    script.steps.push({ action: 'click', target: '', value: '' });
    renderScriptEditor();
  };
  editor.querySelectorAll('.remove-script-step').forEach((button, index) => {
    button.onclick = () => {
      script.steps.splice(index, 1);
      renderScriptEditor();
    };
  });
  editor.querySelector('.save-script').onclick = () => saveCurrentScript(script);
  editor.querySelector('.run-script').onclick = async () => {
    const saved = await saveCurrentScript(script);
    await executeLibraryScript(saved.id);
  };
  editor.querySelector('.delete-script').onclick = async () => {
    if (!window.confirm(`确定删除脚本“${script.name}”吗？`)) return;
    await fetch(`${API_BASE}/scripts/${encodeURIComponent(script.id)}`, { method: 'DELETE' });
    scriptLibraryState.scripts = scriptLibraryState.scripts.filter(item => item.id !== script.id);
    scriptLibraryState.selectedId = scriptLibraryState.scripts[0]?.id || null;
    renderScriptList();
    renderScriptEditor();
  };
}

function collectScriptSteps() {
  return [...document.querySelectorAll('.script-library-modal .script-step-row')].map(row => ({
    action: row.querySelector('.step-action').value,
    target: row.querySelector('.step-target').value.trim(),
    value: row.querySelector('.step-value').value,
  })).filter(step => step.target || step.action === 'scroll');
}

async function saveCurrentScript(script) {
  const editor = document.querySelector('.script-library-modal .script-editor');
  const payload = {
    name: editor.querySelector('#script-name').value.trim(),
    productName: editor.querySelector('#script-product').value.trim(),
    moduleName: editor.querySelector('#script-module').value.trim(),
    expected: editor.querySelector('#script-expected').value.trim(),
    enabled: editor.querySelector('#script-enabled').checked,
    steps: collectScriptSteps(),
  };
  const response = await fetch(`${API_BASE}/scripts/${encodeURIComponent(script.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
  const index = scriptLibraryState.scripts.findIndex(item => item.id === script.id);
  scriptLibraryState.scripts[index] = data.script;
  renderScriptList();
  renderScriptEditor();
  return data.script;
}

async function executeLibraryScript(scriptId) {
  showIsland();
  toggleIslandExpanded(true);
  const executionController = new AbortController();
  islandState.isRunning = true;
  islandState.abortController = executionController;
  islandState.total = 1;
  updateIslandProgress(0, 1);
  updateIslandStatus('脚本执行中', '直接回放脚本，不调用大模型');
  addIslandLog('system', '已从脚本库启动执行');

  try {
    const response = await fetch(`${API_BASE}/scripts/${encodeURIComponent(scriptId)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: executionController.signal,
      body: '{}',
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
        if (!line.startsWith('data: ')) continue;
        const payload = JSON.parse(line.slice(6));
        if (currentEvent === 'log' && payload.text) {
          addIslandLog(payload.type || 'info', payload.text);
        } else if (currentEvent === 'complete') {
          islandState.isRunning = false;
          islandState.abortController = null;
          islandState.lastReportId = payload.reportId || null;
          updateIslandProgress(1, 1);
          updateIslandStatus(payload.failed ? '脚本执行失败' : '脚本执行完成', `${payload.passed || 0} 通过, ${payload.failed || 0} 失败`);
          if (payload.reportId) $('#btn-exec-view-report')?.classList.remove('hidden');
          const refreshed = await fetch(`${API_BASE}/scripts`).then(result => result.json());
          if (refreshed.success) {
            scriptLibraryState.scripts = refreshed.scripts || [];
            renderScriptList();
            renderScriptEditor();
          }
        } else if (currentEvent === 'error') {
          throw new Error(payload.error || '脚本执行失败');
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError' || executionController.signal.aborted) return;
    islandState.isRunning = false;
    islandState.abortController = null;
    updateIslandStatus('脚本执行失败', error.message);
    addIslandLog('error', error.message);
  } finally {
    if (islandState.abortController === executionController) {
      islandState.abortController = null;
    }
  }
}

function showReportResult(report) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.3)';
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" style="box-shadow: 0 4px 24px rgba(0,0,0,0.08)">
      <div class="p-5 border-b border-zinc-100">
        <div class="flex justify-between items-center">
          <h3 class="text-base font-medium text-zinc-800">测试报告</h3>
          <button class="close-report text-zinc-400 hover:text-zinc-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="p-5 overflow-y-auto flex-1">
        <div class="prose prose-sm max-w-none">${report.html || report.content}</div>
      </div>
      <div class="p-4 border-t border-zinc-100 flex justify-end gap-2">
        <button class="copy-report px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">复制</button>
        <button class="close-report px-4 py-2 text-sm bg-zinc-800 text-white rounded-lg hover:bg-zinc-700">关闭</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelectorAll('.close-report').forEach(btn => {
    btn.addEventListener('click', () => modal.remove());
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  
  modal.querySelector('.copy-report').addEventListener('click', () => {
    navigator.clipboard.writeText(report.content || report.html);
    addIslandMessage('system', '已复制到剪贴板');
  });
}

// ========== 思考气泡 ==========
async function think(text, duration = 1500) {
  return new Promise(resolve => {
    state.thinkQueue.push({ text, duration, resolve });
    if (!state.isThinking) {
      processThinkQueue();
    }
  });
}

async function processThinkQueue() {
  if (state.thinkQueue.length === 0) {
    state.isThinking = false;
    return;
  }
  
  state.isThinking = true;
  const { text, duration, resolve } = state.thinkQueue.shift();
  
  const bubble = $('#think-bubble');
  
  // 淡入
  bubble.style.opacity = '0';
  await sleep(50);
  bubble.textContent = text;
  bubble.style.opacity = '1';
  
  // 停留
  await sleep(duration);
  
  // 淡出
  bubble.style.opacity = '0';
  await sleep(300);
  
  resolve();
  processThinkQueue();
}

// ========== 画布上生成用例 ==========
async function generateCasesOnCanvas() {
  const engineStatus = $('#engine-status');
  
  // 设置思维导图
  state.canvas.setMindMap(state.mindMap);
  renderCanvasModuleNav();
  
  // 隐藏所有节点
  const allNodes = document.querySelectorAll('.mind-node');
  allNodes.forEach(node => {
    node.style.opacity = '0';
    node.style.transform = 'scale(0.95)';
  });
  
  await sleep(200);
  
  // 显示根节点
  const rootNodes = document.querySelectorAll('.depth-0');
  for (const node of rootNodes) {
    node.style.opacity = '1';
    node.style.transform = 'scale(1)';
    await sleep(200);
  }
  
  await think('正在展开测试场景...', 800);
  
  // 显示分支节点（带思考）
  const branchNodes = document.querySelectorAll('.depth-1');
  const categoryNames = state.categories.map(c => c.name).join('、');
  await think(`场景分类：${categoryNames}`, 1200);
  
  for (const node of branchNodes) {
    node.style.opacity = '1';
    node.style.transform = 'scale(1)';
    await sleep(150);
  }
  
  // 逐个显示叶子节点
  const leafNodes = document.querySelectorAll('.depth-2');
  for (let i = 0; i < leafNodes.length; i++) {
    const node = leafNodes[i];
    
    engineStatus.textContent = `${i + 1}/${leafNodes.length}`;
    
    // 手写效果
    const titleEl = node.querySelector('.node-title');
    if (titleEl) {
      const fullText = titleEl.textContent;
      titleEl.textContent = '';
      node.style.opacity = '1';
      node.style.transform = 'scale(1)';
      
      for (let j = 0; j < fullText.length; j++) {
        titleEl.textContent = fullText.substring(0, j + 1);
        await sleep(10);
      }
    } else {
      node.style.opacity = '1';
      node.style.transform = 'scale(1)';
    }
    
    // 每 3 条用例思考一次
    if (i > 0 && i % 3 === 0) {
      const thoughts = [
        '正在补充异常场景覆盖...',
        '正在设计边界测试用例...',
        '正在识别潜在风险点...',
        '正在完善测试步骤...',
        '正在校验预期结果...',
        '正在优化用例优先级...'
      ];
      await think(thoughts[Math.floor(i / 3) % thoughts.length], 600);
    }
    
    state.canvas.fitToView();
    await sleep(60);
  }
  
  await think('全部完成，点击节点可查看详情', 1000);
}



// ========== 思维导图 ==========
function getCanvasCategoryNode(categoryName) {
  const children = state.canvas?.state?.tree?.children || state.mindMap?.children || [];
  return children.find(node => node.title === categoryName);
}

function renderCanvasModuleNav(activeName = state.selectedCategory) {
  const nav = $('#canvas-module-nav');
  const list = $('#canvas-module-nav-list');
  const countEl = $('#canvas-module-nav-count');
  if (!nav || !list) return;

  const categories = (state.categories || [])
    .filter(category => (category.cases || []).length > 0)
    .map(category => ({
      name: category.name || category.type || '未分类',
      count: category.cases?.length || 0
    }));

  nav.classList.toggle('hidden', state.currentView !== 'engine' || categories.length === 0);
  if (countEl) countEl.textContent = `${categories.length} 个模块`;

  list.innerHTML = categories.map(category => `
    <button class="canvas-module-nav-item ${category.name === activeName ? 'active' : ''}" type="button" data-category="${escapeHtml(category.name)}" title="${escapeHtml(category.name)}">
      <span class="canvas-module-nav-title">${escapeHtml(category.name)}</span>
      <span class="canvas-module-nav-badge">${category.count}</span>
    </button>
  `).join('');

  list.querySelectorAll('.canvas-module-nav-item').forEach(button => {
    button.addEventListener('click', () => {
      const categoryName = button.dataset.category;
      focusCanvasModule(categoryName);
    });
  });
}

function focusCanvasModule(categoryName) {
  if (!categoryName) return;
  state.selectedCategory = categoryName;
  renderCanvasModuleNav(categoryName);
  const node = getCanvasCategoryNode(categoryName);
  if (node && state.canvas?.focusNodeById?.(node.id, { scale: 1.2 })) {
    updateChatIslandStatus('ready', `已定位到 ${categoryName}`);
    return;
  }

  const fallbackNode = Array.from(document.querySelectorAll('.mind-node'))
    .find(el => el.textContent?.trim() === categoryName);
  if (fallbackNode) {
    state.canvas?.focusNode?.(fallbackNode);
    fallbackNode.classList.add('mind-node-active');
    updateChatIslandStatus('ready', `已定位到 ${categoryName}`);
  }
}

function buildMindMap(categories) {
  const genId = () => Math.random().toString(36).substr(2, 9);
  
  const root = { id: genId(), title: getMindMapRootTitle(), _depth: 0, children: [] };
  
  if (Array.isArray(categories)) {
    categories.forEach(cat => {
      if (!cat.cases || cat.cases.length === 0) return;
      
      const categoryNode = {
        id: genId(),
        title: cat.name || cat.type,
        _depth: 1,
        children: []
      };
      
      cat.cases.forEach(c => {
        const categoryName = cat.name || cat.type || c.category || '';
        const hierarchy = inferExecutionHierarchy(c, categoryName);
        const caseNode = {
          id: c.id,
          title: c.title,
          priority: c.priority,
          productName: hierarchy.productName,
          moduleName: hierarchy.moduleName,
          category: categoryName,
          _depth: 2,
          children: []
        };
        
        if (c.steps && c.steps.length > 0) {
          // 最后一个步骤包含预期结果
          c.steps.forEach((step, index) => {
            const stepNode = {
              id: genId(),
              title: step,
              type: 'step',
              _depth: 3,
              children: []
            };
            
            // 最后一个步骤挂载预期结果
            if (index === c.steps.length - 1 && c.expected) {
              stepNode.children.push({
                id: genId(),
                title: c.expected,
                type: 'expected',
                _depth: 4,
                children: []
              });
            }
            
            caseNode.children.push(stepNode);
          });
        } else if (c.expected) {
          caseNode.children.push({
            id: genId(),
            title: c.expected,
            type: 'expected',
            _depth: 3,
            children: []
          });
        }
        
        categoryNode.children.push(caseNode);
      });
      
      root.children.push(categoryNode);
    });
  }

  return root;
}

// ========== 执行用例（旧版，保留兼容） ==========
async function executeCases(cases) {
  const btn = $('#btn-ai-run');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '执行中...';
  }

  try {
    const response = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cases })
    });

    const data = await response.json();

    if (data.success) {
      // 更新状态
      data.results.results.forEach(result => {
        state.categories.forEach(cat => {
          if (cat.cases) {
            const c = cat.cases.find(c => c.id === result.caseId);
            if (c) c.status = result.status;
          }
        });
        state.canvas?.updateNodeStatus(result.caseId, result.status);
      });
      
      state.mindMap = buildMindMap(state.categories);
      state.canvas.setMindMap(state.mindMap);
      state.canvas.fitToView();
      renderCanvasModuleNav();
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('执行失败:', error);
    addIslandMessage('system', `执行失败：${error.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '自动测试';
    }
  }
}

// ========== 工具函数 ==========
function truncate(text, len) {
  return text.length > len ? text.substring(0, len) + '...' : text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ========== 保存会话 ==========
async function saveSession(caseCount) {
  console.log('[保存会话] 开始保存, caseCount:', caseCount);
  try {
    const session = await persistCurrentSession();
    console.log('会话已保存:', session.id);
    return session;
  } catch (error) {
    console.error('[保存会话] 异常:', error);
    throw error;
  }
}

// ========== 加载会话历史 ==========
async function loadSessionHistory() {
  try {
    const response = await fetch(`${API_BASE}/sessions`);
    const data = await response.json();
    
    if (data.success && data.sessions.length > 0) {
      showSessionHistoryModal(data.sessions);
    } else {
      addIslandMessage('system', '暂无历史记录');
    }
  } catch (error) {
    console.error('加载历史记录失败:', error);
    addIslandMessage('system', '加载历史记录失败');
  }
}

// ========== 显示会话历史弹窗 ==========
function showSessionHistoryModal(sessions) {
  // 移除已存在的弹窗
  const existing = document.getElementById('history-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'history-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.3)';
  
  const sessionsHtml = sessions.map(s => {
    // SQLite 存的是 UTC，加 Z 表示 UTC 再转本地时间
    const date = new Date(s.createdAt.replace(' ', 'T') + 'Z');
    const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
    const reqPreview = s.requirement ? s.requirement.substring(0, 90) + (s.requirement.length > 90 ? '...' : '') : '未知需求';
    const projectName = s.projectName || '未设置项目';
    const requirementName = s.requirementName || s.title || '未命名需求';
    const version = s.requirementVersion || 'V1.0';
    const status = s.status || 'completed';
    const searchText = [projectName, requirementName, version, status, s.requirement || ''].join(' ');
    
    return `
      <div class="session-item p-4 border border-zinc-200 rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors" data-session-id="${s.id}" data-requirement="${escapeHtml(searchText)}">
        <div class="flex justify-between gap-3 items-start">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">${escapeHtml(projectName)}</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">${escapeHtml(version)}</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">${escapeHtml(status)}</span>
            </div>
            <h4 class="text-sm font-medium text-zinc-900 mb-1">${escapeHtml(requirementName)}</h4>
            <p class="text-xs text-zinc-500 leading-relaxed mb-2">${escapeHtml(reqPreview)}</p>
            <p class="text-xs text-zinc-400">${s.caseCount || 0} 条用例 · ${timeStr}</p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="edit-session p-1.5 text-zinc-400 hover:text-zinc-700 transition-colors" data-id="${s.id}" title="编辑版本信息">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg>
            </button>
            <button class="delete-session p-1.5 text-zinc-300 hover:text-red-500 transition-colors" data-id="${s.id}" title="删除">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  modal.innerHTML = `
    <div class="bg-white rounded-xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col" style="box-shadow: 0 4px 24px rgba(0,0,0,0.08)">
      <div class="p-5 border-b border-zinc-100">
        <div class="flex justify-between items-center mb-3">
          <div>
            <h3 class="text-base font-medium text-zinc-800">用例库</h3>
            <p class="text-xs text-zinc-400 mt-1">按项目、需求和版本管理生成记录</p>
          </div>
          <button id="close-history" class="text-zinc-400 hover:text-zinc-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <input id="history-search" type="text" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400" placeholder="搜索用例...">
      </div>
      <div class="p-4 overflow-y-auto flex-1">
        <div id="sessions-list" class="space-y-2">
          ${sessionsHtml}
        </div>
      </div>
      <div class="p-4 border-t border-zinc-100">
        <p class="text-xs text-zinc-400 text-center">共 ${sessions.length} 条历史记录</p>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 搜索功能
  const searchInput = document.getElementById('history-search');
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    const items = modal.querySelectorAll('.session-item');
    items.forEach(item => {
      const text = item.dataset.requirement.toLowerCase();
      item.style.display = text.includes(query) ? 'block' : 'none';
    });
  });
  
  // 关闭弹窗
  document.getElementById('close-history').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  
  // 点击会话项加载
  modal.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-session') || e.target.closest('.edit-session')) return;
      const sessionId = item.dataset.sessionId;
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        modal.remove();
        loadSession(session);
      }
    });
  });
  
  // 编辑版本信息
  modal.querySelectorAll('.edit-session').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const session = sessions.find(s => s.id === btn.dataset.id);
      if (session) showEditSessionModal(session, modal);
    });
  });
  
  // 删除会话
  modal.querySelectorAll('.delete-session').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      try {
        await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
        btn.closest('.session-item').remove();
      } catch (error) {
        console.error('删除失败:', error);
      }
    });
  });
}

function showEditSessionModal(session, historyModal) {
  const existing = document.getElementById('edit-session-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'edit-session-modal';
  modal.className = 'fixed inset-0 z-[60] flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.24)';
  modal.innerHTML = `
    <div class="bg-white rounded-xl w-full max-w-md mx-4" style="box-shadow: 0 4px 24px rgba(0,0,0,0.08)">
      <div class="p-5 border-b border-zinc-100 flex items-center justify-between">
        <h3 class="text-base font-medium text-zinc-900">编辑需求版本</h3>
        <button id="close-edit-session" class="text-zinc-400 hover:text-zinc-600">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="p-5 space-y-4">
        <label class="block">
          <span class="text-xs text-zinc-500">项目名称</span>
          <input id="edit-project-name" class="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400" value="${escapeHtml(session.projectName || '')}" placeholder="例如：供应链系统">
        </label>
        <label class="block">
          <span class="text-xs text-zinc-500">需求名称</span>
          <input id="edit-requirement-name" class="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400" value="${escapeHtml(session.requirementName || session.title || '')}" placeholder="例如：登录功能测试">
        </label>
        <label class="block">
          <span class="text-xs text-zinc-500">版本号</span>
          <input id="edit-requirement-version" class="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400" value="${escapeHtml(session.requirementVersion || 'V1.0')}" placeholder="例如：V1.0">
        </label>
        <label class="block">
          <span class="text-xs text-zinc-500">状态</span>
          <select id="edit-session-status" class="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400">
            ${['completed', 'draft', 'reviewing', 'archived'].map(status => `<option value="${status}" ${status === (session.status || 'completed') ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="p-5 border-t border-zinc-100 flex justify-end gap-2">
        <button id="cancel-edit-session" class="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">取消</button>
        <button id="save-edit-session" class="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-800">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('close-edit-session').addEventListener('click', close);
  document.getElementById('cancel-edit-session').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.getElementById('save-edit-session').addEventListener('click', async () => {
    const updates = {
      title: document.getElementById('edit-requirement-name').value.trim() || session.title,
      projectName: document.getElementById('edit-project-name').value.trim(),
      requirementName: document.getElementById('edit-requirement-name').value.trim(),
      requirementVersion: document.getElementById('edit-requirement-version').value.trim() || 'V1.0',
      status: document.getElementById('edit-session-status').value
    };
    try {
      const response = await fetch(`${API_BASE}/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
      if (state.currentSessionId === session.id) {
        state.projectName = updates.projectName;
        state.requirementName = updates.requirementName || updates.title;
        state.requirementVersion = updates.requirementVersion;
        updateEngineHeaderMeta();
      }
      close();
      historyModal.remove();
      loadSessionHistory();
    } catch (error) {
      console.error('编辑会话失败:', error);
      alert(error.message || '保存失败');
    }
  });
}

// ========== 加载单个会话 ==========
function loadSession(session) {
  if (session.categories) {
    state.requirement = session.requirement;
    state.categories = session.categories;
    state.rootTitle = session.mindMap?.title || deriveRootTitle(session.requirement);
    state.projectName = session.projectName || '';
    state.requirementName = session.requirementName || session.title || state.rootTitle;
    state.requirementVersion = session.requirementVersion || 'V1.0';
    state.currentSessionId = session.id;
    const storedChatHistory = Array.isArray(session.chatHistory) ? session.chatHistory : [];
    const legacyChatHistory = storedChatHistory.length ? [] : loadLegacyChatHistory(session.id);
    state.chatHistory = storedChatHistory.length ? storedChatHistory : legacyChatHistory;
    if (legacyChatHistory.length) queueChatHistoryPersist();
    
    switchView('engine');
    
    if (!state.canvas) {
      state.canvas = new Canvas('canvas-container');
      state.canvas.onRunCase = (node) => {
        executeSingleCase(node);
      };
      state.canvas.onEditCase = (node) => {
        showEditCaseModal(node);
      };
      state.canvas.onDeleteCase = (node) => {
        showDeleteCaseConfirm(node);
      };
    }
    
    // 直接渲染思维导图
    state.mindMap = buildMindMap(state.categories);
    state.canvas.setMindMap(state.mindMap);
    state.canvas.fitToView();
    renderCanvasModuleNav();
    updateEngineHeaderMeta();
    
    // 隐藏引擎中心
    const engineCenter = $('#engine-center');
    if (engineCenter) engineCenter.classList.add('hidden');
    
    // 更新标题
    const engineTitle = $('#engine-title');
    if (engineTitle) engineTitle.textContent = '分析完成';
    
    // 显示灵动岛
    const totalCases = state.categories.reduce((sum, cat) => sum + (cat.cases?.length || 0), 0);
    updateChatIslandStatus('ready', `${totalCases} 条用例就绪`);
    const island = $('#dynamic-island');
    if (island) {
      island.classList.remove('hidden');
    }
    
    // 显示画布对话条
    showCanvasChat();
  }
}
