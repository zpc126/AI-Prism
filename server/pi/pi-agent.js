// input: PI SDK、模型配置、可选系统提示词与自定义工具
// output: 可复用 PI Agent 会话，支持规划、工具使用与专项测试模式
// position: PI Agent 服务，连接 Prism 执行器、探索测试和 PI

let createAgentSession, SessionManager, AuthStorage, ModelRegistry, DefaultResourceLoader;
const { browserTool } = require('./tools/browser');
const { databaseTool } = require('./tools/database');
const { apiTool } = require('./tools/api');
const { getLLMConfig } = require('../config');
const path = require('path');
const fs = require('fs');

// 动态导入 ESM 模块
async function loadPIModules() {
  if (!createAgentSession) {
    const piModule = await import('@earendil-works/pi-coding-agent');
    createAgentSession = piModule.createAgentSession;
    SessionManager = piModule.SessionManager;
    AuthStorage = piModule.AuthStorage;
    ModelRegistry = piModule.ModelRegistry;
    DefaultResourceLoader = piModule.DefaultResourceLoader;
  }
}

// 加载 QA Skill
function loadQASkill() {
  const skillPath = path.join(__dirname, 'qa-skill.md');
  if (fs.existsSync(skillPath)) {
    const content = fs.readFileSync(skillPath, 'utf-8');
    return {
      name: 'qa-testing',
      description: 'QA 测试专家 Skill',
      content,
      source: 'custom',
    };
  }
  return null;
}

function stripKnownEndpointSuffix(url, suffixes) {
  const value = String(url || '').trim().replace(/\/+$/, '');
  for (const suffix of suffixes) {
    const pattern = new RegExp(`${suffix.replace(/\//g, '\\/')}$`, 'i');
    if (pattern.test(value)) {
      return value.replace(pattern, '').replace(/\/+$/, '');
    }
  }
  return value;
}

function normalizePiOpenAIBaseUrl(config) {
  const source = String(config.requestUrl || config.baseUrl || '').trim();
  return stripKnownEndpointSuffix(source, ['/chat/completions']);
}

function normalizePiAnthropicBaseUrl(config) {
  const source = String(config.requestUrl || config.baseUrl || 'https://api.anthropic.com').trim();
  return stripKnownEndpointSuffix(source, ['/v1/messages', '/messages']);
}

function normalizePiAzureBaseUrl(config) {
  return String(config.endpoint || config.baseUrl || '').trim().replace(/\/+$/, '');
}

function getConfiguredProviderApi(config) {
  if (config.provider === 'anthropic') return 'anthropic-messages';
  if (config.provider === 'azure') return 'azure-openai-responses';
  return 'openai-completions';
}

function getConfiguredProviderBaseUrl(config) {
  if (config.provider === 'anthropic') return normalizePiAnthropicBaseUrl(config);
  if (config.provider === 'azure') return normalizePiAzureBaseUrl(config);
  return normalizePiOpenAIBaseUrl(config);
}

function getConfiguredProviderHeaders(config) {
  const baseUrl = String(config.baseUrl || config.requestUrl || '').toLowerCase();
  if (baseUrl.includes('mimo') || baseUrl.includes('xiaomi')) {
    return {
      'api-key': config.apiKey
    };
  }
  return undefined;
}

class PIAgent {
  constructor(options = {}) {
    this.session = null;
    this.onEvent = options.onEvent || (() => {});
    this.cwd = options.cwd || process.cwd();
    this.systemPrompt = options.systemPrompt || '';
    this.tools = options.tools || null;
    this.customTools = options.customTools || null;
  }

  async init() {
    // 加载 PI 模块
    await loadPIModules();

    // 创建 PI Agent 会话
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.create(authStorage);
    const llmConfig = getLLMConfig();
    const model = this.registerConfiguredModel(modelRegistry, authStorage, llmConfig);

    const { session } = await createAgentSession({
      cwd: this.cwd,
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      model: model || undefined,
      tools: this.tools || ['browser', 'database', 'api'],
      customTools: this.customTools || [browserTool, databaseTool, apiTool],
      systemPrompt: this.systemPrompt || `你是一个资深测试工程师，正在执行测试任务。

## 你的工作方式

像真人测试工程师一样工作：
1. 先分析测试用例，理解要验证什么功能
2. 规划具体的操作步骤
3. 逐步执行，每一步都要说明你在做什么

## 语言风格

用第一人称，像真人在自言自语：
- 「好，这个用例是测加入购物车，我先打开商品详情页」
- 「页面加载完了，我看到有颜色和尺码选项，先选一个」
- 「数量框默认是1，不用改，直接点加入购物车」
- 「嗯？没反应，让我看看是不是按钮被遮挡了」

## 绝对禁止
- 不要说「我将执行一个命令」
- 不要说「我将读取文件内容」
- 不要说「我将进行浏览器操作」
- 不要说「接下来我会...」
- 不要说「正在执行...操作」
- 不要任何「我将xxx」的句式
- 不要盲目运行命令，要先说明为什么要这样做

## 执行流程

收到测试用例后，按这个顺序：

0. **必须调用工具执行**
   - 你必须使用 browser 工具执行测试，不允许只输出文字总结。
   - 任何“打开、进入、点击、输入、等待、验证页面”的步骤都要转成 browser 工具调用。
   - 如果缺少测试入口 URL，先从用户提供的知识、可用 URL、当前页面里判断；仍然没有时直接说明缺少入口，不能编造已执行。

1. **检查当前页面和登录态**
   - 先识别步骤中的 [Web]/[后台] 与 [手机]/[移动端]/[小程序]/[H5] 标记
   - 即使没有标签，只要步骤出现“打开管理小程序”、手机端、移动端、Android、App 或 H5，也必须判断为 Android 真机
   - 根据当前步骤先调用 browser 的 switch_device，再调用 get_snapshot
   - 没有端类型标记且没有移动端语义时才默认切换到 Web
   - 跨端用例切换设备时保留两端会话，不关闭另一端
   - 如果当前页面已经是目标系统且已登录，复用当前页面，禁止重新打开网址或再次登录
   - 看到退出登录、用户头像、用户名、业务导航或工作台内容，均视为已经登录
   - 只有当前页面是空白页、错误站点或明确显示登录页时，才允许打开测试地址或登录

2. **分析任务**（先想清楚要干嘛）
   - 「这个用例是要测xxx功能，我需要...」
   - 「关键验证点是...」

3. **规划步骤**（想好怎么做）
   - 「我先打开xxx页面，然后...」
   - 「第一步先...，第二步再...」

4. **执行操作**（边做边说）
   - 「打开商品详情页...」
   - 「页面出来了，我看到有xxx，点一下...」
   - 「填好了，提交看看...」

5. **观察结果**（看到什么说什么）
   - 「成功了，页面跳转到...」
   - 「报错了，提示xxx」
   - 「不太对，让我检查一下...」

## 发现问题时
直接说问题，分析原因：
- 「这个按钮点不了，可能是还没加载完」
- 「输入框没做校验，空着也能提交」
- 「页面白屏了，应该是JS报错了」

元素没找到或点击失败时，先重新 get_snapshot 检查当前页面，最多换一种定位方式重试两次。禁止通过重新打开网址、刷新登录页或重复登录来解决普通元素定位失败。

## 执行成功时
简短确认结果：
- 「加购成功，购物车数量变了」
- 「提交完成，跳转到订单页」

记住：你是在帮用户测试产品，像一个靠谱的同事在汇报工作一样。`,
    });

    // 订阅事件
    session.subscribe((event) => {
      this.handleEvent(event);
    });

    this.session = session;
    this.modelInfo = {
      provider: llmConfig.provider,
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl,
    };
    console.log(`[PI] Agent 初始化成功: ${llmConfig.provider}/${llmConfig.model}`);
    return this;
  }

  registerConfiguredModel(modelRegistry, authStorage, config) {
    if (!config?.apiKey) {
      throw new Error('智能模式未读取到 API Key，请先在设置中保存模型配置');
    }
    const modelId = config.deploymentName || config.model;
    if (!modelId) {
      throw new Error('智能模式未读取到模型名称，请先在设置中填写模型');
    }

    const baseUrl = getConfiguredProviderBaseUrl(config);
    if (!baseUrl) {
      throw new Error('智能模式未读取到 Base URL，请先在设置中填写接口地址');
    }

    const providerId = 'prism-configured';
    const api = getConfiguredProviderApi(config);
    const headers = getConfiguredProviderHeaders(config);
    modelRegistry.registerProvider(providerId, {
      name: `Prism ${config.provider || 'Custom'}`,
      baseUrl,
      apiKey: config.apiKey,
      api,
      ...(api === 'anthropic-messages' ? {
        compat: {
          supportsEagerToolInputStreaming: false,
        },
      } : {}),
      ...(headers ? { headers } : {}),
      authHeader: !headers && api === 'openai-completions',
      models: [{
        id: modelId,
        name: config.name || modelId,
        api,
        baseUrl,
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: Number.MAX_SAFE_INTEGER,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          ...(api === 'anthropic-messages' ? { supportsEagerToolInputStreaming: false } : {}),
        },
      }],
    });
    authStorage.setRuntimeApiKey(providerId, config.apiKey);

    const configuredModel = modelRegistry.find(providerId, modelId);
    if (!configuredModel) {
      throw new Error(`智能模式无法注册模型：${modelId}`);
    }
    return configuredModel;
  }

  handleEvent(event) {
    switch (event.type) {
      case 'message_update':
        if (event.assistantMessageEvent.type === 'text_delta') {
          this.onEvent('text', event.assistantMessageEvent.delta);
        }
        break;
      case 'tool_execution_start':
        this.onEvent('tool_start', { 
          name: event.toolName, 
          args: event.args 
        });
        break;
      case 'tool_execution_end':
        this.onEvent('tool_end', { name: event.toolName, result: event.result });
        break;
      case 'agent_end':
        this.onEvent('complete', { messages: event.messages });
        break;
    }
  }

  // 发送 prompt 给 PI Agent
  async prompt(text, options = {}) {
    if (!this.session) {
      throw new Error('PI Agent 未初始化');
    }

    await this.session.prompt(text, options);
  }

  // 分析需求
  async analyzeRequirement(requirement) {
    const prompt = `你是一个资深 QA 测试工程师。请分析以下需求，制定测试策略：

1. 识别核心功能模块
2. 确定测试优先级
3. 规划测试执行顺序
4. 识别风险点和边界场景

需求：
${requirement}

请用结构化的方式输出测试计划。`;

    await this.prompt(prompt);
  }

  // 生成测试用例
  async generateTestCases(requirement) {
    const prompt = `根据以下需求，生成可自动执行的测试用例：

需求：
${requirement}

要求：
1. 每个用例的步骤必须是浏览器可直接执行的动作
2. 按业务模块分类
3. 包含正常流程、异常场景、边界情况
4. 每个用例有明确的预期结果`;

    await this.prompt(prompt);
  }

  // 执行测试
  async executeTest(testCase) {
    const prompt = `请执行以下测试用例：

测试用例：${testCase.title}
步骤：
${testCase.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
预期结果：${testCase.expected}

请使用浏览器工具执行测试，并记录每个步骤的结果。`;

    await this.prompt(prompt);
  }

  // 分析失败原因
  async analyzeFailure(testResult) {
    const prompt = `测试执行失败，请分析原因：

测试用例：${testResult.title}
失败步骤：${testResult.failedStep}
错误信息：${testResult.error}
截图：${testResult.screenshot}

请分析失败原因，并提供修复建议。`;

    await this.prompt(prompt);
  }

  // 清理
  async dispose() {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
  }
}

module.exports = { PIAgent };
