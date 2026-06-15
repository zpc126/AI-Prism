// input: PI Agent 会话，测试用例数据，大脑知识
// output: 基于意图理解的智能测试执行
// position: 智能测试执行器，理解意图、检索知识、规划路径、自主执行

const { PIAgent } = require('../pi/pi-agent');
const { recallWithAssociations } = require('../brain/recall');
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
    this.recordedActions = [];
    this.pendingBrowserAction = null;
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
              if (
                data.name === 'browser' &&
                this.pendingBrowserAction &&
                ['navigate', 'click', 'fill', 'wait', 'scroll'].includes(this.pendingBrowserAction.action)
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
      const savedScript = this.preferredScriptId
        ? getScriptById(this.preferredScriptId)
        : getScriptForCase(testCase);
      if (savedScript?.enabled) {
        onLog({
          type: 'system',
          text: `命中脚本库：${savedScript.name}，直接回放，不调用大模型`,
        });
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

      if (!this.agent) {
        await this.init(onLog);
      }

      // ===== 阶段 1: 意图分析 + 知识检索 =====
      onLog({ type: 'thinking', text: '正在理解测试意图并检索相关知识...' });
      const knowledge = this.retrieveKnowledge(testCase);
      if (knowledge.fragments.length > 0) {
        onLog({ type: 'info', text: `从大脑找到 ${knowledge.fragments.length} 条相关知识` });
        if (knowledge.urls.length > 0) {
          onLog({ type: 'info', text: `相关 URL: ${knowledge.urls.join(', ')}` });
        }
        if (knowledge.accounts.length > 0) {
          onLog({ type: 'info', text: `找到账号信息` });
        }
      } else {
        onLog({ type: 'info', text: '大脑中暂无相关知识，Prism Agent 将自主探索' });
      }

      // ===== 阶段 2: 让 Prism Agent 自主执行 =====
      onLog({ type: 'system', text: 'Prism Agent 开始自主执行...' });
      const result = await this.executeWithPIAgent(testCase, knowledge, onLog);

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
      const action = script.steps[index];
      const startedAt = Date.now();
      const description = this.describeScriptAction(action);
      onLog({ type: 'info', text: `脚本 ${index + 1}/${script.steps.length}：${description}` });

      try {
        switch (action.action) {
          case 'navigate':
            await navigate(action.target);
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

  ensureNotStopped() {
    if (!this.stopped) return;
    const error = new Error('用户已停止执行');
    error.code = 'EXECUTION_STOPPED';
    throw error;
  }

  describeScriptAction(action) {
    const labels = {
      navigate: '打开',
      click: '点击',
      fill: '输入',
      wait: '等待',
      scroll: '滚动',
      assert_text: '验证页面文本',
    };
    const value = action.action === 'fill' && action.value ? `：${action.value}` : '';
    return `${labels[action.action] || action.action} ${action.target || ''}${value}`.trim();
  }

  // 从大脑检索知识
  retrieveKnowledge(testCase) {
    const stepText = (testCase.steps || []).join(' ');
    const explicitUrls = stepText.match(/https?:\/\/[^\s，。、；]+/g) || [];
    const targetHosts = new Set(explicitUrls.map(url => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    }).filter(Boolean));
    const query = [
      testCase.productName,
      testCase.moduleName,
      testCase.title,
      testCase.category,
      ...(testCase.steps || [])
    ].filter(Boolean).join(' ');

    const fragments = recallWithAssociations(query, { limit: 10 }).filter(fragment => {
      const content = fragment.content || '';
      const matchesHierarchy = [testCase.productName, testCase.moduleName, testCase.category]
        .filter(Boolean)
        .some(name => content.includes(name));
      const fragmentUrls = content.match(/https?:\/\/[^\s，。、；]+/g) || [];
      const matchesTargetHost = fragmentUrls.some(url => {
        try {
          return targetHosts.has(new URL(url).host);
        } catch {
          return false;
        }
      });

      // 已明确测试地址时，避免把其他系统的 URL 和账号带进当前任务。
      if (targetHosts.size > 0 && fragmentUrls.length > 0) {
        return matchesTargetHost || matchesHierarchy;
      }
      return matchesHierarchy || targetHosts.size === 0;
    });

    const urls = [];
    const accounts = [];
    const tips = [];

    fragments.forEach(f => {
      const content = f.content;
      // 提取 URL
      const urlMatch = content.match(/https?:\/\/[^\s，。、；]+/);
      if (urlMatch) urls.push(urlMatch[0]);
      // 提取账号信息
      if (/(账号|密码|登录|用户名|管理员)/i.test(content)) accounts.push(content);
      // 提取操作提示
      if (/(注意|提示|技巧|方法|步骤|先|然后|最后)/i.test(content)) tips.push(content);
    });

    return {
      fragments,
      urls: [...new Set(urls)],
      accounts,
      tips,
      raw: fragments.map(f => f.content).join('\n')
    };
  }

  // 让 PI Agent 自主执行
  async executeWithPIAgent(testCase, knowledge, onLog) {
    this.recordedActions = [];
    this.pendingBrowserAction = null;

    // 检查是否被停止
    if (this.stopped) {
      throw new Error('用户已停止执行');
    }

    // 构建给 Prism Agent 的 prompt
    const prompt = this.buildPrompt(testCase, knowledge);

    try {
      // 让 Prism Agent 自主执行整个任务
      await this.agent.prompt(prompt);

      // 刷新剩余的文本缓冲
      this.flushTextBuffer();

      // 检查是否被停止
      if (this.stopped) {
        throw new Error('用户已停止执行');
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
      let errorScreenshot = null;
      if (!this.stopped) {
        errorScreenshot = await this.takeScreenshot('error');
      }
      const failedSteps = (testCase.steps || []).map((description, index) => ({
        stepIndex: index + 1,
        description,
        status: index === testCase.steps.length - 1 ? 'failed' : 'passed',
        screenshotPath: index === testCase.steps.length - 1 ? errorScreenshot?.filepath : null,
        errorMessage: index === testCase.steps.length - 1 ? error.message : null,
        durationMs: 0,
      }));
      return { success: false, error: error.message, steps: failedSteps };
    }
  }

  // 构建 PI Agent 的执行 prompt
  buildPrompt(testCase, knowledge) {
    const productName = testCase.productName || '';
    const moduleName = testCase.moduleName || testCase.category || '';
    let prompt = `你是一个资深测试工程师，现在要执行以下测试任务。

请像真人一样工作：先分析任务，再规划步骤，然后逐步执行，边做边说。

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
4. 如果暂时没看到「${productName}」，应继续检查目录展开项、导航分组或搜索入口；不能直接假设当前页面就是该产品`
  : '未提供一级产品名称时，按测试步骤和页面导航判断入口。'}

【执行要求】

1. 第一项操作必须是获取当前页面快照并判断登录态
2. 当前页面已经属于目标系统且已登录时，忽略步骤中重复的“打开测试入口”和“登录”，直接从当前模块继续
3. 同一批用例共用浏览器会话；登录成功后不得在后续用例中重复登录
4. 只有空白页、错误站点或明确停留在登录页时才能重新打开网址
5. 普通点击或元素定位失败时，只能在当前页面重新获取快照并更换定位方式，禁止重新打开网址或重新登录
6. 先用1-2句话说明这个用例要测什么，关键验证点是什么
7. 规划具体的操作步骤（用什么URL、点什么按钮、填什么内容）
8. 逐步执行，每一步都要说明：
   - 你在做什么
   - 你看到了什么
   - 为什么要这样做
9. 如果遇到问题，说明你的判断和尝试
10. 最后确认测试结果

【示例】
「这个用例是测加入购物车功能。关键是要验证选完规格、填完数量后，能成功加购。

我先打开商品详情页... 页面加载完了，我看到有颜色和尺码的选项，还有数量输入框。

先选个颜色... 选好了。再选尺码... 也选好了。数量默认是1，不用改。

现在点加入购物车... 点完了，页面提示“已加入购物车”，右上角购物车数量也变了。测试通过。」

好，请开始执行。`; 

    return prompt;
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
