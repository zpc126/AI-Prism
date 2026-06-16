// input: 同源 Web API、canvas.js
// output: 视图切换、分析流程、思维导图数据
// position: Web 前端主逻辑，连接 UI 和后端 API

const API_BASE = '/api';

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

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getChatHistory() {
  return state.chatHistory.slice(-30);
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
  if (state.chatHistory.length > 200) {
    state.chatHistory = state.chatHistory.slice(-200);
  }
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
  if (persist) {
    persistCurrentSession().catch(error => {
      console.error('保存用例修改失败:', error);
      addIslandMessage('system', `用例修改未保存：${error.message}`);
    });
  }
  return true;
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
  const imageFile = state.uploadedFiles.find(file => file.type === 'image' && file.filename);
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

async function prepareRequirementFromUploads() {
  const imageFiles = state.uploadedFiles.filter(file => file.type === 'image' && file.base64);
  if (state.requirement || imageFiles.length === 0) return;

  const btnStart = $('#btn-start');
  const hint = $('#input-hint');
  const originalText = btnStart?.textContent || '开始';

  if (btnStart) {
    btnStart.disabled = true;
    btnStart.textContent = '识别图片中...';
  }
  if (hint) {
    hint.textContent = `正在识别原图 0/${imageFiles.length} · 0秒`;
    hint.className = 'text-xs text-zinc-500 mt-2 text-center';
  }

  const startedAt = Date.now();
  let completedImages = 0;
  const timer = setInterval(() => {
    if (hint) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      hint.textContent = `正在识别原图 ${completedImages}/${imageFiles.length} · ${elapsed}秒`;
    }
  }, 1000);

  try {
    const requirements = await Promise.all(imageFiles.map(async file => {
      if (file.extractedText) {
        return file.extractedText;
      }

      const response = await fetch(`${API_BASE}/extract-requirement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: file.base64 })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.requirement) {
        const errorMessage = data.error || `无法识别图片 ${file.filename || ''}`;
        if (/only support text|text input|不支持图片/i.test(errorMessage)) {
          throw new Error('当前模型只支持文本，请在设置中切换到支持图片的视觉模型');
        }
        throw new Error(errorMessage);
      }

      file.extractedText = data.requirement;
      completedImages++;
      return data.requirement;
    }));

    state.requirement = requirements.join('\n\n');
    state.rootTitle = deriveRootTitle(state.requirement);
    const input = $('#requirement-input');
    if (input) input.value = state.requirement;
    if (hint) hint.textContent = '';
  } finally {
    clearInterval(timer);
    if (btnStart) btnStart.textContent = originalText;
    updateStartButton();
  }
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
  
  if (viewName === 'engine' && !state.canvas) {
    state.canvas = new Canvas('canvas-container');
    state.canvas.onRunCase = (node) => {
      executeSingleCase(node);
    };
    
    state.canvas.onEditCase = (node) => {
      showEditCaseModal(node);
    };
  }
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
      placeholder: '粘贴需求文档，我帮你检查逻辑漏洞和测试点...',
      desc: '检查需求中的逻辑漏洞、遗漏场景、歧义描述',
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
    });
  });

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
          tag.className = 'flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-xs';
          tag.innerHTML = isImage ? `
            <img src="${URL.createObjectURL(file)}" class="w-8 h-8 object-cover rounded" />
            <span class="text-zinc-600">${escapeHtml(file.name)}</span>
            <button class="ml-1 text-zinc-400 hover:text-zinc-600" onclick="removeFile('${fileId}')">&times;</button>
          ` : `
            <svg class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <span class="text-zinc-600">${escapeHtml(file.name)}</span>
            <button class="ml-1 text-zinc-400 hover:text-zinc-600" onclick="removeFile('${fileId}')">&times;</button>
          `;
          
          // 保存解析结果
          state.uploadedFiles.push({ id: fileId, ...data.data });
          state.rootTitle = '';
          updateStartButton();
          
          // 将解析的文本添加到输入框
          if (data.data.text) {
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
    try {
      await prepareRequirementFromUploads();
      if (state.requirement) {
        state.rootTitle = deriveRootTitle(state.requirement);
        startAnalysis();
      }
    } catch (error) {
      const hint = $('#input-hint');
      if (hint) {
        hint.textContent = `图片识别失败：${error.message}`;
        hint.className = 'text-xs text-red-500 mt-2 text-center';
      }
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (['report', 'scripts'].includes(state.activeTab)) {
        startAnalysis();
        return;
      }
      if (hasAnalysisInput()) {
        prepareRequirementFromUploads()
          .then(() => state.requirement && startAnalysis())
          .catch(error => {
            const hint = $('#input-hint');
            if (hint) {
              hint.textContent = `图片识别失败：${error.message}`;
              hint.className = 'text-xs text-red-500 mt-2 text-center';
            }
          });
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
  const requestTimeout = setTimeout(() => requestController.abort(), 60000);
  
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
    clearTimeout(requestTimeout);
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
  if (!statusText) return null;
  try {
    const response = await fetch(`${API_BASE}/device/adb`);
    const data = await response.json();
    const status = data.status || {};
    if (status.connected) {
      statusText.textContent = `Android 已连接${status.active?.model ? ` · ${status.active.model}` : ''}`;
      detailText.textContent = status.active?.serial || '设备可用于手机端自动测试';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0';
    } else {
      statusText.textContent = status.available ? '未连接 Android 设备' : 'ADB 不可用';
      detailText.textContent = status.error || '请插入 USB 数据线，或输入无线 ADB 地址';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0';
    }
    return status;
  } catch (error) {
    statusText.textContent = '设备状态检查失败';
    detailText.textContent = error.message;
    dot.className = 'w-2.5 h-2.5 rounded-full bg-red-400 shrink-0';
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

// ========== 执行用例 ==========
function getAllCases() {
  if (!state.categories) return [];
  const cases = [];
  state.categories.forEach(cat => {
    if (cat.cases) {
      cat.cases.forEach(c => cases.push({
        ...c,
        productName: getMindMapRootTitle(),
        moduleName: cat.name || cat.type || c.category || '',
        category: cat.name || cat.type || c.category || ''
      }));
    }
  });
  return cases;
}

function executeSingleCase(node) {
  const testCase = getAllCases().find(item => String(item.id) === String(node.id)) || {
    id: node.id,
    title: node.title,
    priority: node.priority || 'P1',
    steps: node.children?.filter(child => child.type === 'step').map(child => child.title) || [],
    expected: node.children
      ?.flatMap(child => child.children || [])
      .find(child => child.type === 'expected')?.title || ''
  };
  let command = `测试用例：${testCase.title}\n`;
  if (testCase.steps?.length) {
    command += `步骤：\n${testCase.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n`;
  }
  if (testCase.expected) command += `预期结果：${testCase.expected}`;
  executeAIRun(command, testCase);
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
  const allCases = getAllCases();
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
  const usePIEngine = executorMode?.value === 'pi-engine';
  
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
          title: `${getMindMapRootTitle()}测试 ${new Date().toLocaleString('zh-CN')}`,
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
              updateIslandStatus('执行完成', `${payload.passed || 0} 通过, ${payload.failed || 0} 失败`);
              updateIslandProgress(total, total);
              
              if (payload.reportId) {
                islandState.lastReportId = payload.reportId;
                const reportButton = $('#btn-exec-view-report');
                reportButton?.classList.remove('hidden');
                addIslandLog('success', '测试报告已生成，点击“查看报告”可再次打开');
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
  
  switchView('engine');
  if (state.canvas) state.canvas.clear();
  
  // 显示需求摘要
  const summary = state.requirement.length > 40 ? 
    state.requirement.substring(0, 40) + '...' : state.requirement;
  $('#requirement-summary').textContent = summary;
  
  const chatArea = $('#scout-chat');
  
  // 清空对话区
  if (chatArea) chatArea.innerHTML = '';
  
  // Prism 开始对话
  await scoutSay('收到，让我看看这个需求...', 800);
  
  // 更新状态栏
  const engineStatus = $('#engine-status');
  if (engineStatus) engineStatus.textContent = '用例正在生成';
  
  // 启动动态思考过程，最后一步时跳转到画布
  startThinkingProcess(state.requirement, () => {
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
          content: state.requirement,
          productName: getMindMapRootTitle()
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
          content: state.requirement,
          productName: getMindMapRootTitle()
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
    const requestTimeout = setTimeout(() => requestController.abort(), 60000);
    
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
      clearTimeout(requestTimeout);
    }
    
    isChatting = false;
    updateChatIslandStatus('ready', '可协作调整');
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
    if (label) label.textContent = phase.label;
    if (time) time.textContent = seconds < 1 ? '刚刚开始' : `已等待 ${seconds} 秒`;
    updateChatIslandStatus('analyzing', phase.status);
  };

  update();
  const timer = setInterval(update, 1000);
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
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
  
  // 滚动到可视区域
  nodeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  
  // 2 秒后移除聚焦效果
  setTimeout(() => {
    nodeElement.classList.remove('node-focus-new');
  }, 2000);
}

// ========== 需求分析 ==========
async function startRequirementAnalysis() {
  console.log('[分析] 开始需求分析...');
  switchView('engine');
  
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
  
  console.log('[分析] 调用 API...');
  
  try {
    const response = await fetch(`${API_BASE}/generate-cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: state.requirement,
        productName: getMindMapRootTitle(),
        mode: 'analyze'
      })
    });
    
    console.log('[分析] 收到响应');
    const data = await response.json();
    console.log('[分析] 解析 JSON 成功:', data.success);
    
    if (data.success) {
      // 更新状态
      if (engineStatus) engineStatus.textContent = '分析完成';
      
      await scoutSay('分析完成，发现了一些潜在问题 ↓', 300);
      
      // 显示结果弹窗
      console.log('[分析] 显示结果...');
      showAnalysisResult(data.cases);
      console.log('[分析] 结果已显示');
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('[分析] 错误:', error);
    if (engineStatus) engineStatus.textContent = '分析失败';
    await scoutSay(`出了点问题：${error.message}`, 0);
  } finally {
    state.isAnalyzing = false;
  }
}

// ========== 显示需求分析结果（内联） ==========
function showAnalysisResult(categories) {
  const chatArea = $('#scout-chat');
  if (!chatArea) return;
  
  const issuesHtml = categories.map(cat => {
    const items = cat.cases.map(c => {
      const categoryColors = {
        '边界未定义': 'bg-amber-500',
        '逻辑漏洞': 'bg-red-500',
        '歧义描述': 'bg-orange-500',
        '遗漏场景': 'bg-purple-500',
        '技术风险': 'bg-blue-500',
        '体验问题': 'bg-green-500'
      };
      const colorClass = categoryColors[c.category] || 'bg-zinc-400';
      
      return `
        <div class="p-3 border border-zinc-100 rounded-lg">
          <div class="flex items-start gap-2">
            <span class="w-1.5 h-1.5 rounded-full ${colorClass} mt-2 shrink-0"></span>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded">${escapeHtml(c.category || '问题')}</span>
                <span class="text-sm text-zinc-700">${escapeHtml(c.title)}</span>
              </div>
              ${c.steps?.[0] ? `<p class="text-xs text-zinc-500 mt-1.5 leading-relaxed">${escapeHtml(c.steps[0])}</p>` : ''}
              ${c.expected ? `<p class="text-xs text-zinc-400 mt-1 italic">建议：${escapeHtml(c.expected)}</p>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    return items;
  }).join('');
  
  const totalIssues = categories.reduce((sum, cat) => sum + cat.cases.length, 0);
  
  // 生成纯文本用于复制
  const plainText = categories.map(cat => {
    return cat.cases.map(c => {
      let text = `[${c.category || '问题'}] ${c.title}`;
      if (c.steps?.[0]) text += `\n  ${c.steps[0]}`;
      if (c.expected) text += `\n  建议：${c.expected}`;
      return text;
    }).join('\n');
  }).join('\n\n');
  
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
              <span class="text-xs text-zinc-400 ml-2">${totalIssues} 个问题</span>
            </div>
            <button class="copy-report p-1.5 hover:bg-zinc-50 rounded-md transition-colors" title="复制报告">
              <svg class="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
            </button>
          </div>
          <!-- 报告内容 -->
          <div class="p-4 space-y-2 max-h-96 overflow-y-auto">
            ${issuesHtml}
          </div>
          <!-- 报告底部 -->
          <div class="px-4 py-2.5 bg-zinc-50 border-t border-zinc-100">
            <p class="text-[11px] text-zinc-400">建议和产品经理确认后再进入开发</p>
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
  if (existing) existing.remove();
  
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
  const steps = node.children?.filter(c => c.type === 'step').map(c => c.title) || [];
  const expected = node.children?.find(c => c.type === 'expected')?.title || '';
  
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
          <input id="edit-case-title" type="text" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400" value="${this.escapeHtml(node.title)}">
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">测试步骤</label>
          <textarea id="edit-case-steps" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm resize-none focus:outline-none focus:border-zinc-400" rows="4" placeholder="每行一个步骤">${steps.join('\n')}</textarea>
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">预期结果</label>
          <textarea id="edit-case-expected" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm resize-none focus:outline-none focus:border-zinc-400" rows="2">${expected}</textarea>
        </div>
        <div>
          <label class="block text-xs text-zinc-500 mb-1">优先级</label>
          <select id="edit-case-priority" class="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-zinc-400">
            <option value="P0" ${node.priority === 'P0' ? 'selected' : ''}>P0 - 最高</option>
            <option value="P1" ${node.priority === 'P1' ? 'selected' : ''}>P1 - 高</option>
            <option value="P2" ${node.priority === 'P2' ? 'selected' : ''}>P2 - 中</option>
            <option value="P3" ${node.priority === 'P3' ? 'selected' : ''}>P3 - 低</option>
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

      await persistCurrentSession();
      modal.remove();
      addIslandMessage('system', '用例已更新并保存');
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
      <iframe title="自动化测试报告" src="${API_BASE}/reports/${encodeURIComponent(reportId)}/html" class="w-full flex-1 border-0 bg-zinc-50"></iframe>
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
        const caseNode = {
          id: c.id,
          title: c.title,
          priority: c.priority,
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
    }
    
    // 直接渲染思维导图
    state.mindMap = buildMindMap(state.categories);
    state.canvas.setMindMap(state.mindMap);
    state.canvas.fitToView();
    
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
