// input: 自动化脚本 API、用户编辑操作
// output: 脚本工作台、JSON 编辑、保存和执行
// position: 自动化脚本库前端模块

const scriptWorkspaceState = {
  scripts: [],
  selectedId: null,
  search: '',
  module: 'all',
  mode: 'visual',
  draft: null,
  dirty: false,
};

const SCRIPT_ACTIONS = [
  { value: 'switch_device', label: '切换设备', tone: 'rose', target: 'web 或 mobile', valueLabel: '无需填写' },
  { value: 'navigate', label: '打开页面', tone: 'blue', target: '页面 URL', valueLabel: '无需填写' },
  { value: 'click', label: '点击元素', tone: 'violet', target: '按钮、链接或文字', valueLabel: '无需填写' },
  { value: 'fill', label: '输入内容', tone: 'amber', target: '输入框名称', valueLabel: '要输入的内容' },
  { value: 'wait', label: '等待元素', tone: 'slate', target: 'CSS 选择器', valueLabel: '超时毫秒数' },
  { value: 'scroll', label: '滚动画布', tone: 'cyan', target: 'down 或 up', valueLabel: '滚动距离' },
  { value: 'assert_text', label: '验证文本', tone: 'green', target: '页面应出现的文字', valueLabel: '无需填写' },
];

async function openScriptWorkspace() {
  state.isAnalyzing = false;
  scriptWorkspaceState.mode = 'visual';
  document.querySelector('.script-workspace')?.remove();

  const modal = document.createElement('div');
  modal.className = 'script-workspace';
  modal.innerHTML = `
    <header class="script-workspace-header">
      <div class="script-workspace-brand">
        <button class="script-workspace-close" aria-label="关闭脚本库">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div>
          <div class="script-workspace-title-row">
            <h2>自动化脚本库</h2>
            <span class="script-workspace-count">0 个脚本</span>
          </div>
          <p>成功路径直接回放，页面变化时再交给 Agent 自愈</p>
        </div>
      </div>
      <div class="script-workspace-summary"></div>
    </header>
    <div class="script-workspace-body">
      <aside class="script-workspace-sidebar">
        <div class="script-workspace-search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input class="script-workspace-search" placeholder="搜索脚本、产品或模块">
        </div>
        <div class="script-workspace-filter">
          <span>模块</span>
          <select class="script-workspace-module-filter"></select>
        </div>
        <div class="script-workspace-list"></div>
      </aside>
      <main class="script-workspace-editor"></main>
    </div>
    <div class="script-workspace-toast" role="status"></div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.script-workspace-close').onclick = () => modal.remove();
  modal.querySelector('.script-workspace-search').oninput = event => {
    scriptWorkspaceState.search = event.target.value.trim().toLowerCase();
    renderScriptWorkspaceSidebar();
  };
  modal.querySelector('.script-workspace-module-filter').onchange = event => {
    scriptWorkspaceState.module = event.target.value;
    renderScriptWorkspaceSidebar();
  };
  modal.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveWorkspaceScript().catch(error => showScriptToast(error.message, 'error'));
    }
  });

  try {
    const response = await fetch(`${API_BASE}/scripts`);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '加载脚本失败');
    scriptWorkspaceState.scripts = data.scripts || [];
    scriptWorkspaceState.selectedId = scriptWorkspaceState.scripts[0]?.id || null;
    scriptWorkspaceState.draft = null;
    scriptWorkspaceState.dirty = false;
    renderScriptWorkspace();
  } catch (error) {
    modal.querySelector('.script-workspace-editor').innerHTML = `
      <div class="script-workspace-empty">
        <strong>脚本库加载失败</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>`;
  }
}

function renderScriptWorkspace() {
  renderScriptWorkspaceHeader();
  renderScriptWorkspaceModuleFilter();
  renderScriptWorkspaceSidebar();
  renderScriptWorkspaceEditor();
}

function renderScriptWorkspaceHeader() {
  const modal = document.querySelector('.script-workspace');
  if (!modal) return;
  const scripts = scriptWorkspaceState.scripts;
  const totalRuns = scripts.reduce((sum, script) => sum + (script.run_count || 0), 0);
  const totalSuccess = scripts.reduce((sum, script) => sum + (script.success_count || 0), 0);
  const successRate = totalRuns ? Math.round(totalSuccess / totalRuns * 100) : 0;
  modal.querySelector('.script-workspace-count').textContent = `${scripts.length} 个脚本`;
  modal.querySelector('.script-workspace-summary').innerHTML = `
    <div><strong>${scripts.filter(script => script.enabled).length}</strong><span>已启用</span></div>
    <div><strong>${totalRuns}</strong><span>累计执行</span></div>
    <div><strong>${successRate}%</strong><span>成功率</span></div>`;
}

function renderScriptWorkspaceModuleFilter() {
  const select = document.querySelector('.script-workspace-module-filter');
  if (!select) return;
  const modules = [...new Set(scriptWorkspaceState.scripts.map(script => script.module_name).filter(Boolean))];
  select.innerHTML = `
    <option value="all">全部模块</option>
    ${modules.map(moduleName => `
      <option value="${escapeHtml(moduleName)}" ${scriptWorkspaceState.module === moduleName ? 'selected' : ''}>
        ${escapeHtml(moduleName)}
      </option>`).join('')}`;
}

function renderScriptWorkspaceSidebar() {
  const container = document.querySelector('.script-workspace-list');
  if (!container) return;
  const filtered = scriptWorkspaceState.scripts.filter(script => {
    const matchesSearch = !scriptWorkspaceState.search ||
      `${script.name} ${script.product_name} ${script.module_name}`.toLowerCase().includes(scriptWorkspaceState.search);
    const matchesModule = scriptWorkspaceState.module === 'all' ||
      script.module_name === scriptWorkspaceState.module;
    return matchesSearch && matchesModule;
  });

  container.innerHTML = filtered.length ? filtered.map(script => {
    const selected = script.id === scriptWorkspaceState.selectedId;
    const rate = script.run_count ? Math.round(script.success_count / script.run_count * 100) : null;
    return `
      <button class="script-workspace-item ${selected ? 'active' : ''}" data-script-id="${escapeHtml(script.id)}">
        <div class="script-workspace-item-top">
          <span class="script-workspace-status ${script.enabled ? 'enabled' : ''}"></span>
          <strong>${escapeHtml(script.name)}</strong>
          <span class="script-workspace-step-count">${script.steps.length}</span>
        </div>
        <div class="script-workspace-path">
          ${escapeHtml(script.product_name || '未分类')}
          <span>/</span>
          ${escapeHtml(script.module_name || '未分类')}
        </div>
        <div class="script-workspace-item-meta">
          <span>${script.run_count || 0} 次执行</span>
          <span>${rate === null ? '尚未运行' : `${rate}% 成功`}</span>
          <span>${formatScriptDate(script.updated_at)}</span>
        </div>
      </button>`;
  }).join('') : `
    <div class="script-workspace-list-empty">
      <strong>没有匹配的脚本</strong>
      <span>成功执行用例后会自动沉淀到这里</span>
    </div>`;

  container.querySelectorAll('.script-workspace-item').forEach(button => {
    button.onclick = () => {
      if (!captureWorkspaceDraft()) return;
      scriptWorkspaceState.selectedId = button.dataset.scriptId;
      scriptWorkspaceState.draft = null;
      scriptWorkspaceState.dirty = false;
      renderScriptWorkspaceSidebar();
      renderScriptWorkspaceEditor();
    };
  });
}

function renderScriptWorkspaceEditor() {
  const container = document.querySelector('.script-workspace-editor');
  if (!container) return;
  const script = scriptWorkspaceState.scripts.find(item => item.id === scriptWorkspaceState.selectedId);
  if (!script) {
    container.innerHTML = `
      <div class="script-workspace-empty">
        <div class="script-workspace-empty-mark">S</div>
        <strong>选择一个脚本开始编辑</strong>
        <span>这里可以调整动作顺序、参数和验证条件</span>
      </div>`;
    return;
  }

  if (!scriptWorkspaceState.draft || scriptWorkspaceState.draft.id !== script.id) {
    scriptWorkspaceState.draft = createScriptDraft(script);
  }
  const draft = scriptWorkspaceState.draft;
  const rate = script.run_count ? Math.round(script.success_count / script.run_count * 100) : null;

  container.innerHTML = `
    <div class="script-editor-shell">
      <div class="script-editor-toolbar">
        <div class="script-editor-heading">
          <div class="script-editor-breadcrumb">
            <span>${escapeHtml(draft.productName || '未分类')}</span>
            <i>/</i>
            <span>${escapeHtml(draft.moduleName || '未分类')}</span>
          </div>
          <div class="script-editor-name-row">
            <input id="workspace-script-name" value="${escapeHtml(draft.name)}" aria-label="脚本名称">
            <span class="script-unsaved-indicator ${scriptWorkspaceState.dirty ? 'visible' : ''}">未保存</span>
          </div>
        </div>
        <div class="script-editor-actions">
          <button class="script-button danger delete-workspace-script">删除</button>
          <button class="script-button secondary save-workspace-script">保存</button>
          <button class="script-button primary run-workspace-script">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            执行测试
          </button>
        </div>
      </div>

      <div class="script-editor-insights">
        <div><span>动作</span><strong>${draft.steps.length}</strong></div>
        <div><span>执行</span><strong>${script.run_count || 0}</strong></div>
        <div><span>成功率</span><strong>${rate === null ? '--' : `${rate}%`}</strong></div>
        <div><span>最近状态</span><strong class="${script.last_status === 'passed' ? 'success' : ''}">${scriptStatusText(script.last_status)}</strong></div>
        <label class="script-enable-switch">
          <input id="workspace-script-enabled" type="checkbox" ${draft.enabled ? 'checked' : ''}>
          <span></span>
          自动优先复用
        </label>
      </div>

      <div class="script-editor-meta-grid">
        <label><span>一级产品</span><input id="workspace-script-product" value="${escapeHtml(draft.productName)}"></label>
        <label><span>业务模块</span><input id="workspace-script-module" value="${escapeHtml(draft.moduleName)}"></label>
        <label class="wide"><span>预期结果</span><input id="workspace-script-expected" value="${escapeHtml(draft.expected)}"></label>
      </div>

      <div class="script-editor-modebar">
        <div class="script-editor-tabs">
          <button class="${scriptWorkspaceState.mode === 'visual' ? 'active' : ''}" data-editor-mode="visual">可视化编辑</button>
          <button class="${scriptWorkspaceState.mode === 'code' ? 'active' : ''}" data-editor-mode="code">
            JSON 代码
            <span>高级</span>
          </button>
        </div>
        <div class="script-editor-modehint">
          ${scriptWorkspaceState.mode === 'visual'
            ? '动作按顺序执行，可使用上下按钮调整'
            : '只接受脚本 JSON，不执行任意 JavaScript'}
        </div>
      </div>

      <div class="script-editor-content">
        ${scriptWorkspaceState.mode === 'visual'
          ? renderVisualScriptEditor(draft)
          : renderJsonScriptEditor(draft)}
      </div>
    </div>`;

  bindScriptWorkspaceEditor(script);
}

function renderVisualScriptEditor(draft) {
  return `
    <div class="script-step-toolbar">
      <div>
        <h3>执行流程</h3>
        <p>脚本命中时将直接按以下动作回放，不调用大模型</p>
      </div>
      <button class="script-button secondary add-workspace-step">+ 添加动作</button>
    </div>
    <div class="script-visual-list">
      ${draft.steps.length ? draft.steps.map((step, index) => renderWorkspaceStep(step, index, draft.steps.length)).join('') : `
        <div class="script-no-steps">
          <strong>还没有执行动作</strong>
          <span>点击“添加动作”开始编排脚本</span>
        </div>`}
    </div>`;
}

function renderWorkspaceStep(step, index, total) {
  const config = SCRIPT_ACTIONS.find(item => item.value === step.action) || SCRIPT_ACTIONS[1];
  const valueDisabled = ['switch_device', 'navigate', 'click', 'assert_text'].includes(step.action);
  return `
    <div class="script-action-card tone-${config.tone}" data-step-index="${index}">
      <div class="script-action-order">
        <span>${String(index + 1).padStart(2, '0')}</span>
        <div>
          <button class="move-workspace-step" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button class="move-workspace-step" data-direction="1" ${index === total - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        </div>
      </div>
      <div class="script-action-main">
        <div class="script-action-row">
          <label class="script-action-type">
            <span>动作类型</span>
            <select class="workspace-step-action">
              ${SCRIPT_ACTIONS.map(item => `
                <option value="${item.value}" ${item.value === step.action ? 'selected' : ''}>${item.label}</option>`).join('')}
            </select>
          </label>
          <label class="script-action-target">
            <span>${config.target}</span>
            <input class="workspace-step-target" value="${escapeHtml(step.target || '')}" placeholder="${config.target}">
          </label>
          <label class="script-action-value ${valueDisabled ? 'muted' : ''}">
            <span>${config.valueLabel}</span>
            <input class="workspace-step-value" value="${escapeHtml(step.value || '')}" placeholder="${config.valueLabel}" ${valueDisabled ? 'disabled' : ''}>
          </label>
        </div>
      </div>
      <button class="remove-workspace-step" aria-label="删除动作">×</button>
    </div>`;
}

function renderJsonScriptEditor(draft) {
  return `
    <div class="script-code-panel">
      <div class="script-code-toolbar">
        <div>
          <strong>脚本 JSON</strong>
          <span class="script-code-status valid">格式正确</span>
        </div>
        <div>
          <button class="format-script-json">格式化</button>
          <button class="copy-script-json">复制</button>
          <button class="apply-script-json">应用到可视化</button>
        </div>
      </div>
      <div class="script-code-editor-wrap">
        <div class="script-code-gutter">JSON</div>
        <textarea class="script-json-editor" spellcheck="false" aria-label="脚本 JSON">${escapeHtml(JSON.stringify(draftToCode(draft), null, 2))}</textarea>
      </div>
      <div class="script-code-help">
        支持动作：switch_device、navigate、click、fill、wait、scroll、assert_text。按 <kbd>⌘ S</kbd> 保存。
      </div>
    </div>`;
}

function bindScriptWorkspaceEditor(script) {
  const editor = document.querySelector('.script-workspace-editor');
  if (!editor) return;

  editor.querySelectorAll('[data-editor-mode]').forEach(button => {
    button.onclick = () => {
      if (!captureWorkspaceDraft()) return;
      scriptWorkspaceState.mode = button.dataset.editorMode;
      renderScriptWorkspaceEditor();
    };
  });

  editor.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', markScriptWorkspaceDirty);
    input.addEventListener('change', markScriptWorkspaceDirty);
  });

  editor.querySelector('.save-workspace-script').onclick = () => {
    saveWorkspaceScript().catch(error => showScriptToast(error.message, 'error'));
  };
  editor.querySelector('.run-workspace-script').onclick = async () => {
    try {
      const saved = await saveWorkspaceScript();
      await executeWorkspaceScript(saved.id);
    } catch (error) {
      showScriptToast(error.message, 'error');
    }
  };
  editor.querySelector('.delete-workspace-script').onclick = async () => {
    if (!window.confirm(`确定删除脚本“${scriptWorkspaceState.draft.name}”吗？`)) return;
    await fetch(`${API_BASE}/scripts/${encodeURIComponent(script.id)}`, { method: 'DELETE' });
    scriptWorkspaceState.scripts = scriptWorkspaceState.scripts.filter(item => item.id !== script.id);
    scriptWorkspaceState.selectedId = scriptWorkspaceState.scripts[0]?.id || null;
    scriptWorkspaceState.draft = null;
    renderScriptWorkspace();
    showScriptToast('脚本已删除');
  };

  if (scriptWorkspaceState.mode === 'visual') {
    bindVisualScriptEditor();
  } else {
    bindJsonScriptEditor();
  }
}

function bindVisualScriptEditor() {
  const editor = document.querySelector('.script-workspace-editor');
  editor.querySelector('.add-workspace-step').onclick = () => {
    captureWorkspaceDraft();
    scriptWorkspaceState.draft.steps.push({ action: 'click', target: '', value: '' });
    markScriptWorkspaceDirty();
    renderScriptWorkspaceEditor();
  };
  editor.querySelectorAll('.workspace-step-action').forEach(select => {
    select.onchange = () => {
      captureWorkspaceDraft();
      markScriptWorkspaceDirty();
      renderScriptWorkspaceEditor();
    };
  });
  editor.querySelectorAll('.move-workspace-step').forEach(button => {
    button.onclick = () => {
      captureWorkspaceDraft();
      const card = button.closest('.script-action-card');
      const index = Number(card.dataset.stepIndex);
      const nextIndex = index + Number(button.dataset.direction);
      const [step] = scriptWorkspaceState.draft.steps.splice(index, 1);
      scriptWorkspaceState.draft.steps.splice(nextIndex, 0, step);
      markScriptWorkspaceDirty();
      renderScriptWorkspaceEditor();
    };
  });
  editor.querySelectorAll('.remove-workspace-step').forEach(button => {
    button.onclick = () => {
      captureWorkspaceDraft();
      const index = Number(button.closest('.script-action-card').dataset.stepIndex);
      scriptWorkspaceState.draft.steps.splice(index, 1);
      markScriptWorkspaceDirty();
      renderScriptWorkspaceEditor();
    };
  });
  editor.querySelectorAll('.script-action-card input').forEach(input => {
    input.oninput = markScriptWorkspaceDirty;
  });
}

function bindJsonScriptEditor() {
  const textarea = document.querySelector('.script-json-editor');
  const status = document.querySelector('.script-code-status');
  textarea.oninput = () => {
    markScriptWorkspaceDirty();
    const validation = validateScriptJson(textarea.value);
    status.textContent = validation.valid ? '格式正确' : validation.error;
    status.className = `script-code-status ${validation.valid ? 'valid' : 'invalid'}`;
  };
  document.querySelector('.format-script-json').onclick = () => {
    const validation = validateScriptJson(textarea.value);
    if (!validation.valid) return showScriptToast(validation.error, 'error');
    textarea.value = JSON.stringify(validation.value, null, 2);
    showScriptToast('JSON 已格式化');
  };
  document.querySelector('.copy-script-json').onclick = async () => {
    await navigator.clipboard.writeText(textarea.value);
    showScriptToast('JSON 已复制');
  };
  document.querySelector('.apply-script-json').onclick = () => {
    const validation = validateScriptJson(textarea.value);
    if (!validation.valid) return showScriptToast(validation.error, 'error');
    scriptWorkspaceState.draft = codeToDraft(validation.value, scriptWorkspaceState.draft.id);
    scriptWorkspaceState.mode = 'visual';
    markScriptWorkspaceDirty();
    renderScriptWorkspaceEditor();
  };
}

function captureWorkspaceDraft() {
  const editor = document.querySelector('.script-workspace-editor');
  if (!editor || !scriptWorkspaceState.draft) return true;

  if (scriptWorkspaceState.mode === 'code') {
    const textarea = editor.querySelector('.script-json-editor');
    if (!textarea) return true;
    const validation = validateScriptJson(textarea.value);
    if (!validation.valid) {
      showScriptToast(validation.error, 'error');
      return false;
    }
    scriptWorkspaceState.draft = codeToDraft(validation.value, scriptWorkspaceState.draft.id);
    return true;
  }

  scriptWorkspaceState.draft.name = editor.querySelector('#workspace-script-name')?.value.trim() || '';
  scriptWorkspaceState.draft.productName = editor.querySelector('#workspace-script-product')?.value.trim() || '';
  scriptWorkspaceState.draft.moduleName = editor.querySelector('#workspace-script-module')?.value.trim() || '';
  scriptWorkspaceState.draft.expected = editor.querySelector('#workspace-script-expected')?.value.trim() || '';
  scriptWorkspaceState.draft.enabled = Boolean(editor.querySelector('#workspace-script-enabled')?.checked);
  scriptWorkspaceState.draft.steps = [...editor.querySelectorAll('.script-action-card')].map(card => ({
    action: card.querySelector('.workspace-step-action').value,
    target: card.querySelector('.workspace-step-target').value.trim(),
    value: card.querySelector('.workspace-step-value').value,
  }));
  return true;
}

async function saveWorkspaceScript() {
  if (!captureWorkspaceDraft()) throw new Error('请先修正 JSON 格式');
  const draft = scriptWorkspaceState.draft;
  if (!draft?.name) throw new Error('脚本名称不能为空');
  if (!draft.steps.length) throw new Error('至少需要一个执行动作');
  if (draft.steps.some(step => !step.target && step.action !== 'scroll')) {
    throw new Error('动作目标不能为空');
  }

  const response = await fetch(`${API_BASE}/scripts/${encodeURIComponent(draft.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: draft.name,
      productName: draft.productName,
      moduleName: draft.moduleName,
      expected: draft.expected,
      enabled: draft.enabled,
      steps: draft.steps,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '保存失败');

  const index = scriptWorkspaceState.scripts.findIndex(item => item.id === data.script.id);
  scriptWorkspaceState.scripts[index] = data.script;
  scriptWorkspaceState.draft = createScriptDraft(data.script);
  scriptWorkspaceState.dirty = false;
  renderScriptWorkspaceHeader();
  renderScriptWorkspaceSidebar();
  renderScriptWorkspaceEditor();
  showScriptToast('脚本已保存');
  return data.script;
}

async function executeWorkspaceScript(scriptId) {
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
          updateIslandStatus(
            payload.stopped ? '脚本已停止' : payload.failed ? '脚本执行失败' : '脚本执行完成',
            payload.stopped ? '任务已停止' : `${payload.passed || 0} 通过, ${payload.failed || 0} 失败`
          );
          if (payload.reportId) $('#btn-exec-view-report')?.classList.remove('hidden');
          await refreshScriptWorkspace();
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

async function refreshScriptWorkspace() {
  const response = await fetch(`${API_BASE}/scripts`);
  const data = await response.json();
  if (!data.success) return;
  scriptWorkspaceState.scripts = data.scripts || [];
  const selected = scriptWorkspaceState.scripts.find(item => item.id === scriptWorkspaceState.selectedId);
  if (selected) scriptWorkspaceState.draft = createScriptDraft(selected);
  renderScriptWorkspace();
}

function createScriptDraft(script) {
  return {
    id: script.id,
    name: script.name || '',
    productName: script.product_name || '',
    moduleName: script.module_name || '',
    expected: script.expected || '',
    enabled: Boolean(script.enabled),
    steps: (script.steps || []).map(step => ({
      action: step.action || 'click',
      target: step.target || '',
      value: step.value || '',
    })),
  };
}

function draftToCode(draft) {
  return {
    name: draft.name,
    productName: draft.productName,
    moduleName: draft.moduleName,
    expected: draft.expected,
    enabled: draft.enabled,
    steps: draft.steps,
  };
}

function codeToDraft(value, id) {
  return {
    id,
    name: String(value.name || ''),
    productName: String(value.productName || ''),
    moduleName: String(value.moduleName || ''),
    expected: String(value.expected || ''),
    enabled: value.enabled !== false,
    steps: value.steps.map(step => ({
      action: String(step.action || ''),
      target: String(step.target || ''),
      value: step.value === undefined ? '' : String(step.value),
    })),
  };
}

function validateScriptJson(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('根节点必须是对象');
    }
    if (!Array.isArray(value.steps)) throw new Error('steps 必须是数组');
    const allowed = new Set(SCRIPT_ACTIONS.map(item => item.value));
    value.steps.forEach((step, index) => {
      if (!step || typeof step !== 'object') throw new Error(`第 ${index + 1} 个动作必须是对象`);
      if (!allowed.has(step.action)) throw new Error(`第 ${index + 1} 个动作类型无效`);
    });
    return { valid: true, value };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function markScriptWorkspaceDirty() {
  scriptWorkspaceState.dirty = true;
  document.querySelector('.script-unsaved-indicator')?.classList.add('visible');
}

function showScriptToast(message, type = 'success') {
  const toast = document.querySelector('.script-workspace-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `script-workspace-toast visible ${type}`;
  clearTimeout(showScriptToast.timer);
  showScriptToast.timer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 1800);
}

function scriptStatusText(status) {
  const labels = {
    passed: '通过',
    failed: '失败',
    stopped: '已停止',
  };
  return labels[status] || '未执行';
}

function formatScriptDate(value) {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
