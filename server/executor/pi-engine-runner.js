// input: PI Agent 会话，测试用例数据，大脑知识
// output: 基于意图理解的智能测试执行
// position: 智能测试执行器，理解意图、检索知识、规划路径、自主执行

const { PIAgent } = require('../pi/pi-agent');
const { recallWithAssociations, recordRecallUsage } = require('../brain/recall');
const { getAllFragments, upsertFragmentBySourceRef } = require('../brain/fragments');
const { callLLM } = require('../ai/generate');
const { jsonrepair } = require('jsonrepair');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  getScriptById,
  getScriptForCase,
  upsertScriptFromExecution,
  recordScriptRun,
} = require('../storage/automation-scripts');
const {
  launchBrowser,
  navigate,
  click,
  fill,
  screenshot,
  waitForElement,
  scroll,
  getSnapshot,
  switchDevice,
} = require('../pi/tools/browser');

class PIEngineRunner {
  constructor(options = {}) {
    this.agent = null;
    this.reportId = options.reportId;
    this.reportDir = options.reportDir || path.join(os.tmpdir(), 'scout-reports');
    this.screenshotIndex = 0;
    this.stopped = false;
    // 文本缓冲：将流式片段合并成完整句子
    this._textBuffer = '';
    this._textFlushTimer = null;
    this._onLog = null;
    this.preferredScriptId = options.preferredScriptId || null;
    this.scriptOnly = Boolean(options.scriptOnly);
    this.targetUrl = options.targetUrl || '';
    this.projectName = options.projectName || '';
    this.recordedActions = [];
    this.pendingBrowserAction = null;
    this.browserToolCalls = 0;
  }

  // 刷新文本缓冲
  flushTextBuffer() {
    if (this._textBuffer.trim() && this._onLog) {
      this._onLog({ type: 'thinking', text: this._textBuffer.trim() });
      this._textBuffer = '';
    }
    if (this._textFlushTimer) {
      clearTimeout(this._textFlushTimer);
      this._textFlushTimer = null;
    }
  }

  // 停止执行
  async stop() {
    console.log('[PIEngineRunner] 正在停止执行...');
    this.stopped = true;
    
    // 刷新文本缓冲
    this.flushTextBuffer();
    
    // 1. 立即关闭浏览器
    try {
      const { closeBrowser } = require('../pi/tools/browser');
      await closeBrowser();
      console.log('[PIEngineRunner] 浏览器已关闭');
    } catch (e) {
      console.error('[PIEngineRunner] 关闭浏览器失败:', e);
    }
    
    // 2. 销毁 PI Agent
    if (this.agent) {
      try {
        await this.agent.dispose();
        this.agent = null;
        console.log('[PIEngineRunner] PI Agent 已销毁');
      } catch (e) {
        console.error('[PIEngineRunner] 销毁 PI Agent 失败:', e);
        this.agent = null;
      }
    }
  }

  // 兼容 EnhancedRunner 的 launch 接口
  async launch(onLog) {
    this._onLog = onLog;
    onLog({ type: 'system', text: '正在检查可复用脚本...' });
  }

  // 初始化 Prism Agent
  async init(onLog) {
    this._onLog = onLog;
    onLog({ type: 'system', text: '正在连接 Prism Agent...' });
    onLog({ type: 'system', text: '正在初始化 Prism Agent...' });

    this.agent = new PIAgent({
      cwd: process.cwd(),
      onEvent: (type, data) => {
        switch (type) {
          case 'text':
            // 累积文本，遇到句号/换行或超时时才输出
            if (data) {
              this._textBuffer += data;
              // 遇到完整句子时立即输出
              if (/[。！？\n.!?]$/.test(this._textBuffer.trim())) {
                this.flushTextBuffer();
              } else {
                // 否则 800ms 后超时输出
                if (this._textFlushTimer) clearTimeout(this._textFlushTimer);
                this._textFlushTimer = setTimeout(() => this.flushTextBuffer(), 800);
              }
            }
            break;
          case 'tool_start':
            // 工具执行前，先刷新文本缓冲
            this.flushTextBuffer();
            // 根据工具类型和参数生成人性化的描述
            const startMsg = this.getToolStartMessage(data.name, data.args);
            onLog({ type: 'info', text: startMsg });
            if (data.name === 'browser') {
              this.pendingBrowserAction = { ...(data.args || {}) };
            }
            break;
          case 'tool_end':
            if (data.result?.details?.error) {
              const errorMsg = this.getToolErrorMessage(data.name, data.result.details.error);
              onLog({ type: 'stderr', text: errorMsg });
            } else {
              this.flushTextBuffer();
              const successMsg = this.getToolSuccessMessage(data.name, data.result);
              onLog({ type: 'success', text: successMsg });
              if (data.name === 'browser') {
                this.browserToolCalls++;
              }
              if (
                data.name === 'browser' &&
                this.pendingBrowserAction &&
                ['switch_device', 'navigate', 'click', 'fill', 'wait', 'scroll'].includes(this.pendingBrowserAction.action)
              ) {
                this.recordedActions.push({
                  action: this.pendingBrowserAction.action,
                  target: this.pendingBrowserAction.target || '',
                  value: this.pendingBrowserAction.value || '',
                });
              }
            }
            if (data.name === 'browser') this.pendingBrowserAction = null;
            break;
        }
      }
    });

    await this.agent.init();
    const modelInfo = this.agent.modelInfo;
    if (modelInfo?.model) {
      onLog({
        type: 'info',
        text: `智能模式模型: ${modelInfo.provider}/${modelInfo.model}`
      });
    }
    onLog({ type: 'success', text: 'Prism Agent 已就绪' });
  }

  // 获取工具开始执行时的人性化描述
  getToolStartMessage(toolName, args) {
    if (toolName === 'browser') {
      return this.getToolStartMessage(args?.action || 'browser', args);
    }
    // 根据工具类型和参数生成具体的描述
    switch (toolName) {
      case 'navigate':
        return `打开 ${args?.target || '页面'}...`;
      case 'switch_device':
        return `切换到 ${/手机|mobile/i.test(args?.target || '') ? '手机端' : 'Web 端'}...`;
      case 'click':
        return `点一下 ${args?.target || '这个元素'}`;
      case 'fill':
        return `在 ${args?.target || '输入框'} 里填 ${args?.value || '点东西'}`;
      case 'screenshot':
        return '截个图留证';
      case 'get_snapshot':
        return '看看页面上都有啥';
      case 'wait':
        return `等 ${args?.target || '元素'} 加载出来`;
      case 'scroll':
        return '往下翻翻，看看下面的内容';
      case 'bash':
        // 显示具体的命令
        const cmd = args?.target || args?.command || '';
        if (cmd) {
          // 截取命令的前30个字符
          const shortCmd = cmd.length > 30 ? cmd.substring(0, 30) + '...' : cmd;
          return `跑一下: ${shortCmd}`;
        }
        return '跑个命令';
      case 'read':
        return `看看 ${args?.target || '这个文件'}`;
      case 'write':
        return `写入 ${args?.target || '文件'}`;
      default:
        return `执行 ${toolName}`;
    }
  }

  // 获取工具执行成功时的人性化描述
  getToolSuccessMessage(toolName, result) {
    if (toolName === 'browser') {
      return this.getToolSuccessMessage(result?.details?.action || result?.action || 'browser-action', result);
    }
    switch (toolName) {
      case 'navigate':
        return '页面打开了';
      case 'switch_device':
        return `已切换到 ${result?.details?.deviceLabel || '目标设备'}`;
      case 'click':
        return '点完了';
      case 'fill':
        return '填好了';
      case 'screenshot':
        return '截图存好了';
      case 'get_snapshot':
        return '看到了页面结构';
      case 'wait':
        return '加载完了';
      case 'scroll':
        return '翻完了';
      case 'bash':
        return '跑完了';
      case 'read':
        return '看完了';
      case 'write':
        return '写进去了';
      default:
        if (toolName === 'browser-action') return '浏览器操作完成';
        return `${toolName} 搞定`;
    }
  }

  // 获取工具执行失败时的人性化描述
  getToolErrorMessage(toolName, error) {
    const messages = {
      'navigate': '页面打不开',
      'switch_device': '设备切换失败',
      'click': '点不了，找不到这个元素',
      'fill': '填不进去',
      'screenshot': '截图失败了',
      'get_snapshot': '看不了页面结构',
      'wait': '等太久了，超时了',
      'scroll': '翻不动',
      'bash': '命令跑挂了',
      'read': '文件读不了',
      'write': '写不进去'
    };
    const baseMsg = messages[toolName] || `${toolName} 出问题了`;
    return `${baseMsg}：${error}`;
  }

  // 执行单个测试用例
  async executeTestCase(testCase, onLog) {
    // 检查是否被停止
    if (this.stopped) {
      throw new Error('用户已停止执行');
    }
    
    const startTime = Date.now();

    onLog({ type: 'system', text: `--- 开始执行: ${testCase.title} ---` });

    try {
      const knowledge = this.retrieveKnowledge(testCase);
      const savedScript = this.preferredScriptId
        ? getScriptById(this.preferredScriptId)
        : getScriptForCase(testCase);
      if (savedScript?.enabled) {
        onLog({
          type: 'system',
          text: `命中脚本库：${savedScript.name}，直接回放，不调用大模型`,
        });
        await this.ensureWebLoggedIn(testCase, knowledge, onLog);
        const replayResult = await this.executeSavedScript(savedScript, onLog);
        if (!replayResult.stopped) {
          recordScriptRun(savedScript.id, {
            success: replayResult.success,
            reportId: this.reportId,
          });
        }
        if (replayResult.success) {
          return {
            status: 'passed',
            steps: replayResult.steps,
            durationMs: Date.now() - startTime,
            scriptId: savedScript.id,
            reusedScript: true,
          };
        }
        if (replayResult.stopped) {
          return {
            status: 'stopped',
            steps: replayResult.steps,
            errorMessage: '用户已停止执行',
            durationMs: Date.now() - startTime,
            scriptId: savedScript.id,
            reusedScript: true,
          };
        }
        if (this.scriptOnly) {
          return {
            status: 'failed',
            steps: replayResult.steps,
            errorMessage: replayResult.error,
            durationMs: Date.now() - startTime,
            scriptId: savedScript.id,
            reusedScript: true,
          };
        }
        onLog({
          type: 'system',
          text: '脚本回放失败，切换 Prism Agent 自愈；成功后会自动更新脚本',
        });
      } else if (this.scriptOnly) {
        throw new Error('当前脚本不可用或已停用');
      } else {
        onLog({ type: 'info', text: '脚本库未命中，本次使用 Prism Agent 探索' });
      }

      if (!PIEngineRunner._piToolCallingUnsupported && !this.agent) {
        await this.init(onLog);
      }

      // ===== 阶段 1: 意图分析 + 知识检索 =====
      onLog({ type: 'thinking', text: '正在理解测试意图并检索相关知识...' });
      if (knowledge.fragments.length > 0) {
        onLog({ type: 'info', text: `从大脑找到 ${knowledge.fragments.length} 条相关知识` });
        if (knowledge.executionFragments.length > 0) {
          onLog({ type: 'info', text: `已注入 ${knowledge.executionFragments.length} 条入口/账号执行知识` });
        }
        if (knowledge.urls.length > 0) {
          onLog({ type: 'info', text: `相关 URL: ${knowledge.urls.join(', ')}` });
        }
        if (knowledge.accounts.length > 0) {
          onLog({ type: 'info', text: `找到账号信息` });
        }
      } else {
        onLog({ type: 'info', text: '大脑中暂无相关知识，Prism Agent 将自主探索' });
      }
      await this.ensureWebLoggedIn(testCase, knowledge, onLog);

      // ===== 阶段 2: 让 Prism Agent 自主执行 =====
      onLog({ type: 'system', text: 'Prism Agent 开始自主执行...' });
      const result = await this.executeWithPIAgent(testCase, knowledge, onLog);

      if (result.stopped) {
        return {
          status: 'stopped',
          steps: result.steps || [],
          errorMessage: result.error || '用户已停止执行',
          durationMs: Date.now() - startTime,
        };
      }

      if (result.success && result.scriptActions?.length) {
        const saved = upsertScriptFromExecution(testCase, result.scriptActions);
        if (saved) {
          recordScriptRun(saved.id, { success: true, reportId: this.reportId });
          onLog({
            type: 'success',
            text: `已自动入库脚本：${saved.name}（${saved.steps.length} 个动作）`,
          });
        }
      }

      return {
        status: result.success ? 'passed' : 'failed',
        steps: result.steps || [],
        errorMessage: result.error,
        durationMs: Date.now() - startTime,
        scriptId: result.scriptId,
      };

    } catch (error) {
      if (this.stopped || error.code === 'EXECUTION_STOPPED') {
        onLog({ type: 'system', text: '用户已停止执行' });
        return {
          status: 'stopped',
          steps: [],
          errorMessage: '用户已停止执行',
          durationMs: Date.now() - startTime,
        };
      }
      onLog({ type: 'error', text: `执行失败: ${error.message}` });
      return {
        status: 'failed',
        steps: [],
        errorMessage: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }

  async executeSavedScript(script, onLog) {
    const stepResults = [];
    this.ensureNotStopped();
    if (!Array.isArray(script.steps) || script.steps.length === 0) {
      return {
        success: false,
        steps: stepResults,
        error: '脚本没有可执行步骤，不能判定通过',
      };
    }
    await launchBrowser();
    if (this.stopped) {
      const { closeBrowser } = require('../pi/tools/browser');
      await closeBrowser();
      return {
        success: false,
        stopped: true,
        steps: stepResults,
        error: '用户已停止执行',
      };
    }
    this.ensureNotStopped();

    for (let index = 0; index < script.steps.length; index++) {
      this.ensureNotStopped();
      const action = this.normalizeRuntimeStep(script.steps[index]);
      const startedAt = Date.now();
      const description = this.describeScriptAction(action);
      onLog({ type: 'info', text: `脚本 ${index + 1}/${script.steps.length}：${description}` });

      try {
        switch (action.action) {
          case 'navigate':
            await navigate(action.target);
            break;
          case 'switch_device':
            await switchDevice(action.target || action.value || 'web');
            break;
          case 'click':
            await click(action.target);
            break;
          case 'fill':
            await fill(action.target, action.value || '');
            break;
          case 'wait':
            await waitForElement(action.target, parseInt(action.value, 10) || 5000);
            break;
          case 'scroll':
            await scroll(action.target || 'down', parseInt(action.value, 10) || 500);
            break;
          case 'assert_text': {
            const snapshotResult = await getSnapshot();
            const snapshot = snapshotResult.snapshot || {};
            const pageText = [
              ...(snapshot.visibleText || []),
              ...(snapshot.headings || []).map(item => item.text),
              ...(snapshot.buttons || []).map(item => item.text),
              ...(snapshot.links || []).map(item => item.text),
            ].filter(Boolean).join('\n');
            if (!pageText.includes(action.target)) {
              throw new Error(`页面未找到文本：${action.target}`);
            }
            break;
          }
          case 'screenshot':
            await this.takeScreenshot(`script_step_${index + 1}`);
            break;
          default:
            throw new Error(`不支持的脚本动作：${action.action}`);
        }
        this.ensureNotStopped();
        stepResults.push({
          stepIndex: index + 1,
          description,
          action: JSON.stringify(action),
          status: 'passed',
          durationMs: Date.now() - startedAt,
        });
        onLog({ type: 'success', text: `脚本步骤 ${index + 1} 完成` });
      } catch (error) {
        if (this.stopped || error.code === 'EXECUTION_STOPPED') {
          return {
            success: false,
            stopped: true,
            steps: stepResults,
            error: '用户已停止执行',
          };
        }
        const captured = await screenshot(`script_error_${index + 1}`).catch(() => null);
        stepResults.push({
          stepIndex: index + 1,
          description,
          action: JSON.stringify(action),
          status: 'failed',
          screenshotPath: captured?.filepath || null,
          errorMessage: error.message,
          durationMs: Date.now() - startedAt,
        });
        return { success: false, steps: stepResults, error: error.message };
      }
    }

    this.ensureNotStopped();
    const captured = await this.takeScreenshot('script_final');
    if (stepResults.length > 0 && captured?.filepath) {
      stepResults[stepResults.length - 1].screenshotPath = captured.filepath;
    }
    return { success: true, steps: stepResults };
  }

  normalizeRuntimeStep(step = {}) {
    if (typeof step === 'string') {
      return { action: 'click', target: step, value: '' };
    }
    const rawAction = String(step.action || step.type || step.command || 'click').trim().toLowerCase();
    const actionAliases = {
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
    };
    const action = actionAliases[rawAction] || rawAction || 'click';
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
      action,
      target: String(target || ''),
      value: value === undefined || value === null ? '' : String(value),
    };
  }

  ensureNotStopped() {
    if (!this.stopped) return;
    const error = new Error('用户已停止执行');
    error.code = 'EXECUTION_STOPPED';
    throw error;
  }

  describeScriptAction(action) {
    const labels = {
      navigate: '打开',
      switch_device: '切换设备',
      click: '点击',
      fill: '输入',
      wait: '等待',
      scroll: '滚动',
      assert_text: '验证页面文本',
      screenshot: '截图',
    };
    const value = action.action === 'fill' && action.value ? `：${action.value}` : '';
    return `${labels[action.action] || action.action} ${action.target || ''}${value}`.trim();
  }

  // 从大脑检索知识。执行入口只允许来自项目执行知识，历史用例只做设计参考。
  retrieveKnowledge(testCase) {
    this.ensureDefaultExecutionKnowledge();

    const stepText = (testCase.steps || []).join(' ');
    const explicitUrls = this.extractUrls(stepText);
    const optionUrls = this.extractUrls(this.targetUrl);
    const explicitUrl = explicitUrls[0] || '';
    const optionUrl = optionUrls[0] || '';
    const requestedUrl = explicitUrl || optionUrl;
    const targetHosts = new Set([...explicitUrls, ...optionUrls].map(url => this.getUrlHost(url)).filter(Boolean));
    const query = this.buildKnowledgeQuery(testCase);

    const executionFragments = this.retrieveExecutionKnowledge(testCase, query, targetHosts, requestedUrl);
    const fragments = [...executionFragments];
    const urls = [];
    const accounts = [];
    const tips = [];

    if (requestedUrl) urls.push(requestedUrl);
    fragments.forEach(f => {
      const content = f.content || '';
      this.extractUrls(content).forEach(url => urls.push(url));
      const credentialSnippet = this.extractCredentialSnippet(content);
      if (credentialSnippet) accounts.push(credentialSnippet);
      if (/(注意|提示|技巧|方法|步骤|先|然后|最后)/i.test(content)) tips.push(content);
    });
    if (fragments.length > 0) {
      recordRecallUsage(fragments.map(fragment => fragment.id));
    }

    const uniqueUrls = [...new Set(urls)];
    const loginRequired = executionFragments.some(fragment => /(登录|账号|密码|未登录|登录态)/i.test(fragment.content || ''));

    return {
      fragments,
      executionFragments,
      urls: uniqueUrls,
      preferredUrl: requestedUrl || uniqueUrls[0] || '',
      accounts: [...new Set(accounts)],
      tips: [],
      loginRequired,
      requestedUrlSource: explicitUrl ? 'case_step' : optionUrl ? 'execute_option' : uniqueUrls[0] ? 'execution_knowledge' : '',
      executionRaw: executionFragments.map(f => this.formatKnowledgeFragment(f)).join('\n'),
      raw: ''
    };
  }

  ensureDefaultExecutionKnowledge() {
    if (PIEngineRunner._defaultExecutionKnowledgeSeeded) return;
    PIEngineRunner._defaultExecutionKnowledgeSeeded = true;
    const moduleTags = [
      '售后模块',
      '质检报告',
      '工作台',
      '客户管理',
      '客户主体',
      '客户门店',
      '客户价格',
      '供应商管理',
      '订单管理',
      '订单详情',
      '采购管理',
      '采购商品管理',
      '采购取货',
      '采购需求',
      '财务管理',
      '授信账单',
      '配送管理',
      '取货任务',
      '退货运单',
      '商品管理',
      '商品回收站',
      '单位管理',
      '基础管理',
      '系统管理',
      '角色管理',
      '业务配置',
      '消息推送',
      '售后退款',
    ];
    upsertFragmentBySourceRef(
      'execution:supply-chain:web-entry',
      '【项目执行知识】项目：供应链系统。Web 测试入口：https://foodsc.data-match.net/。适用模块：售后模块、质检报告、客户管理、客户主体、客户门店、供应商管理、订单管理、采购管理、财务管理、配送管理、商品管理、基础管理、系统管理。',
      ['knowledgeType:execution', 'execution', '执行配置', '项目执行知识', '供应链系统', 'Web测试入口', '访问地址', ...moduleTags],
      'learned'
    );
    upsertFragmentBySourceRef(
      'execution:supply-chain:admin-login',
      '【项目执行知识】项目：供应链系统。登录规则：Web 用例打开入口后先判断登录态；未登录时使用账号：admin / 密码：admin123 登录。',
      ['knowledgeType:execution', 'execution', '执行配置', '登录配置', '账号密码', '供应链系统', ...moduleTags],
      'learned'
    );
  }

  retrieveExecutionKnowledge(testCase, query, targetHosts = new Set(), requestedUrl = '') {
    const needsWebEntry = /(web|Web|后台|测试入口|入口|登录|账号|密码|目录|URL|地址|https?:\/\/)/i.test(query) || Boolean(requestedUrl);
    if (!needsWebEntry) return [];

    const projectTerms = this.getProjectTerms(testCase);
    const requestedHost = requestedUrl ? this.getUrlHost(requestedUrl) : '';
    const candidates = getAllFragments({ limit: Number.MAX_SAFE_INTEGER })
      .filter(fragment => this.isExecutionKnowledge(fragment))
      .map(fragment => {
        const content = fragment.content || '';
        const hasUrl = /https?:\/\//i.test(content);
        const hasAccount = this.isCredentialKnowledge(content);
        if (!hasUrl && !hasAccount) return null;
        const match = this.matchExecutionKnowledge(fragment, {
          query,
          projectTerms,
          targetHosts,
          requestedHost,
        });
        if (!match.matched) return null;
        let score = match.score;
        if (hasUrl) score += 6;
        if (hasAccount) score += 4;
        if (/(Web\s*测试入口|web测试入口|测试入口|后台入口|后台地址|访问地址|URL|地址)/i.test(content)) score += 2;
        if (fragment.source === 'manual') score += 2;
        if (fragment.source === 'learned') score += 1;
        return { ...fragment, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const urlCandidates = candidates.filter(fragment => /https?:\/\//i.test(fragment.content || ''));
    const selectedUrls = requestedUrl ? [] : urlCandidates.slice(0, 1);
    const selectedUrlIds = new Set(selectedUrls.map(fragment => fragment.id));
    const selectedAccounts = candidates
      .filter(fragment => !selectedUrlIds.has(fragment.id) && this.isCredentialKnowledge(fragment.content || ''))
      .slice(0, 3);
    return [...selectedUrls, ...selectedAccounts];
  }

  extractUrls(text = '') {
    return String(text || '').match(/https?:\/\/[^\s，。、；]+/g) || [];
  }

  getUrlHost(url = '') {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  buildKnowledgeQuery(testCase = {}) {
    return [
      this.projectName,
      testCase.productName,
      testCase.moduleName,
      testCase.title,
      testCase.category,
      ...(testCase.steps || [])
    ].filter(Boolean).join(' ');
  }

  getProjectTerms(testCase = {}) {
    const hierarchy = this.getExecutionHierarchy(testCase);
    const knownModules = [
      '供应链系统',
      '数配生鲜',
      '售后模块',
      '质检报告',
      '工作台',
      '客户管理',
      '客户主体',
      '客户门店',
      '客户价格',
      '供应商管理',
      '订单管理',
      '订单详情',
      '采购管理',
      '采购商品管理',
      '采购取货',
      '采购需求',
      '财务管理',
      '授信账单',
      '配送管理',
      '取货任务',
      '退货运单',
      '商品管理',
      '商品回收站',
      '单位管理',
      '基础管理',
      '系统管理',
      '角色管理',
      '业务配置',
      '消息推送',
      '售后退款',
      '售后管理',
    ];
    const values = [
      this.projectName,
      testCase.productName,
      testCase.moduleName,
      testCase.category,
      hierarchy.productName,
      hierarchy.moduleName,
      ...(Array.isArray(testCase.steps) ? testCase.steps : []),
    ].filter(Boolean);
    const terms = [];
    values.forEach(value => {
      const raw = String(value || '');
      knownModules
        .filter(term => raw.includes(term))
        .forEach(term => terms.push(term));
      String(value)
        .split(/[\s/｜|>、，,。；;：:\[\]（）()]+/)
        .map(item => item.trim())
        .filter(item => item.length >= 2)
        .filter(item => !/^(Web|web|后台|测试入口|入口|打开|进入|找到|点击|验证|输入|等待|用例|测试|页面|模块|需求简述|需求|报告)$/.test(item))
        .forEach(item => terms.push(item));
    });
    return [...new Set(terms)];
  }

  isExecutionKnowledge(fragment = {}) {
    const content = fragment.content || '';
    const tags = Array.isArray(fragment.tags) ? fragment.tags : [];
    const haystack = `${content}\n${tags.join(' ')}\n${fragment.source_ref || ''}`;
    if (fragment.source === 'test_case_history') return false;
    if (tags.includes('历史用例') || /【历史测试用例】/.test(content)) return false;
    if (/请将以下碎片整合为一条更完整的认知/.test(content)) return false;
    if (/(knowledgeType:case_reference|case_reference|历史学习|用例参考)/i.test(haystack)) return false;
    if (/(knowledgeType:execution|项目执行知识|执行配置|登录配置|入口配置|execution:)/i.test(haystack)) return true;
    return (fragment.source === 'manual' || fragment.source === 'learned')
      && /(项目|系统|环境).{0,30}(入口|地址|URL|登录|账号|密码)|Web\s*测试入口|后台地址|访问地址|登录规则/i.test(haystack);
  }

  matchExecutionKnowledge(fragment, context = {}) {
    const content = fragment.content || '';
    const tags = Array.isArray(fragment.tags) ? fragment.tags : [];
    const haystack = `${content}\n${tags.join(' ')}`;
    const fragmentHosts = this.extractUrls(content).map(url => this.getUrlHost(url)).filter(Boolean);
    const { query = '', projectTerms = [], targetHosts = new Set(), requestedHost = '' } = context;

    if (targetHosts.size > 0 && fragmentHosts.length > 0) {
      const matchesHost = fragmentHosts.some(host => targetHosts.has(host));
      return matchesHost ? { matched: true, score: 20 } : { matched: false, score: 0 };
    }

    if (requestedHost && fragmentHosts.length > 0 && !fragmentHosts.includes(requestedHost)) {
      return { matched: false, score: 0 };
    }

    const externalSignals = ['百度', 'baidu', '淘宝', '京东', '抖音', '微信', 'GitLab', 'github'];
    const hasExternalSignal = externalSignals.some(term => new RegExp(term, 'i').test(query));
    if (hasExternalSignal && !externalSignals.some(term => new RegExp(term, 'i').test(haystack))) {
      return { matched: false, score: 0 };
    }

    const isSupplyChainKnowledge = /(供应链|foodsc\.data-match\.net)/.test(haystack);
    const hasSupplyChainSignal = /(供应链|数配|生鲜|售后|质检报告|采购|配送|供应商|客户主体|客户门店|客户价格|客户管理|订单管理|订单详情|商品管理|商品回收站|授信账单|取货任务|退货运单|单位管理|角色管理|业务配置|消息推送)/.test(query);
    if (isSupplyChainKnowledge && !hasSupplyChainSignal && !requestedHost) {
      return { matched: false, score: 0 };
    }

    let score = 0;
    if (requestedHost && /foodsc\.data-match\.net/i.test(requestedHost) && /(供应链|foodsc\.data-match\.net)/.test(haystack)) {
      score += 20;
    }
    projectTerms.forEach(term => {
      if (haystack.includes(term)) score += 3;
    });

    if (hasSupplyChainSignal && /(供应链|foodsc\.data-match\.net|数配|生鲜|售后|质检报告|采购|配送|供应商|客户主体|客户门店|客户价格|客户管理|订单管理|订单详情|商品管理|商品回收站|授信账单|取货任务|退货运单|单位管理|角色管理|业务配置|消息推送)/.test(haystack)) {
      score += 8;
    }

    if (projectTerms.length === 0 && fragment.source_ref?.startsWith('execution:') && /供应链/.test(haystack) && hasSupplyChainSignal) {
      score += 6;
    }

    return score > 0 ? { matched: true, score } : { matched: false, score: 0 };
  }

  formatKnowledgeFragment(fragment) {
    const tags = Array.isArray(fragment.tags) && fragment.tags.length
      ? `标签：${fragment.tags.join('、')}\n`
      : '';
    return `- 来源：${fragment.source || 'unknown'} #${fragment.id}\n${tags}${fragment.content}`;
  }

  isCredentialKnowledge(content = '') {
    return Boolean(this.extractCredentialSnippet(content));
  }

  extractCredentialSnippet(content = '') {
    const adminPair = /admin\s*[/,，\s]+\s*admin123/i.exec(content);
    if (adminPair) return '账号：admin / 密码：admin123';

    const loosePair = /(?:账号|用户名|用户)\s*(?:是|为|:|：|=)?\s*([a-zA-Z0-9_@.-]{3,}).{0,30}?密码\s*(?:是|为|:|：|=)?\s*([a-zA-Z0-9_@.-]{3,})/i.exec(content);
    if (loosePair) return `账号：${loosePair[1]} / 密码：${loosePair[2]}`;

    const snippets = [];
    String(content)
      .split(/[\n。；;]/)
      .forEach(segment => {
        if (segment.length > 120) return;
        const account = /((登录)?账号|用户名|用户)\s*(是|为|:|：|=)\s*([a-zA-Z0-9_@.-]{3,})/i.exec(segment);
        const password = /密码\s*(是|为|:|：|=)\s*([a-zA-Z0-9_@.-]{3,})/i.exec(segment);
        if (account) snippets.push(`账号：${account[4]}`);
        if (password) snippets.push(`密码：${password[2]}`);
      });
    if (snippets.length === 0) return '';
    return [...new Set(snippets)].join(' / ');
  }

  isWebTestCase(testCase = {}, knowledge = {}) {
    const text = [
      testCase.productName,
      testCase.moduleName,
      testCase.category,
      testCase.title,
      ...(Array.isArray(testCase.steps) ? testCase.steps : []),
    ].filter(Boolean).join('\n');
    const hasWebSignal = /\[(Web|后台)\]|Web|web|后台|浏览器|测试入口|访问地址|后台地址/i.test(text);
    const mobileOnly = /\[(手机|移动端|小程序|H5|App)\]|手机端|移动端|小程序|Android|安卓|\bApp\b|\bH5\b/i.test(text)
      && !hasWebSignal;
    return hasWebSignal || (!mobileOnly && Boolean(knowledge.preferredUrl || knowledge.urls?.length));
  }

  snapshotToText(snapshotResult = {}) {
    const snapshot = snapshotResult.snapshot || snapshotResult || {};
    const parts = [
      snapshot.url,
      snapshot.title,
      ...(snapshot.visibleText || []),
      ...(snapshot.headings || []).map(item => item.text),
      ...(snapshot.buttons || []).map(item => item.text),
      ...(snapshot.links || []).map(item => item.text),
      ...(snapshot.inputs || []).map(item => `${item.placeholder || ''} ${item.type || ''}`),
    ];
    return parts.filter(Boolean).join('\n');
  }

  isLoginSnapshot(snapshotResult = {}) {
    const snapshot = snapshotResult.snapshot || snapshotResult || {};
    const text = this.snapshotToText(snapshotResult);
    const hasPasswordInput = (snapshot.inputs || []).some(item =>
      /(password|密码)/i.test(`${item.type || ''} ${item.placeholder || ''}`)
    );
    const hasAccountInput = (snapshot.inputs || []).some(item =>
      /(账号|账户|用户名|用户|手机号|手机|account|user|login)/i.test(item.placeholder || '')
    );
    const hasLoginButton = /(登录|登\s*录|login|sign\s*in)/i.test(text);
    return hasPasswordInput && (hasAccountInput || hasLoginButton || /login/i.test(snapshot.url || ''));
  }

  isLoggedInSnapshot(snapshotResult = {}) {
    const text = this.snapshotToText(snapshotResult);
    const hasMainPageMarker = /(工作台|首页|订单管理|采购管理|配送管理|商品管理|客户管理|门店管理|供应商管理|财务管理|售后|质检报告|基础管理|系统管理|控制台|退出|注销)/.test(text);
    return hasMainPageMarker && !this.isLoginSnapshot(snapshotResult);
  }

  getLoginCredentials(knowledge = {}) {
    const sourceText = [
      ...(knowledge.accounts || []),
      knowledge.executionRaw || '',
    ].filter(Boolean).join('\n');

    const adminPair = /admin\s*[/,，\s]+\s*admin123/i.exec(sourceText);
    if (adminPair) {
      return { username: 'admin', password: 'admin123', source: '知识库账号' };
    }

    const labeledPair = /(?:账号|用户名|用户)\s*(?:是|为|:|：|=)?\s*([a-zA-Z0-9_@.-]{3,}).{0,80}?密码\s*(?:是|为|:|：|=)?\s*([a-zA-Z0-9_@.-]{3,})/is.exec(sourceText);
    if (labeledPair) {
      return { username: labeledPair[1], password: labeledPair[2], source: '知识库账号' };
    }

    return null;
  }

  async fillFirst(targets, value, label, onLog) {
    let lastError = null;
    for (const target of targets) {
      this.ensureNotStopped();
      try {
        await fill(target, value);
        onLog?.({ type: 'info', text: `已填写${label}` });
        return target;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`登录前置无法填写${label}：${lastError?.message || '未找到输入框'}`);
  }

  async clickFirst(targets, label, onLog) {
    let lastError = null;
    for (const target of targets) {
      this.ensureNotStopped();
      try {
        await click(target);
        onLog?.({ type: 'info', text: `已点击${label}` });
        return target;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`登录前置无法点击${label}：${lastError?.message || '未找到按钮'}`);
  }

  async ensureWebLoggedIn(testCase, knowledge, onLog) {
    if (!this.isWebTestCase(testCase, knowledge)) return;

    this.ensureNotStopped();
    const preferredUrl = knowledge.preferredUrl || knowledge.urls?.[0] || '';
    if (!preferredUrl) {
      throw new Error('未配置该项目的 Web 测试入口，请先在执行配置里配置项目入口');
    }

    const credentials = this.getLoginCredentials(knowledge);
    const shouldCheckLogin = knowledge.loginRequired || Boolean(credentials);
    if (!shouldCheckLogin) {
      onLog?.({ type: 'info', text: `已解析 Web 入口：${preferredUrl}；该项目未配置登录规则，按用例步骤直接执行` });
      return;
    }

    onLog?.({ type: 'system', text: 'Web 前置：打开入口并检查登录态' });
    await switchDevice('web');
    await navigate(preferredUrl);
    await new Promise(resolve => setTimeout(resolve, 900));
    this.ensureNotStopped();
    await this.takeScreenshot('login_check');

    let snapshotResult = await getSnapshot();
    if (this.isLoggedInSnapshot(snapshotResult)) {
      onLog?.({ type: 'success', text: '检测到 Web 已登录，继续执行用例' });
      return;
    }

    if (!this.isLoginSnapshot(snapshotResult)) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      snapshotResult = await getSnapshot();
      if (this.isLoggedInSnapshot(snapshotResult)) {
        onLog?.({ type: 'success', text: '检测到 Web 已登录，继续执行用例' });
        return;
      }
      if (!this.isLoginSnapshot(snapshotResult)) {
        onLog?.({ type: 'info', text: '当前页面未识别到登录表单，按当前页面继续执行' });
        return;
      }
    }

    if (!credentials) {
      throw new Error('未配置该项目登录账号，无法自动完成登录前置');
    }
    onLog?.({ type: 'thinking', text: `检测到未登录，使用${credentials.source}自动登录` });
    await this.fillFirst(['账号', '用户名', '用户', '手机号', '请输入账号', '请输入用户名'], credentials.username, '账号', onLog);
    await this.fillFirst(['密码', '请输入密码', 'password'], credentials.password, '密码', onLog);
    await this.clickFirst(['登录', '登 录', '立即登录', 'Login', 'Sign in'], '登录按钮', onLog);

    let afterLogin = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 600));
      this.ensureNotStopped();
      afterLogin = await getSnapshot();
      if (this.isLoggedInSnapshot(afterLogin)) break;
    }
    await this.takeScreenshot('login_after');

    if (!this.isLoggedInSnapshot(afterLogin) && this.isLoginSnapshot(afterLogin)) {
      throw new Error('登录前置失败：仍停留在登录页，请检查账号密码、验证码或登录页限制');
    }

    onLog?.({ type: 'success', text: 'Web 登录前置完成，开始执行当前用例步骤' });
  }

  // 让 PI Agent 自主执行
  async executeWithPIAgent(testCase, knowledge, onLog) {
    this.recordedActions = [];
    this.pendingBrowserAction = null;
    this.browserToolCalls = 0;

    // 检查是否被停止
    if (this.stopped) {
      throw new Error('用户已停止执行');
    }

    // 构建给 Prism Agent 的 prompt
    const prompt = this.buildPrompt(testCase, knowledge);

    try {
      if (PIEngineRunner._piToolCallingUnsupported) {
        onLog?.({
          type: 'system',
          text: '当前模型已识别为不支持 PI 工具调用，直接使用 Prism 本地智能 Agent',
        });
        return await this.executeWithLocalAgent(testCase, knowledge, onLog);
      }

      // 让 Prism Agent 自主执行整个任务
      await this.agent.prompt(prompt);

      // 刷新剩余的文本缓冲
      this.flushTextBuffer();

      // 检查是否被停止
      if (this.stopped) {
        const stoppedError = new Error('用户已停止执行');
        stoppedError.code = 'EXECUTION_STOPPED';
        throw stoppedError;
      }

      if (this.browserToolCalls === 0) {
        onLog?.({
          type: 'info',
          text: '当前模型第一次没有触发 browser 工具，正在要求 Agent 重新按智能模式执行',
        });
        const retryPrompt = `刚才没有检测到任何 browser 工具调用，测试还没有真正执行。

必须立刻调用 browser 工具完成下面的测试，不允许只输出文字：
1. 先调用 browser.switch_device 切到 Web 或手机端
2. 再按测试步骤逐条调用 browser.navigate / click / fill / get_snapshot / screenshot
3. 每个步骤完成后观察页面结果

测试用例：${testCase.title}
步骤：
${(testCase.steps || []).map((step, index) => `${index + 1}. ${step}`).join('\n')}
预期：${testCase.expected || '操作成功完成'}

可用入口：${knowledge.preferredUrl || (knowledge.urls || []).join(', ') || '未配置'}

现在开始调用 browser 工具执行。`;
        this.flushTextBuffer();
        await this.agent.prompt(retryPrompt);
        this.flushTextBuffer();
      }

      if (this.browserToolCalls === 0) {
        PIEngineRunner._piToolCallingUnsupported = true;
        onLog?.({
          type: 'system',
          text: '当前模型仍未触发 PI browser 工具，切换为 Prism 本地智能 Agent 执行',
        });
        return await this.executeWithLocalAgent(testCase, knowledge, onLog);
      }

      if (this.recordedActions.length === 0) {
        throw new Error('Prism Agent 没有产生任何可执行浏览器动作，不能判定通过');
      }
      const meaningfulActions = this.recordedActions.filter(action =>
        ['navigate', 'click', 'fill', 'wait', 'scroll'].includes(action.action)
      );
      if (meaningfulActions.length === 0) {
        throw new Error('Prism Agent 只完成了设备切换，没有执行页面操作，不能判定通过');
      }

      // 浏览器存活只做诊断提示，不作为通过/失败的唯一依据；ADB 手机端没有 Playwright context。
      const { isBrowserAlive } = require('../pi/tools/browser');
      const webAlive = await isBrowserAlive('web').catch(() => false);
      const mobileAlive = await isBrowserAlive('mobile').catch(() => false);
      if (!webAlive && !mobileAlive) {
        onLog?.({ type: 'stderr', text: '未检测到仍存活的 Playwright 页面，将以已执行动作和最终截图为准' });
      }

      // 截图记录最终状态
      const finalScreenshot = await this.takeScreenshot('final');
      const completedSteps = (testCase.steps || []).map((description, index) => ({
        stepIndex: index + 1,
        description,
        status: 'passed',
        screenshotPath: index === testCase.steps.length - 1 ? finalScreenshot?.filepath : null,
        durationMs: 0,
      }));

      return {
        success: true,
        steps: completedSteps,
        scriptActions: [...this.recordedActions],
      };
    } catch (error) {
      if (this.stopped || error.code === 'EXECUTION_STOPPED') {
        return {
          success: false,
          stopped: true,
          error: '用户已停止执行',
          steps: [],
        };
      }
      let errorScreenshot = null;
      if (!this.stopped) {
        errorScreenshot = await this.takeScreenshot('error');
      }
      const failedIndex = (this.browserToolCalls > 0 || this.recordedActions.length > 0)
        ? Math.max((testCase.steps || []).length - 1, 0)
        : 0;
      const failedSteps = (testCase.steps || []).map((description, index) => ({
        stepIndex: index + 1,
        description,
        status: index < failedIndex ? 'passed' : index === failedIndex ? 'failed' : 'pending',
        screenshotPath: index === failedIndex ? errorScreenshot?.filepath : null,
        errorMessage: index === failedIndex ? error.message : null,
        durationMs: 0,
      }));
      return { success: false, error: error.message, steps: failedSteps };
    }
  }

  async executeWithLocalAgent(testCase, knowledge, onLog) {
    this.recordedActions = [];
    const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
    if (steps.length === 0) {
      return { success: false, error: '用例没有可执行步骤', steps: [] };
    }

    const stepResults = [];
    const actionHistory = [];
    const maxTurns = Math.min(Math.max(steps.length * 4, 8), 24);
    let currentStepIndex = 0;
    let lastObservation = '';

    onLog?.({ type: 'system', text: 'Prism 本地智能 Agent 开始自主探索...' });

    for (let turn = 0; turn < maxTurns; turn++) {
      this.ensureNotStopped();
      const currentStep = steps[currentStepIndex] || '';
      let snapshotResult = null;
      try {
        snapshotResult = await getSnapshot();
      } catch (error) {
        snapshotResult = { snapshot: { title: '', url: '', visibleText: [] }, error: error.message };
      }

      if (this.isLocalAgentStepSatisfied(currentStep, snapshotResult)) {
        const captured = await this.takeScreenshot(`local_agent_step_${currentStepIndex + 1}`).catch(() => null);
        stepResults.push({
          stepIndex: currentStepIndex + 1,
          description: currentStep,
          action: '页面状态已满足当前步骤',
          status: 'passed',
          screenshotPath: captured?.filepath || null,
          durationMs: 0,
        });
        onLog?.({ type: 'success', text: `步骤 ${currentStepIndex + 1} 通过：页面状态已满足当前步骤` });
        currentStepIndex++;
        if (currentStepIndex >= steps.length) {
          return {
            success: true,
            steps: this.normalizeLocalAgentSteps(steps, stepResults),
            scriptActions: [...this.recordedActions],
          };
        }
        continue;
      }

      const decision = await this.planLocalAgentAction({
        testCase,
        knowledge,
        currentStepIndex,
        currentStep,
        snapshotResult,
        actionHistory,
        lastObservation,
      });

      if (decision.thought) {
        onLog?.({ type: 'thinking', text: decision.thought });
      }

      if (decision.status === 'fail') {
        const captured = await this.takeScreenshot(`local_agent_fail_${currentStepIndex + 1}`).catch(() => null);
        stepResults.push({
          stepIndex: currentStepIndex + 1,
          description: currentStep || testCase.title,
          status: 'failed',
          screenshotPath: captured?.filepath || null,
          errorMessage: decision.reason || '智能 Agent 判定失败',
          durationMs: 0,
        });
        return { success: false, error: decision.reason || '智能 Agent 判定失败', steps: stepResults, scriptActions: [...this.recordedActions] };
      }

      if (decision.status === 'step_passed' || decision.status === 'complete') {
        const captured = await this.takeScreenshot(`local_agent_step_${currentStepIndex + 1}`).catch(() => null);
        stepResults.push({
          stepIndex: currentStepIndex + 1,
          description: currentStep || '完成验证',
          action: decision.reason || '',
          status: 'passed',
          screenshotPath: captured?.filepath || null,
          durationMs: 0,
        });
        onLog?.({ type: 'success', text: `步骤 ${currentStepIndex + 1} 通过：${decision.reason || currentStep}` });
        currentStepIndex++;
        if (decision.status === 'complete' || currentStepIndex >= steps.length) {
          return {
            success: true,
            steps: this.normalizeLocalAgentSteps(steps, stepResults),
            scriptActions: [...this.recordedActions],
          };
        }
        continue;
      }

      const action = this.normalizeLocalAgentAction(decision);
      if (!action.action) {
        lastObservation = '模型没有返回可执行动作';
        onLog?.({ type: 'stderr', text: lastObservation });
        continue;
      }

      const startedAt = Date.now();
      try {
        onLog?.({ type: 'info', text: this.describeLocalAgentAction(action) });
        const result = await this.executeLocalAgentAction(action, knowledge, onLog);
        const historyItem = {
          turn: turn + 1,
          stepIndex: currentStepIndex + 1,
          action,
          ok: true,
          result: this.compactToolResult(result),
        };
        actionHistory.push(historyItem);
        lastObservation = `动作成功：${JSON.stringify(historyItem.result)}`;
        if (['navigate', 'click', 'fill', 'wait', 'scroll', 'switch_device'].includes(action.action)) {
          this.recordedActions.push({
            action: action.action,
            target: action.target || '',
            value: action.value || '',
          });
        }
        onLog?.({ type: 'success', text: `${this.describeLocalAgentAction(action)} 完成` });

        const afterSnapshot = await getSnapshot().catch(() => null);
        if (this.isLocalAgentStepSatisfied(currentStep, afterSnapshot, action, result)) {
          const captured = await this.takeScreenshot(`local_agent_step_${currentStepIndex + 1}`).catch(() => null);
          stepResults.push({
            stepIndex: currentStepIndex + 1,
            description: currentStep,
            action: JSON.stringify(action),
            status: 'passed',
            screenshotPath: captured?.filepath || null,
            durationMs: 0,
          });
          onLog?.({ type: 'success', text: `步骤 ${currentStepIndex + 1} 通过：${currentStep}` });
          currentStepIndex++;
          if (currentStepIndex >= steps.length) {
            return {
              success: true,
              steps: this.normalizeLocalAgentSteps(steps, stepResults),
              scriptActions: [...this.recordedActions],
            };
          }
        }
      } catch (error) {
        const historyItem = {
          turn: turn + 1,
          stepIndex: currentStepIndex + 1,
          action,
          ok: false,
          error: error.message,
        };
        actionHistory.push(historyItem);
        lastObservation = `动作失败：${error.message}`;
        onLog?.({ type: 'stderr', text: lastObservation });

        if (Date.now() - startedAt > 0 && actionHistory.filter(item => !item.ok && item.stepIndex === currentStepIndex + 1).length >= 3) {
          const captured = await this.takeScreenshot(`local_agent_error_${currentStepIndex + 1}`).catch(() => null);
          stepResults.push({
            stepIndex: currentStepIndex + 1,
            description: currentStep,
            action: JSON.stringify(action),
            status: 'failed',
            screenshotPath: captured?.filepath || null,
            errorMessage: error.message,
            durationMs: 0,
          });
          return {
            success: false,
            error: `步骤 ${currentStepIndex + 1} 智能探索失败：${error.message}`,
            steps: this.normalizeLocalAgentSteps(steps, stepResults),
            scriptActions: [...this.recordedActions],
          };
        }
      }
    }

    const captured = await this.takeScreenshot('local_agent_timeout').catch(() => null);
    stepResults.push({
      stepIndex: currentStepIndex + 1,
      description: steps[currentStepIndex] || testCase.title,
      status: 'failed',
      screenshotPath: captured?.filepath || null,
      errorMessage: '智能 Agent 达到最大探索轮次仍未完成',
      durationMs: 0,
    });
    return {
      success: false,
      error: '智能 Agent 达到最大探索轮次仍未完成',
      steps: this.normalizeLocalAgentSteps(steps, stepResults),
      scriptActions: [...this.recordedActions],
    };
  }

  async planLocalAgentAction(context) {
    const { testCase, knowledge, currentStepIndex, currentStep, snapshotResult, actionHistory, lastObservation } = context;
    const snapshot = snapshotResult.snapshot || {};
    const visibleText = (snapshot.visibleText || []).slice(0, 80).join('\n');
    const buttons = (snapshot.buttons || []).slice(0, 40).map(item => item.text).join('、');
    const links = (snapshot.links || []).slice(0, 40).map(item => item.text).join('、');
    const inputs = (snapshot.inputs || []).slice(0, 30).map(item => `${item.placeholder || ''}/${item.type || ''}`).join('、');
    const systemPrompt = `你是 Prism 的自动化测试智能体。你不能直接操作浏览器，只能输出一个 JSON 动作，由本地浏览器工具执行。

只输出 JSON，不要 Markdown，不要解释。

JSON 格式：
{
  "thought": "一句话说明你的判断",
  "status": "action|step_passed|complete|fail",
  "action": "switch_device|navigate|click|fill|get_snapshot|screenshot|wait|scroll|assert_text",
  "target": "目标元素、URL、方向或断言文本",
  "value": "输入值，可为空",
  "reason": "为什么这么做"
}

规则：
1. 你要像测试工程师一样根据当前页面自主探索，不要机械照抄步骤。
2. 当前步骤没完成时 status=action，并给出一个浏览器动作。
3. 当前步骤已经从页面状态证明完成时 status=step_passed。
4. 所有步骤完成时 status=complete。
5. 明确无法继续时 status=fail。
6. 打开 Web 测试入口要使用提供的 preferredUrl，不能编造 URL。
7. 如果页面已经打开且符合当前步骤，不要重复打开；继续下一步或判定 step_passed。`;
    const userPrompt = `【测试用例】
标题：${testCase.title}
步骤：
${(testCase.steps || []).map((step, index) => `${index + 1}. ${step}`).join('\n')}
预期：${testCase.expected || '操作成功完成'}

【当前进度】
当前步骤序号：${currentStepIndex + 1}
当前步骤：${currentStep || '无'}
首选入口：${knowledge.preferredUrl || '(未配置)'}
账号信息：${(knowledge.accounts || []).join('\n') || '(无)'}

【当前页面快照】
URL：${snapshot.url || ''}
标题：${snapshot.title || ''}
按钮：${buttons || '(无)'}
链接：${links || '(无)'}
输入框：${inputs || '(无)'}
可见文本：
${visibleText || '(无)'}

【最近动作】
${actionHistory.slice(-8).map(item => `${item.turn}. 步骤${item.stepIndex} ${item.action.action} ${item.action.target || ''} ${item.action.value || ''} => ${item.ok ? '成功' : `失败:${item.error}`}`).join('\n') || '(无)'}

【上一轮观察】
${lastObservation || '(无)'}

请输出下一步 JSON。`;

    const raw = await callLLM(systemPrompt, userPrompt);
    return this.parseLocalAgentDecision(raw);
  }

  parseLocalAgentDecision(raw = '') {
    const text = String(raw || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const source = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
    try {
      return JSON.parse(jsonrepair(source));
    } catch (error) {
      return {
        thought: '模型返回的动作 JSON 无法解析',
        status: 'fail',
        reason: `动作 JSON 解析失败：${error.message}；原文：${text.slice(0, 300)}`,
      };
    }
  }

  normalizeLocalAgentAction(decision = {}) {
    const action = String(decision.action || '').trim();
    const aliases = {
      open: 'navigate',
      goto: 'navigate',
      type: 'fill',
      input: 'fill',
      tap: 'click',
      press: 'click',
      assert: 'assert_text',
    };
    return {
      action: aliases[action] || action,
      target: String(decision.target || '').trim(),
      value: String(decision.value || '').trim(),
      reason: decision.reason || '',
    };
  }

  async executeLocalAgentAction(action, knowledge, onLog) {
    switch (action.action) {
      case 'switch_device':
        return await switchDevice(action.target || action.value || 'web');
      case 'navigate': {
        const target = action.target || knowledge.preferredUrl || knowledge.urls?.[0] || '';
        if (!target) throw new Error('navigate 缺少 URL，且当前项目未配置入口');
        return await navigate(target);
      }
      case 'click':
        if (!action.target) throw new Error('click 缺少目标元素');
        return await click(action.target);
      case 'fill':
        if (!action.target || !action.value) throw new Error('fill 缺少目标或输入值');
        return await fill(action.target, action.value);
      case 'get_snapshot':
        return await getSnapshot();
      case 'screenshot':
        return await screenshot(action.target || 'local_agent');
      case 'wait': {
        const amount = Number(action.value || action.target || 1);
        const ms = Number.isFinite(amount) ? Math.min(Math.max(amount * 1000, 300), 10000) : 1000;
        await new Promise(resolve => setTimeout(resolve, ms));
        return { success: true, action: 'wait', ms };
      }
      case 'scroll':
        return await scroll(action.target || 'down', Number(action.value) || 500);
      case 'assert_text': {
        const target = action.target || action.value;
        if (!target) throw new Error('assert_text 缺少断言文本');
        const snapshotResult = await getSnapshot();
        const pageText = this.snapshotToText(snapshotResult);
        if (!pageText.includes(target)) {
          throw new Error(`页面未匹配断言文本：${target}`);
        }
        return { success: true, action: 'assert_text', target };
      }
      default:
        throw new Error(`未知智能动作：${action.action || '(空)'}`);
    }
  }

  describeLocalAgentAction(action = {}) {
    const labels = {
      switch_device: '切换设备',
      navigate: '打开页面',
      click: '点击',
      fill: '输入',
      get_snapshot: '读取页面',
      screenshot: '截图',
      wait: '等待',
      scroll: '滚动',
      assert_text: '验证文本',
    };
    const value = action.value ? `：${action.value}` : '';
    return `${labels[action.action] || action.action} ${action.target || ''}${value}`.trim();
  }

  compactToolResult(result = {}) {
    if (!result || typeof result !== 'object') return result;
    const snapshot = result.snapshot;
    if (snapshot) {
      return {
        action: result.action,
        url: snapshot.url,
        title: snapshot.title,
        buttons: (snapshot.buttons || []).slice(0, 12).map(item => item.text),
        inputs: (snapshot.inputs || []).slice(0, 8).map(item => item.placeholder || item.type),
        text: (snapshot.visibleText || []).slice(0, 12),
      };
    }
    return {
      action: result.action,
      url: result.url,
      title: result.title,
      device: result.device,
      target: result.target,
      value: result.value,
    };
  }

  isLocalAgentStepSatisfied(stepText = '', snapshotResult = null, action = null, actionResult = null) {
    const text = String(stepText || '').trim();
    if (!text) return false;
    const snapshot = snapshotResult?.snapshot || {};
    const pageText = this.snapshotToText(snapshotResult || {});
    const url = snapshot.url || actionResult?.url || '';

    const urlMatch = text.match(/https?:\/\/[^\s，。、；]+/);
    if (urlMatch && /^(打开|访问|进入|去|goto|navigate)/i.test(text)) {
      const expectedHost = this.getUrlHost(urlMatch[0]);
      const currentHost = this.getUrlHost(url);
      return Boolean(expectedHost && currentHost && expectedHost === currentHost);
    }

    if (/^(验证|检查|确认|assert|verify)/i.test(text) || action?.action === 'assert_text') {
      const targets = action?.target
        ? [action.target]
        : this.extractAssertionTargets(text);
      if (targets.length === 0) return false;
      return targets.every(target => pageText.includes(target));
    }

    if (action?.action === 'fill') {
      return true;
    }

    if (action?.action === 'click' && /(点击|选择|按下|点选)/.test(text)) {
      return true;
    }

    return false;
  }

  normalizeLocalAgentSteps(steps, stepResults) {
    const byIndex = new Map(stepResults.map(step => [step.stepIndex, step]));
    return steps.map((description, index) => byIndex.get(index + 1) || {
      stepIndex: index + 1,
      description,
      status: index < stepResults.length ? 'passed' : 'pending',
      durationMs: 0,
    });
  }

  async executeStepsDirectly(testCase, knowledge, onLog) {
    const stepResults = [];
    const scriptActions = [];
    const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
    if (steps.length === 0) {
      return { success: false, error: '用例没有可执行步骤', steps: [] };
    }

    const preferredUrl = knowledge.preferredUrl || knowledge.urls?.[0] || '';
    onLog?.({ type: 'system', text: '开始按用例步骤直接执行...' });

    for (let index = 0; index < steps.length; index++) {
      this.ensureNotStopped();
      const description = steps[index];
      const startedAt = Date.now();
      try {
        onLog?.({ type: 'thinking', text: `步骤 ${index + 1}: ${description}` });
        const action = await this.executeDirectStep(description, preferredUrl, onLog);
        if (action) scriptActions.push(action);
        const captured = await this.takeScreenshot(`direct_step_${index + 1}`).catch(() => null);
        stepResults.push({
          stepIndex: index + 1,
          description,
          action: action ? JSON.stringify(action) : '',
          status: 'passed',
          screenshotPath: captured?.filepath || null,
          durationMs: Date.now() - startedAt,
        });
        onLog?.({ type: 'success', text: `步骤 ${index + 1} 完成` });
      } catch (error) {
        if (this.stopped || error.code === 'EXECUTION_STOPPED') {
          return {
            success: false,
            stopped: true,
            error: '用户已停止执行',
            steps: stepResults,
          };
        }
        const captured = await this.takeScreenshot(`direct_error_${index + 1}`).catch(() => null);
        stepResults.push({
          stepIndex: index + 1,
          description,
          status: 'failed',
          screenshotPath: captured?.filepath || null,
          errorMessage: error.message,
          durationMs: Date.now() - startedAt,
        });
        return {
          success: false,
          error: `步骤 ${index + 1} 失败：${error.message}`,
          steps: stepResults,
          scriptActions,
        };
      }
    }

    return { success: true, steps: stepResults, scriptActions };
  }

  async executeDirectStep(stepText, preferredUrl, onLog) {
    const text = String(stepText || '').trim();
    const cleanTarget = (value = '') => String(value)
      .replace(/^(进入|打开|点击|选择|按下)\s*/, '')
      .replace(/(按钮|菜单|页面|入口)$/g, '')
      .trim();

    if (/\[(手机|移动端|小程序|H5|App)\]|手机端|移动端|小程序|Android|安卓|\bApp\b|\bH5\b/i.test(text)) {
      await switchDevice('mobile');
      return { action: 'switch_device', target: 'mobile', value: '' };
    }
    if (/\[(Web|后台)\]|Web|后台/i.test(text)) {
      await switchDevice('web');
    }

    const urlMatch = text.match(/https?:\/\/[^\s，。、；]+/);
    if (urlMatch) {
      await navigate(urlMatch[0]);
      return { action: 'navigate', target: urlMatch[0], value: '' };
    }

    if (/打开.*(Web\s*测试入口|测试入口|后台|系统入口|入口)/i.test(text)) {
      if (!preferredUrl) throw new Error('未配置该项目的 Web 测试入口，请先在执行配置里配置项目入口');
      await switchDevice('web');
      await navigate(preferredUrl);
      return { action: 'navigate', target: preferredUrl, value: '' };
    }

    const webDirectoryMatch = text.match(/在\s*Web\s*目录(?:中)?找到并进入\s*(.+)$/i);
    if (webDirectoryMatch) {
      const target = cleanTarget(webDirectoryMatch[1]);
      await click(target);
      return { action: 'click', target, value: '' };
    }

    const nestedEntryMatch = text.match(/在\s*(.+?)\s*中找到并进入\s*(.+)$/);
    if (nestedEntryMatch) {
      const target = cleanTarget(nestedEntryMatch[2]);
      await click(target);
      return { action: 'click', target, value: '' };
    }

    const inputMatch = text.match(/^在\s*(.+?)(?:输入框|框|栏|字段)?(?:中)?(?:输入|填写|填入)\s*(.+)$/);
    if (inputMatch) {
      const target = cleanTarget(inputMatch[1]);
      const value = inputMatch[2].trim().replace(/^[""'']+|[""'']+$/g, '');
      await fill(target, value);
      return { action: 'fill', target, value };
    }

    const clickMatch = text.match(/^(点击|选择|按下|点选)\s*(.+)$/);
    if (clickMatch) {
      const target = cleanTarget(clickMatch[2]);
      await click(target);
      return { action: 'click', target, value: '' };
    }

    const waitMatch = text.match(/^(等待|wait|停留)\s*(\d+)?\s*(秒|s|ms)?/i);
    if (waitMatch) {
      const amount = Number(waitMatch[2] || 1);
      const ms = /ms/i.test(waitMatch[3] || '') ? amount : amount * 1000;
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(ms, 300), 10000)));
      return { action: 'wait', target: String(ms), value: '' };
    }

    if (/^(验证|检查|确认)/.test(text)) {
      const snapshotResult = await getSnapshot();
      const snapshot = snapshotResult.snapshot || {};
      const pageText = [
        ...(snapshot.visibleText || []),
        ...(snapshot.headings || []).map(item => item.text),
        ...(snapshot.buttons || []).map(item => item.text),
        ...(snapshot.links || []).map(item => item.text),
      ].filter(Boolean).join('\n');
      const keyValues = this.extractAssertionTargets(text);
      const missing = keyValues.filter(value => !pageText.includes(value));
      if (missing.length > 0) {
        throw new Error(`页面未匹配验证内容：${missing.join('、')}`);
      }
      onLog?.({ type: 'info', text: '验证步骤已读取页面快照' });
      return { action: 'assert_text', target: keyValues.join('、') || text, value: '' };
    }

    const target = cleanTarget(text);
    await click(target);
    return { action: 'click', target, value: '' };
  }

  extractAssertionTargets(text = '') {
    const targets = [];
    const source = String(text || '').trim();
    const add = value => {
      const normalized = String(value || '')
        .replace(/^(显示|展示|提示|看到|存在|包含|仅显示|客户名称为|名称为|状态为|结果为|值为)/, '')
        .replace(/^(为|是)\s*/, '')
        .replace(/\s*(的数据|的记录|的结果|的数据行|的列表|数据|记录|结果)$/g, '')
        .trim();
      if (!normalized) return;
      if (/^(客户名称为|名称为|状态为|结果为|值为|客户列表|列表|页面)$/.test(normalized)) return;
      targets.push(normalized);
    };

    const cleanedAssertion = source
      .replace(/^(验证|检查|确认|assert|verify)\s*/i, '')
      .replace(/^(页面|界面|弹窗|提示)?\s*(显示|展示|出现|包含|存在|看到)\s*/i, '')
      .trim();
    if (
      cleanedAssertion &&
      cleanedAssertion !== source &&
      cleanedAssertion.length <= 80 &&
      !/[，。；;]/.test(cleanedAssertion)
    ) {
      add(cleanedAssertion);
    }

    for (const match of source.matchAll(/["'“”‘’]([^"'“”‘’]{2,})["'“”‘’]/g)) {
      add(match[1]);
    }

    for (const match of source.matchAll(/(?:为|是)\s*([^\s，。、；"'“”‘’]+)\s*(?:的(?:数据|记录|结果|数据行|列表)?|$|[，。、；"'“”‘’])/g)) {
      const before = source.slice(Math.max(0, match.index - 2), match.index);
      if (/不能$/.test(before)) continue;
      add(match[1]);
    }

    for (const match of source.matchAll(/(?:页面)?(?:显示|展示|提示|看到|包含|存在)\s*([^\s，。、；]+)(?=$|[，。、；])/g)) {
      const value = match[1];
      if (value.includes('为')) continue;
      add(value);
    }

    return [...new Set(targets)];
  }

  // 构建 PI Agent 的执行 prompt
  buildPrompt(testCase, knowledge) {
    const hierarchy = this.getExecutionHierarchy(testCase);
    const productName = hierarchy.productName;
    const moduleName = hierarchy.moduleName;
    let prompt = `你是一个资深测试工程师，现在要执行以下测试任务。

请像真人一样工作：先分析任务，再规划步骤，然后逐步执行，边做边说。

【强制要求】
1. 必须使用 browser 工具执行，不允许只输出文字。
2. 【测试步骤】是最高优先级执行契约，必须按顺序逐条执行；不能跳步、不能自己换模块。
3. 每个打开/进入/点击/输入/等待/验证步骤都要对应 browser 工具调用。
4. 如果【一级产品】或【二级模块】与测试步骤冲突，以测试步骤为准。
5. 找不到入口 URL 时，必须先使用【优先执行知识】或【可用 URL】；仍然找不到才失败，不能假装已执行。
6. 历史用例、需求分析总结只能作为设计参考，不能当作真实 URL、账号或登录前置。
7. Web 用例执行前必须先截图或获取页面快照判断登录态；未登录时只能使用【优先执行知识】中的账号信息登录；没有账号配置时必须说明“未配置该项目登录账号”，不能套用其他项目账号。

【测试任务】
${testCase.title}

【一级产品】
${productName || '未指定'}

【二级模块】
${moduleName || '未指定'}

【测试步骤】
${testCase.steps?.map((s, i) => `${i + 1}. ${s}`).join('\n') || '无具体步骤'}

【预期结果】
${testCase.expected || '操作成功完成'}

`;

    if (knowledge.executionRaw) {
      prompt += `【优先执行知识：入口、URL、账号、登录】
这些知识是当前项目的执行配置，优先级高于历史用例。遇到“打开 Web 测试入口 / 打开后台 / 登录后台”时，只能使用这里的入口映射、URL 和账号。
${knowledge.executionRaw}

`;
    }

    if (knowledge.preferredUrl) {
      prompt += `【首选测试入口 URL】
${knowledge.preferredUrl}

`;
    }

    // 添加大脑知识
    if (knowledge.raw) {
      prompt += `【大脑知识】
${knowledge.raw}

`;
    }

    if (knowledge.urls.length > 0) {
      prompt += `【可用 URL】
${knowledge.urls.join('\n')}

`;
    }

    if (knowledge.accounts.length > 0) {
      prompt += `【账号信息】
${knowledge.accounts.join('\n')}

`;
    }

    if (knowledge.tips.length > 0) {
      prompt += `【操作提示】
${knowledge.tips.join('\n')}

`;
    }

    prompt += `【模块定位规则】

${productName
  ? `1. 打开测试入口后，先检查页面中的 Web 目录、侧边栏或主导航，找到并进入「${productName}」
2. 进入「${productName}」后，再在它的内部找到并进入「${moduleName || '当前模块'}」
3. 「${moduleName || '当前模块'}」是二级模块，不得把它当成一级产品，也不得在进入「${productName}」之前全局查找它
4. 如果测试步骤明确写了其他路径，必须以步骤路径为准；这些模块信息只作辅助
5. 如果暂时没看到「${productName}」，应继续检查目录展开项、导航分组或搜索入口；不能直接假设当前页面就是该产品`
  : '未提供一级产品名称时，按测试步骤和页面导航判断入口。'}

【执行要求】

1. 识别步骤中的端类型标记和语义：[Web]、[后台] 表示 Web 端；[手机]、[移动端]、[小程序]、[H5]、Android、App 或“打开管理小程序”等明显移动端描述均表示 Android 真机
2. 第一次操作前根据首个步骤调用 browser.switch_device；没有标记但出现小程序/手机/App/H5 时使用手机端，完全没有移动端语义时默认使用 Web 端
3. 用例执行到另一端标记或明显端类型变化时，先调用 browser.switch_device 再继续；Web 与手机会话同时保留，禁止关闭另一端
4. 每次切换设备后先获取当前页面快照并判断登录态
5. 当前页面已经属于目标系统且已登录时，忽略步骤中重复的“打开测试入口”和“登录”，直接从当前模块继续
6. 同一批用例的 Web 端和手机端各自复用浏览器会话；登录成功后不得重复登录
7. 只有空白页、错误站点或明确停留在登录页时才能重新打开网址
8. 普通点击或元素定位失败时，只能在当前设备页面重新获取快照并更换定位方式，禁止重新打开网址或重新登录
9. 如果没有项目入口配置，必须停止并报告“未配置该项目的 Web 测试入口”，禁止回退到其他项目地址
10. 先用1-2句话说明这个用例要测什么，关键验证点是什么
11. 规划具体的操作步骤（用什么URL、在哪个端、点什么按钮、填什么内容）
12. 逐步执行，每一步都要说明：
   - 你在做什么
   - 你看到了什么
   - 为什么要这样做
13. 如果遇到问题，说明你的判断和尝试
14. 最后确认测试结果

【示例】
「这个用例是测加入购物车功能。关键是要验证选完规格、填完数量后，能成功加购。

我先打开商品详情页... 页面加载完了，我看到有颜色和尺码的选项，还有数量输入框。

先选个颜色... 选好了。再选尺码... 也选好了。数量默认是1，不用改。

现在点加入购物车... 点完了，页面提示“已加入购物车”，右上角购物车数量也变了。测试通过。」

好，请开始执行。`; 

    return prompt;
  }

  getExecutionHierarchy(testCase = {}) {
    const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
    const stepText = steps.join('\n');
    const webDirectoryMatch = stepText.match(/在\s*Web\s*目录(?:中)?找到并进入\s*([^\n，。；]+)/i);
    const nestedEntryMatch = [...stepText.matchAll(/在\s*([^\n，。；]+?)\s*中找到并进入\s*([^\n，。；]+)/g)]
      .find(match => !/Web\s*目录/i.test(match[1]));
    const clean = value => String(value || '')
      .replace(/(页面|模块|菜单|入口)$/g, '')
      .trim();
    const isGeneric = value => /^(需求简述|测试用例|未命名需求|需求分析报告)$/i.test(String(value || '').trim())
      || /需求|文档|报告/.test(String(value || ''));

    const explicitProduct = clean(webDirectoryMatch?.[1] || nestedEntryMatch?.[1] || '');
    const explicitModule = clean(nestedEntryMatch?.[2] || '');
    const rawProduct = clean(testCase.productName || '');
    const rawModule = clean(testCase.moduleName || testCase.category || '');

    return {
      productName: explicitProduct || (isGeneric(rawProduct) ? '' : rawProduct),
      moduleName: explicitModule || rawModule,
    };
  }

  // 截图
  async takeScreenshot(label = 'screenshot') {
    this.screenshotIndex++;
    try {
      const { screenshot } = require('../pi/tools/browser');
      const captured = await screenshot(label);
      if (this.reportId && this.reportDir && captured?.filepath) {
        const filename = `step_${this.screenshotIndex}_${Date.now()}.png`;
        const filepath = path.join(this.reportDir, filename);
        fs.copyFileSync(captured.filepath, filepath);
        return { filename, filepath };
      }
      return captured;
    } catch (e) {
      console.error('截图失败:', e);
      return null;
    }
  }

  async captureFrame() {
    const { captureFrame } = require('../pi/tools/browser');
    return await captureFrame();
  }

  async startNativeVideo(options = {}) {
    // PI 智能模式需要保持浏览器会话稳定；原生 Playwright 视频会重建 context，
    // 在智能执行中会表现为浏览器闪退。这里交给 VideoRecorder 帧录制兜底。
    return null;
  }

  async stopNativeVideo(options = {}) {
    return null;
  }

  // 关闭
  async close() {
    if (this.agent) {
      await this.agent.dispose();
      this.agent = null;
    }
    const { closeBrowser } = require('../pi/tools/browser');
    await closeBrowser();
  }
}

module.exports = { PIEngineRunner };
