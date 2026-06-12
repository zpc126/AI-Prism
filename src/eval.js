// input: eval API, WebSocket
// output: 评估集管理、运行监控、报告展示
// position: src/eval.js

(function() {
  const API = '/api/eval';
  let ws = null;
  let currentDataset = null;

  // ========== DOM ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ========== API ==========
  async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return res.json();
  }

  // ========== 视图切换 ==========
  function showEvalView() {
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-eval').classList.add('active');
    loadDatasets();
    connectWs();
  }

  function hideEvalView() {
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-input').classList.add('active');
    disconnectWs();
  }

  // ========== WebSocket ==========
  function connectWs() {
    if (ws) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws/eval`);
    
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    };
    
    ws.onclose = () => {
      ws = null;
      setTimeout(connectWs, 3000);
    };
  }

  function disconnectWs() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'log':
        appendLog(msg.data);
        break;
      case 'progress':
        updateProgress(msg.data);
        break;
      case 'done':
        onEvalDone(msg.data);
        break;
      case 'error':
        appendLog({ level: 'error', message: msg.data.message });
        break;
    }
  }

  // ========== 评估集列表 ==========
  async function loadDatasets() {
    const { datasets } = await api('/datasets');
    const list = $('#eval-dataset-list');
    
    if (!datasets || datasets.length === 0) {
      list.innerHTML = `
        <div class="text-center py-8 text-zinc-400">
          <p class="text-sm">还没有评估集</p>
          <p class="text-xs mt-1">点击右上角创建</p>
        </div>
      `;
      return;
    }

    list.innerHTML = datasets.map(ds => `
      <div class="eval-dataset-item p-3 rounded-lg border border-zinc-200 hover:border-zinc-300 cursor-pointer transition-colors ${currentDataset?.id === ds.id ? 'border-zinc-400 bg-zinc-50' : ''}" data-id="${ds.id}">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-medium text-zinc-800">${escapeHtml(ds.name)}</h4>
          <span class="text-xs text-zinc-400">${JSON.parse(ds.cases).length} 条</span>
        </div>
        ${ds.description ? `<p class="text-xs text-zinc-500 mt-1 line-clamp-2">${escapeHtml(ds.description)}</p>` : ''}
      </div>
    `).join('');

    // 绑定点击
    list.querySelectorAll('.eval-dataset-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const ds = datasets.find(d => d.id === id);
        if (ds) selectDataset(ds);
      });
    });
  }

  async function selectDataset(ds) {
    currentDataset = ds;
    
    // 高亮选中项
    $$('.eval-dataset-item').forEach(item => {
      item.classList.toggle('border-zinc-400', item.dataset.id === ds.id);
      item.classList.toggle('bg-zinc-50', item.dataset.id === ds.id);
    });

    // 加载详情
    await loadDatasetDetail(ds);
  }

  // ========== 评估集详情 ==========
  async function loadDatasetDetail(ds) {
    const cases = JSON.parse(ds.cases);
    const detail = $('#eval-detail');
    
    // 获取最近的运行记录
    const { runs } = await api(`/runs?dataset_id=${ds.id}`);
    const lastRun = runs && runs[0];

    detail.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h3 class="text-lg font-semibold text-zinc-800">${escapeHtml(ds.name)}</h3>
            ${ds.description ? `<p class="text-sm text-zinc-500 mt-1">${escapeHtml(ds.description)}</p>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <button class="eval-edit-btn px-3 py-1.5 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors" data-id="${ds.id}">编辑</button>
            <button class="eval-delete-btn px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors" data-id="${ds.id}">删除</button>
            <button class="eval-run-btn px-4 py-1.5 text-sm bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors" data-id="${ds.id}">运行评估</button>
          </div>
        </div>

        <!-- 用例列表 -->
        <div class="bg-white rounded-xl border border-zinc-200 overflow-hidden mb-6">
          <div class="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span class="text-sm font-medium text-zinc-700">评估用例 (${cases.length})</span>
          </div>
          <div class="divide-y divide-zinc-100">
            ${cases.map((c, i) => `
              <div class="px-4 py-3">
                <div class="flex items-start gap-3">
                  <span class="text-xs text-zinc-400 mt-0.5">${i + 1}</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-zinc-800 font-medium">${escapeHtml(c.name)}</p>
                    <p class="text-xs text-zinc-500 mt-1 truncate">${escapeHtml(c.input)}</p>
                    ${c.expect ? `
                      <div class="flex flex-wrap gap-1 mt-2">
                        ${(c.expect.keywords || []).map(k => `<span class="px-1.5 py-0.5 text-xs bg-zinc-100 text-zinc-600 rounded">${escapeHtml(k)}</span>`).join('')}
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 最近运行 -->
        ${lastRun ? `
          <div class="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div class="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
              <span class="text-sm font-medium text-zinc-700">最近运行</span>
            </div>
            <div class="p-4">
              <div class="flex items-center gap-3 mb-3">
                <span class="px-2 py-1 text-xs rounded ${lastRun.status === 'done' ? 'bg-green-100 text-green-700' : lastRun.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
                  ${lastRun.status === 'done' ? '已完成' : lastRun.status === 'error' ? '失败' : '运行中'}
                </span>
                ${lastRun.duration_ms ? `<span class="text-xs text-zinc-500">${(lastRun.duration_ms / 1000).toFixed(1)}s</span>` : ''}
                <span class="text-xs text-zinc-400">${formatTime(lastRun.created_at)}</span>
              </div>
              ${lastRun.report ? renderReport(JSON.parse(lastRun.report)) : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // 绑定按钮
    detail.querySelector('.eval-run-btn')?.addEventListener('click', () => startRun(ds.id));
    detail.querySelector('.eval-delete-btn')?.addEventListener('click', () => deleteDataset(ds.id));
  }

  // ========== 运行评估 ==========
  async function startRun(datasetId) {
    try {
      const { run } = await api('/runs', {
        method: 'POST',
        body: { dataset_id: datasetId }
      });

      // 显示终端
      showTerminal(run.id);
      appendLog({ level: 'info', message: '评估已启动...' });
    } catch (e) {
      appendLog({ level: 'error', message: `启动失败: ${e.message}` });
    }
  }

  function showTerminal(runId) {
    const terminal = $('#eval-terminal');
    terminal.classList.remove('hidden');
    $('#eval-terminal-content').innerHTML = '';
    $('#eval-terminal-dot').className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';
    $('#eval-terminal-status').textContent = '运行中';
  }

  function appendLog({ runId, level, message, meta }) {
    const content = $('#eval-terminal-content');
    if (!content) return;

    const colors = {
      info: 'text-zinc-400',
      step: 'text-blue-400',
      success: 'text-green-400',
      error: 'text-red-400'
    };

    const icons = {
      info: '●',
      step: '○',
      success: '✓',
      error: '✗'
    };

    const line = document.createElement('div');
    line.className = 'flex gap-2 mb-1';
    line.innerHTML = `
      <span class="${colors[level] || 'text-zinc-500'}">${icons[level] || '●'}</span>
      <span>${escapeHtml(message)}</span>
    `;
    content.appendChild(line);
    content.scrollTop = content.scrollHeight;
  }

  function updateProgress({ runId, step, total, detail }) {
    $('#eval-terminal-status').textContent = `${step}/${total} - ${detail}`;
  }

  function onEvalDone({ runId, report }) {
    $('#eval-terminal-dot').className = 'w-2.5 h-2.5 rounded-full bg-green-500';
    $('#eval-terminal-status').textContent = '已完成';
    
    // 刷新详情
    if (currentDataset) {
      loadDatasetDetail(currentDataset);
    }
  }

  // ========== 新建评估集 ==========
  function showNewDatasetDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div class="px-6 pt-6 pb-4 border-b border-zinc-100">
          <h3 class="text-lg font-semibold text-zinc-800">新建评估集</h3>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <label class="block text-sm text-zinc-600 mb-1">名称</label>
            <input id="new-ds-name" type="text" class="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400" placeholder="如: 登录功能评估">
          </div>
          <div>
            <label class="block text-sm text-zinc-600 mb-1">描述</label>
            <input id="new-ds-desc" type="text" class="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400" placeholder="可选">
          </div>
          <div>
            <label class="block text-sm text-zinc-600 mb-1">评估用例</label>
            <p class="text-xs text-zinc-400 mb-2">每行一个需求，格式: 名称|需求内容</p>
            <textarea id="new-ds-cases" rows="6" class="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 font-mono" placeholder="登录功能|用户登录，支持手机号+验证码\n购物车|电商购物车，添加商品、结算"></textarea>
          </div>
        </div>
        <div class="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
          <button id="new-ds-cancel" class="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors">取消</button>
          <button id="new-ds-create" class="px-4 py-2 text-sm bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors">创建</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 绑定事件
    overlay.querySelector('#new-ds-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#new-ds-create').addEventListener('click', async () => {
      const name = overlay.querySelector('#new-ds-name').value.trim();
      const desc = overlay.querySelector('#new-ds-desc').value.trim();
      const casesText = overlay.querySelector('#new-ds-cases').value.trim();

      if (!name || !casesText) {
        alert('请填写名称和用例');
        return;
      }

      const cases = casesText.split('\n').filter(Boolean).map((line, i) => {
        const [caseName, ...rest] = line.split('|');
        return {
          id: `case_${i + 1}`,
          name: caseName.trim(),
          input: rest.join('|').trim() || caseName.trim()
        };
      });

      await api('/datasets', {
        method: 'POST',
        body: { name, description: desc, cases }
      });

      overlay.remove();
      loadDatasets();
    });
  }

  // ========== 删除评估集 ==========
  async function deleteDataset(id) {
    if (!confirm('确定删除这个评估集？')) return;
    await api(`/datasets/${id}`, { method: 'DELETE' });
    currentDataset = null;
    loadDatasets();
    $('#eval-detail').innerHTML = `
      <div class="text-center text-zinc-400 mt-20">
        <p class="text-sm">选择或创建一个评估集</p>
      </div>
    `;
  }

  // ========== 报告渲染 ==========
  function renderReport(report) {
    return `
      <div class="space-y-3">
        <div class="flex items-center gap-4">
          <div class="text-center">
            <p class="text-2xl font-bold text-zinc-800">${report.avgScore}</p>
            <p class="text-xs text-zinc-500">总分</p>
          </div>
          <div class="flex-1 grid grid-cols-3 gap-2">
            ${report.results.map(r => `
              <div class="px-3 py-2 bg-zinc-50 rounded-lg">
                <p class="text-xs text-zinc-500 truncate">${escapeHtml(r.name)}</p>
                <p class="text-sm font-medium ${r.score >= 70 ? 'text-green-600' : r.score >= 50 ? 'text-yellow-600' : 'text-red-600'}">${r.score}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ========== 工具函数 ==========
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('zh-CN');
  }

  // ========== 初始化 ==========
  function init() {
    // 绑定 tab 切换
    const evalTab = document.querySelector('[data-tab="eval"]');
    if (evalTab) {
      evalTab.addEventListener('click', showEvalView);
    }

    // 绑定返回按钮
    const backBtn = $('#btn-eval-back');
    if (backBtn) {
      backBtn.addEventListener('click', hideEvalView);
    }

    // 绑定新建按钮
    const newBtn = $('#btn-eval-new');
    if (newBtn) {
      newBtn.addEventListener('click', showNewDatasetDialog);
    }
  }

  // 页面加载后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
