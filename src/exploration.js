// input: 顶部探索入口、限次/持续模式、可选时长、探索 SSE 事件与历史结果
// output: 可配置运行边界的 AI 探索工作台、问题证据和可编辑 Bug 草稿
// position: Web AI 探索测试前端模块，独立于普通用例和脚本库工作台

const EXPLORATION_API_BASE = '/api/exploration';
const EXPLORATION_STORAGE_KEY = 'prism.exploration.preferences';
const explorationState = {
  modal: null,
  activeRunId: '',
  controller: null,
  running: false,
  currentRun: null,
  agentTextBuffer: '',
};

function escapeExplorationHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readExplorationPreferences() {
  try {
    return JSON.parse(localStorage.getItem(EXPLORATION_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveExplorationPreferences(values) {
  try {
    localStorage.setItem(EXPLORATION_STORAGE_KEY, JSON.stringify({
      targetUrl: values.targetUrl,
      scope: values.scope,
      readOnly: values.readOnly,
      maxActions: values.maxActions,
      continuous: values.continuous,
      maxDurationMinutes: values.maxDurationMinutes,
    }));
  } catch (_) {}
}

function showExplorationWorkspace() {
  document.getElementById('exploration-modal')?.remove();
  const preferences = readExplorationPreferences();
  const modal = document.createElement('div');
  modal.id = 'exploration-modal';
  modal.className = 'exploration-modal';
  modal.innerHTML = `
    <div class="exploration-shell" role="dialog" aria-modal="true" aria-labelledby="exploration-title">
      <header class="exploration-header">
        <div class="exploration-heading">
          <div class="exploration-title-row">
            <h2 id="exploration-title">Web 探索测试</h2>
            <span class="exploration-agent-badge">调用 Agent</span>
            <span class="exploration-run-status" data-status="idle">待开始</span>
          </div>
          <p>自主探索后台页面，发现结果保留证据后再转为 Bug</p>
        </div>
        <button class="exploration-icon-button exploration-close" type="button" aria-label="关闭探索测试" title="关闭">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m5 5 10 10M15 5 5 15"/></svg>
        </button>
      </header>

      <div class="exploration-body">
        <aside class="exploration-controls">
          <form id="exploration-form">
            <label class="exploration-field">
              <span>后台地址</span>
              <input id="exploration-url" type="url" value="${escapeExplorationHtml(preferences.targetUrl || 'https://foodsc.data-match.net/')}" placeholder="https://example.com/admin" required>
            </label>

            <label class="exploration-field">
              <span>探索重点</span>
              <textarea id="exploration-scope" rows="4" placeholder="例如：采购订单列表、筛选、详情和表单校验">${escapeExplorationHtml(preferences.scope || '')}</textarea>
            </label>

            <div class="exploration-field-grid">
              <label class="exploration-field">
                <span>登录账号</span>
                <input id="exploration-username" type="text" autocomplete="username" placeholder="可选">
              </label>
              <label class="exploration-field">
                <span>登录密码</span>
                <input id="exploration-password" type="password" autocomplete="current-password" placeholder="可选">
              </label>
            </div>
            <p class="exploration-security-note">凭据仅用于本地登录前置，不发送给模型，不写入历史。</p>

            <div class="exploration-limit-grid">
              <label class="exploration-field exploration-action-limit">
                <span>动作上限</span>
                <input id="exploration-max-actions" type="number" min="8" max="50" step="1" value="${escapeExplorationHtml(preferences.maxActions || 24)}" ${preferences.continuous ? 'disabled' : ''}>
              </label>
              <label class="exploration-field exploration-duration-limit">
                <span>最长时间（分钟）</span>
                <input id="exploration-max-duration" type="number" min="1" max="1440" step="1" value="${escapeExplorationHtml(preferences.maxDurationMinutes ?? '')}" placeholder="不限时">
              </label>
            </div>

            <label class="exploration-toggle-row">
              <span>
                <strong>持续探索</strong>
                <small>不限制动作数量，直到手动或按时停止</small>
              </span>
              <input id="exploration-continuous" type="checkbox" ${preferences.continuous ? 'checked' : ''}>
              <span class="exploration-toggle" aria-hidden="true"></span>
            </label>

            <label class="exploration-toggle-row">
              <span>
                <strong>只读模式</strong>
                <small>阻止保存、提交、删除、发布等操作</small>
              </span>
              <input id="exploration-read-only" type="checkbox" ${preferences.readOnly === false ? '' : 'checked'}>
              <span class="exploration-toggle" aria-hidden="true"></span>
            </label>

            <div class="exploration-form-message" role="status"></div>
            <div class="exploration-form-actions">
              <button class="exploration-stop-button" type="button" disabled>
                <svg viewBox="0 0 20 20" fill="currentColor"><rect x="6" y="6" width="8" height="8" rx="1"/></svg>
                停止
              </button>
              <button class="exploration-start-button" type="submit">
                <svg viewBox="0 0 20 20" fill="currentColor"><path d="m7 5 8 5-8 5V5Z"/></svg>
                开始探索
              </button>
            </div>
          </form>
        </aside>

        <main class="exploration-workspace">
          <nav class="exploration-tabs" aria-label="探索结果视图">
            <button class="exploration-tab active" type="button" data-tab="process">实时过程</button>
            <button class="exploration-tab" type="button" data-tab="findings">发现问题 <span class="exploration-finding-count">0</span></button>
            <button class="exploration-tab" type="button" data-tab="history">历史</button>
          </nav>

          <section class="exploration-panel active" data-panel="process">
            <div class="exploration-empty-state exploration-process-empty">
              <span class="exploration-empty-mark"></span>
              <strong>等待探索任务</strong>
            </div>
            <div class="exploration-log" aria-live="polite"></div>
          </section>

          <section class="exploration-panel" data-panel="findings">
            <div class="exploration-findings"></div>
          </section>

          <section class="exploration-panel" data-panel="history">
            <div class="exploration-history"></div>
          </section>
        </main>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  explorationState.modal = modal;
  explorationState.currentRun = null;
  explorationState.activeRunId = '';
  bindExplorationWorkspace(modal);
  loadExplorationHistory(modal);
}

function bindExplorationWorkspace(modal) {
  modal.querySelector('#exploration-form')?.addEventListener('submit', event => {
    event.preventDefault();
    startExploration(modal);
  });
  modal.querySelector('.exploration-stop-button')?.addEventListener('click', () => stopExploration(modal));
  modal.querySelector('#exploration-continuous')?.addEventListener('change', () => syncExplorationLimitControls(modal));
  modal.querySelector('.exploration-close')?.addEventListener('click', () => closeExplorationWorkspace(modal));
  modal.addEventListener('click', event => {
    if (event.target === modal) closeExplorationWorkspace(modal);
  });
  modal.querySelectorAll('.exploration-tab').forEach(button => {
    button.addEventListener('click', () => switchExplorationTab(modal, button.dataset.tab));
  });
  syncExplorationLimitControls(modal);
}

async function closeExplorationWorkspace(modal) {
  if (explorationState.running) await stopExploration(modal);
  if (explorationState.modal === modal) explorationState.modal = null;
  modal.remove();
}

function switchExplorationTab(modal, tab) {
  modal.querySelectorAll('.exploration-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  modal.querySelectorAll('.exploration-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tab);
  });
  if (tab === 'history') loadExplorationHistory(modal);
}

function getExplorationFormValues(modal) {
  const durationValue = modal.querySelector('#exploration-max-duration')?.value.trim() || '';
  return {
    targetUrl: modal.querySelector('#exploration-url')?.value.trim() || '',
    scope: modal.querySelector('#exploration-scope')?.value.trim() || '',
    username: modal.querySelector('#exploration-username')?.value || '',
    password: modal.querySelector('#exploration-password')?.value || '',
    readOnly: Boolean(modal.querySelector('#exploration-read-only')?.checked),
    maxActions: Number(modal.querySelector('#exploration-max-actions')?.value) || 24,
    continuous: Boolean(modal.querySelector('#exploration-continuous')?.checked),
    maxDurationMinutes: durationValue ? Number(durationValue) : null,
  };
}

function validateExplorationForm(values) {
  let url;
  try {
    url = new URL(values.targetUrl);
  } catch {
    throw new Error('请填写有效的后台地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('后台地址只支持 http 或 https');
  if ((values.username && !values.password) || (!values.username && values.password)) {
    throw new Error('账号和密码需要同时填写');
  }
  if (!values.continuous && (values.maxActions < 8 || values.maxActions > 50)) {
    throw new Error('动作上限需要在 8 到 50 之间');
  }
  if (values.maxDurationMinutes !== null && (
    !Number.isFinite(values.maxDurationMinutes) ||
    values.maxDurationMinutes < 1 ||
    values.maxDurationMinutes > 1440
  )) {
    throw new Error('最长时间需要在 1 到 1440 分钟之间，留空表示不限时');
  }
}

function syncExplorationLimitControls(modal) {
  const continuous = Boolean(modal.querySelector('#exploration-continuous')?.checked);
  const actionInput = modal.querySelector('#exploration-max-actions');
  const actionField = modal.querySelector('.exploration-action-limit');
  if (actionInput) actionInput.disabled = explorationState.running || continuous;
  actionField?.classList.toggle('inactive', continuous);
}

function setExplorationFormMessage(modal, message = '', type = 'error') {
  const element = modal.querySelector('.exploration-form-message');
  if (!element) return;
  element.textContent = message;
  element.className = `exploration-form-message ${message ? 'visible' : ''} ${type}`;
}

function setExplorationRunning(modal, running) {
  explorationState.running = running;
  const startButton = modal.querySelector('.exploration-start-button');
  const stopButton = modal.querySelector('.exploration-stop-button');
  modal.querySelectorAll('#exploration-form input, #exploration-form textarea').forEach(input => {
    input.disabled = running;
  });
  if (!running) syncExplorationLimitControls(modal);
  if (startButton) {
    startButton.disabled = running;
    startButton.innerHTML = running
      ? '<span class="exploration-spinner"></span>探索中'
      : '<svg viewBox="0 0 20 20" fill="currentColor"><path d="m7 5 8 5-8 5V5Z"/></svg>开始探索';
  }
  if (stopButton) stopButton.disabled = !running;
}

function updateExplorationStatus(modal, status, text) {
  const element = modal.querySelector('.exploration-run-status');
  if (!element) return;
  element.dataset.status = status;
  element.textContent = text;
}

function resetExplorationOutput(modal) {
  explorationState.agentTextBuffer = '';
  const log = modal.querySelector('.exploration-log');
  if (log) log.innerHTML = '';
  modal.querySelector('.exploration-process-empty')?.classList.add('hidden');
  const findings = modal.querySelector('.exploration-findings');
  if (findings) findings.innerHTML = '<div class="exploration-empty-state"><strong>探索进行中</strong></div>';
  const count = modal.querySelector('.exploration-finding-count');
  if (count) count.textContent = '0';
}

function appendExplorationLog(modal, message, kind = 'info') {
  const log = modal.querySelector('.exploration-log');
  if (!log || !message) return;
  const item = document.createElement('div');
  item.className = `exploration-log-item ${kind}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<time>${time}</time><span>${escapeExplorationHtml(message)}</span>`;
  log.appendChild(item);
  if (log.children.length > 220) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

function appendExplorationAgentText(modal, text) {
  if (!text || explorationState.agentTextBuffer.includes('###EXPLORATION_RESULT###')) return;
  explorationState.agentTextBuffer += text;
  if (explorationState.agentTextBuffer.includes('###EXPLORATION_RESULT###')) {
    const visible = explorationState.agentTextBuffer.split('###EXPLORATION_RESULT###')[0].trim();
    if (visible) appendExplorationLog(modal, visible, 'agent');
    explorationState.agentTextBuffer = '###EXPLORATION_RESULT###';
    return;
  }
  const lines = explorationState.agentTextBuffer.split(/\n+/);
  explorationState.agentTextBuffer = lines.pop() || '';
  lines.map(line => line.trim()).filter(Boolean).forEach(line => appendExplorationLog(modal, line, 'agent'));
  if (explorationState.agentTextBuffer.length > 180) {
    appendExplorationLog(modal, explorationState.agentTextBuffer.trim(), 'agent');
    explorationState.agentTextBuffer = '';
  }
}

function flushExplorationAgentText(modal) {
  const value = explorationState.agentTextBuffer.trim();
  if (value && value !== '###EXPLORATION_RESULT###') appendExplorationLog(modal, value, 'agent');
  explorationState.agentTextBuffer = '';
}

async function startExploration(modal) {
  if (explorationState.running) return;
  const values = getExplorationFormValues(modal);
  try {
    validateExplorationForm(values);
  } catch (error) {
    setExplorationFormMessage(modal, error.message);
    return;
  }

  saveExplorationPreferences(values);
  setExplorationFormMessage(modal);
  resetExplorationOutput(modal);
  switchExplorationTab(modal, 'process');
  setExplorationRunning(modal, true);
  updateExplorationStatus(modal, 'running', '运行中');
  explorationState.controller = new AbortController();
  explorationState.activeRunId = '';
  explorationState.currentRun = null;
  appendExplorationLog(modal, '正在创建探索任务', 'system');

  try {
    const response = await fetch(`${EXPLORATION_API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
      signal: explorationState.controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `探索启动失败：HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('浏览器不支持流式探索结果');
    await consumeExplorationStream(modal, response.body);
  } catch (error) {
    if (error.name !== 'AbortError') {
      appendExplorationLog(modal, error.message || '探索失败', 'error');
      setExplorationFormMessage(modal, error.message || '探索失败');
      updateExplorationStatus(modal, 'failed', '失败');
    }
  } finally {
    flushExplorationAgentText(modal);
    setExplorationRunning(modal, false);
    explorationState.controller = null;
    modal.querySelector('#exploration-password').value = '';
    loadExplorationHistory(modal);
  }
}

async function consumeExplorationStream(modal, stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find(item => item.startsWith('data:'));
      if (!line) continue;
      const event = JSON.parse(line.slice(5).trim());
      handleExplorationEvent(modal, event);
    }
  }
}

function handleExplorationEvent(modal, event) {
  switch (event.type) {
    case 'started':
      explorationState.activeRunId = event.run?.id || '';
      appendExplorationLog(modal, `任务 ${explorationState.activeRunId.slice(0, 8)} 已启动`, 'system');
      break;
    case 'status':
      appendExplorationLog(modal, event.message, 'system');
      break;
    case 'action':
      appendExplorationLog(modal, describeExplorationAction(event), 'action');
      break;
    case 'blocked':
      appendExplorationLog(modal, event.message, 'blocked');
      break;
    case 'log':
      appendExplorationLog(modal, event.message, event.level === 'error' ? 'error' : 'info');
      break;
    case 'agent_text':
      appendExplorationAgentText(modal, event.text);
      break;
    case 'complete':
      explorationState.currentRun = event.run;
      renderExplorationRun(modal, event.run);
      updateExplorationStatus(modal, 'completed', '已完成');
      appendExplorationLog(modal, `探索完成，发现 ${event.run?.findings?.length || 0} 个问题`, 'success');
      break;
    case 'stopped':
      explorationState.currentRun = event.run;
      renderExplorationRun(modal, event.run);
      updateExplorationStatus(modal, 'stopped', '已停止');
      appendExplorationLog(modal, '探索已停止', 'blocked');
      break;
    case 'error':
      explorationState.currentRun = event.run;
      renderExplorationRun(modal, event.run);
      updateExplorationStatus(modal, 'failed', '失败');
      appendExplorationLog(modal, event.error || '探索失败', 'error');
      break;
  }
}

function describeExplorationAction(event) {
  const names = {
    get_snapshot: '读取页面结构',
    navigate: '打开页面',
    click: '点击',
    fill: '填写',
    screenshot: '保存截图',
    wait: '等待元素',
    scroll: '滚动页面',
    switch_device: '切换到 Web',
  };
  const name = names[event.action] || event.action || '浏览器操作';
  return event.target ? `${name}：${event.target}` : name;
}

async function stopExploration(modal) {
  if (!explorationState.running) return;
  updateExplorationStatus(modal, 'stopping', '停止中');
  appendExplorationLog(modal, '正在停止探索任务', 'system');
  try {
    if (explorationState.activeRunId) {
      await fetch(`${EXPLORATION_API_BASE}/runs/${encodeURIComponent(explorationState.activeRunId)}/stop`, { method: 'POST' });
    }
  } catch (_) {
  } finally {
    explorationState.controller?.abort();
    setExplorationRunning(modal, false);
    updateExplorationStatus(modal, 'stopped', '已停止');
  }
}

function renderExplorationRun(modal, run) {
  if (!run) return;
  const findings = Array.isArray(run.findings) ? run.findings : [];
  const coverage = Array.isArray(run.coverage) ? run.coverage : [];
  const flows = Array.isArray(run.reusableFlows) ? run.reusableFlows : [];
  const screenshots = Array.isArray(run.screenshots) ? run.screenshots : [];
  const count = modal.querySelector('.exploration-finding-count');
  if (count) count.textContent = String(findings.length);
  const container = modal.querySelector('.exploration-findings');
  if (!container) return;

  container.innerHTML = `
    <section class="exploration-result-summary">
      <div>
        <span>探索结论</span>
        <h3>${escapeExplorationHtml(run.summary || run.errorMessage || '本次探索没有返回摘要')}</h3>
      </div>
      <div class="exploration-result-metrics">
        <span><strong>${coverage.length}</strong> 覆盖区域</span>
        <span><strong>${findings.length}</strong> 发现问题</span>
        <span><strong>${run.actions?.length || 0}</strong> 浏览器动作</span>
      </div>
    </section>

    ${coverage.length ? `
      <section class="exploration-section">
        <h3>覆盖范围</h3>
        <div class="exploration-coverage-list">
          ${coverage.map(item => `
            <div class="exploration-coverage-row">
              <span class="exploration-coverage-status ${escapeExplorationHtml(item.status)}"></span>
              <strong>${escapeExplorationHtml(item.area)}</strong>
              <p>${escapeExplorationHtml(item.notes || '')}</p>
            </div>
          `).join('')}
        </div>
      </section>
    ` : ''}

    <section class="exploration-section">
      <h3>发现问题</h3>
      <div class="exploration-finding-list">
        ${findings.length ? findings.map((finding, index) => renderExplorationFinding(finding, index)).join('') : `
          <div class="exploration-empty-state"><strong>没有发现已复现的问题</strong></div>
        `}
      </div>
    </section>

    ${screenshots.length ? `
      <section class="exploration-section">
        <h3>截图证据</h3>
        <div class="exploration-evidence-strip">
          ${screenshots.map(item => `
            <a href="${getExplorationEvidenceUrl(item.filename)}" target="_blank" rel="noreferrer" title="${escapeExplorationHtml(item.label || item.filename)}">
              <img src="${getExplorationEvidenceUrl(item.filename)}" alt="${escapeExplorationHtml(item.label || '探索截图')}">
            </a>
          `).join('')}
        </div>
      </section>
    ` : ''}

    ${flows.length ? `
      <section class="exploration-section">
        <h3>已走通流程</h3>
        <div class="exploration-flow-list">
          ${flows.map(flow => `
            <details>
              <summary>${escapeExplorationHtml(flow.name)}</summary>
              <ol>${(flow.steps || []).map(step => `<li>${escapeExplorationHtml(step)}</li>`).join('')}</ol>
              ${flow.expected ? `<p>${escapeExplorationHtml(flow.expected)}</p>` : ''}
            </details>
          `).join('')}
        </div>
      </section>
    ` : ''}
  `;

  container.querySelectorAll('.exploration-to-bug').forEach(button => {
    button.addEventListener('click', () => {
      const finding = findings[Number(button.dataset.index)];
      if (finding) openExplorationFindingAsBug(run, finding);
    });
  });
}

function renderExplorationFinding(finding, index) {
  return `
    <article class="exploration-finding">
      <header>
        <span class="exploration-severity ${escapeExplorationHtml(finding.severity || 'P2')}">${escapeExplorationHtml(finding.severity || 'P2')}</span>
        <h4>${escapeExplorationHtml(finding.title || `探索发现 ${index + 1}`)}</h4>
        <button class="exploration-to-bug" type="button" data-index="${index}">转为 Bug</button>
      </header>
      <div class="exploration-behavior-grid">
        <div><span>当前行为</span><p>${escapeExplorationHtml(finding.currentBehavior || '未记录')}</p></div>
        <div><span>期望行为</span><p>${escapeExplorationHtml(finding.expectedBehavior || '未记录')}</p></div>
      </div>
      ${(finding.reproductionSteps || []).length ? `
        <ol>${finding.reproductionSteps.map(step => `<li>${escapeExplorationHtml(step)}</li>`).join('')}</ol>
      ` : ''}
    </article>
  `;
}

function getExplorationEvidenceUrl(filename) {
  return `${EXPLORATION_API_BASE}/evidence/${encodeURIComponent(filename || '')}`;
}

function buildExplorationBugDescription(run, finding) {
  const steps = (finding.reproductionSteps || []).map((step, index) => `${index + 1}. ${step}`).join('\n') || '1. 待补充';
  const evidence = [
    `- 探索任务：${run.id}`,
    `- 页面：${run.targetUrl}`,
    ...(finding.evidence || []).map(item => `- ${item}`),
    ...(run.screenshots || []).map(item => `- 截图：${item.filename}`),
  ].join('\n');
  return `# Bug

> 由 Prism Web 探索测试发现，提交前可继续修改。

## 摘要

${finding.title}

## 当前行为

${finding.currentBehavior || '待补充'}

## 期望行为

${finding.expectedBehavior || '待补充'}

## 复现步骤

${steps}

## 影响范围

| 字段 | 内容 |
| --- | --- |
| 严重度 | ${finding.severity || 'P2'} |
| 影响用户 / 现场 | 待确认 |
| 影响仓库 / 服务 | 待确认 |
| 数据风险 | ${run.readOnly ? '无（只读探索）' : '待确认'} |

## 证据

${evidence}

## 父 case / epic

待补充

## 验证信号

按上述复现步骤操作后，页面行为符合期望且不再出现当前问题。`;
}

function openExplorationFindingAsBug(run, finding) {
  if (typeof window.showManualBugIssueModal !== 'function') return;
  const evidenceUrls = (run.screenshots || []).slice(0, 6).map(item => ({
    url: getExplorationEvidenceUrl(item.filename),
    filename: item.filename,
  }));
  window.showManualBugIssueModal({
    brief: finding.currentBehavior || finding.title,
    title: `[Bug] ${finding.title}`,
    description: buildExplorationBugDescription(run, finding),
    evidenceUrls,
  });
}

async function loadExplorationHistory(modal) {
  const container = modal.querySelector('.exploration-history');
  if (!container) return;
  if (!container.children.length) container.innerHTML = '<div class="exploration-empty-state"><strong>正在读取历史</strong></div>';
  try {
    const response = await fetch(`${EXPLORATION_API_BASE}/runs?limit=30`);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '探索历史读取失败');
    renderExplorationHistory(modal, data.runs || []);
  } catch (error) {
    container.innerHTML = `<div class="exploration-empty-state error"><strong>${escapeExplorationHtml(error.message || '探索历史读取失败')}</strong></div>`;
  }
}

function renderExplorationHistory(modal, runs) {
  const container = modal.querySelector('.exploration-history');
  if (!container) return;
  if (!runs.length) {
    container.innerHTML = '<div class="exploration-empty-state"><strong>暂无探索记录</strong></div>';
    return;
  }
  container.innerHTML = runs.map(run => `
    <button class="exploration-history-row" type="button" data-run-id="${escapeExplorationHtml(run.id)}">
      <span class="exploration-history-status ${escapeExplorationHtml(run.status)}"></span>
      <span class="exploration-history-main">
        <strong>${escapeExplorationHtml(run.scope || new URL(run.targetUrl).hostname)}</strong>
        <small>${escapeExplorationHtml(run.targetUrl)}</small>
      </span>
      <span class="exploration-history-meta">
        <strong>${run.findings?.length || 0} 个问题</strong>
        <small>${formatExplorationTime(run.createdAt)}</small>
      </span>
    </button>
  `).join('');
  container.querySelectorAll('.exploration-history-row').forEach(button => {
    button.addEventListener('click', () => {
      const run = runs.find(item => item.id === button.dataset.runId);
      if (!run) return;
      explorationState.currentRun = run;
      renderExplorationRun(modal, run);
      switchExplorationTab(modal, 'findings');
    });
  });
}

function formatExplorationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

document.getElementById('btn-ai-exploration')?.addEventListener('click', showExplorationWorkspace);
window.showExplorationWorkspace = showExplorationWorkspace;
