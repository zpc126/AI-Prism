// input: .env 配置、.scout 配置、OpenAI 兼容接口响应
// output: generateCases(content) 返回分类的测试用例、analyzeRequirement(content) 返回需求分析结果
// position: LLM 调用核心，支持多提供商、Base URL 规范化与流式响应校验

const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
const { getLLMConfig } = require('../config');

const DEFAULT_TEXT_MAX_OUTPUT_TOKENS = 64000;
const DEFAULT_ANALYSIS_MAX_OUTPUT_TOKENS = 64000;
const DEFAULT_VISION_MAX_OUTPUT_TOKENS = 16000;
const VISION_AUX_CONTEXT_BUDGET = 30000;

function getChatCompletionsUrl(baseUrl, requestUrl) {
  const manual = String(requestUrl || '').trim();
  if (manual) return manual;
  const normalized = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return `${url.toString().replace(/\/+$/, '')}/chat/completions`;
    }
  } catch (e) {}
  return `${normalized}/chat/completions`;
}

function getAnthropicMessagesUrl(baseUrl, requestUrl) {
  const manual = String(requestUrl || '').trim();
  if (manual) return manual;
  const normalized = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  if (/\/messages$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function getAzureChatCompletionsUrl(endpoint, deploymentName, requestUrl) {
  const manual = String(requestUrl || '').trim();
  if (manual) return manual;
  const normalized = String(endpoint || '').replace(/\/+$/, '');
  if (!normalized) throw new Error('当前 Azure 模型未配置 Endpoint');
  if (/\/chat\/completions(\?.*)?$/i.test(normalized)) return normalized;
  if (!deploymentName) throw new Error('当前 Azure 模型未配置 Deployment Name');
  return `${normalized}/openai/deployments/${encodeURIComponent(deploymentName)}/chat/completions?api-version=2024-02-15-preview`;
}

function extractAnthropicText(data) {
  return (data.content || [])
    .map(item => item?.type === 'text' ? item.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseImageDataUrl(imageBase64) {
  const value = String(imageBase64 || '').trim();
  const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
  if (match) {
    return {
      mediaType: match[1],
      data: match[2].replace(/\s/g, '')
    };
  }

  return {
    mediaType: 'image/png',
    data: value.replace(/\s/g, '')
  };
}

function normalizeVisionFiles(visionFiles = []) {
  if (!Array.isArray(visionFiles)) return [];
  return visionFiles
    .map((file, index) => ({
      imageBase64: file.imageBase64 || file.base64 || '',
      filename: String(file.filename || file.name || `图片${index + 1}`).trim(),
      sourceType: String(file.sourceType || file.visionSource || file.type || '').trim(),
      contextText: String(file.contextText || file.textFallback || file.text || '').trim()
    }))
    .filter(file => file.imageBase64);
}

function fitAuxiliaryText(text, budget) {
  const value = String(text || '');
  if (!value || budget <= 0) return '';
  if (value.length <= budget) return value;
  const head = Math.max(0, Math.floor(budget * 0.7));
  const tail = Math.max(0, budget - head);
  return `${value.slice(0, head)}\n\n【辅助文本过长，中间部分已省略；图片原文仍由模型直接读取】\n\n${value.slice(-tail)}`;
}

function buildVisionUserContent(provider, textContent, visionFiles = []) {
  const files = normalizeVisionFiles(visionFiles);
  if (!files.length) return textContent;

  const textParts = [
    textContent,
    '【视觉材料说明】以下图片/原型截图与上面的文字需求属于同一次需求输入，请把提示词、文字需求、图片内容和辅助文本一起理解；不要先 OCR 后二次总结。图片中的页面标题、模块层级、字段、按钮、表格、状态、业务文案优先级最高。'
  ];

  let remainingAuxBudget = VISION_AUX_CONTEXT_BUDGET;
  files.forEach((file, index) => {
    const meta = [
      `图片${index + 1}`,
      file.filename && `文件名：${file.filename}`,
      file.sourceType && `来源：${file.sourceType}`
    ].filter(Boolean).join(' / ');
    textParts.push(`【${meta}】`);
    const budgetForFile = files.length > 0 ? Math.floor(remainingAuxBudget / Math.max(1, files.length - index)) : 0;
    const auxiliaryText = fitAuxiliaryText(file.contextText, budgetForFile);
    remainingAuxBudget -= auxiliaryText.length;
    if (auxiliaryText) {
      textParts.push(`辅助文本（仅辅助理解，最终以图片可见内容为准）：\n${auxiliaryText}`);
    }
  });

  const text = textParts.filter(Boolean).join('\n\n');
  if (provider === 'anthropic') {
    return [
      { type: 'text', text },
      ...files.map(file => {
        const image = parseImageDataUrl(file.imageBase64);
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mediaType,
            data: image.data
          }
        };
      })
    ];
  }

  return [
    { type: 'text', text },
    ...files.map(file => ({
      type: 'image_url',
      image_url: { url: file.imageBase64 }
    }))
  ];
}

function pickApiErrorMessage(data, rawText, fallback = 'API 调用失败') {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === 'string') return data.error;
  if (data?.message) return data.message;
  return rawText || fallback;
}

function withVisionHint(message, provider, model) {
  const lower = String(message || '').toLowerCase();
  const maybeVisionIssue = /image|vision|multimodal|multi-modal|media|unsupported|not support|不支持|图片|视觉/.test(lower);
  if (!maybeVisionIssue) return message;
  return `${message}。当前模型配置为 ${provider || 'unknown'}/${model || 'unknown'}，可能不支持图片输入，或网关要求不同的图片协议。`;
}

function buildOpenAIHeaders(apiKey, baseUrl) {
  const headers = { 'Content-Type': 'application/json' };
  if (String(baseUrl || '').includes('mimo') || String(baseUrl || '').includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildAnthropicHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
}

function parseJsonOrThrow(responseText, label, requestEndpoint) {
  try {
    return responseText ? JSON.parse(responseText) : null;
  } catch (e) {
    throw new Error(`${label}返回了非 JSON 内容，请检查请求 URL（当前：${requestEndpoint}）`);
  }
}

function extractOpenAIText(data) {
  return data?.choices?.[0]?.message?.content || '';
}

function extractStreamDelta(data, protocol) {
  if (protocol === 'anthropic') {
    if (data?.type === 'content_block_delta') return data.delta?.text || '';
    if (data?.type === 'content_block_start') return data.content_block?.text || '';
    return '';
  }
  return data?.choices?.[0]?.delta?.content || '';
}

async function readJsonTextResponse(response, requestEndpoint, label, protocol, llmConfig) {
  const responseText = await response.text();
  const data = parseJsonOrThrow(responseText, label, requestEndpoint);
  if (!response.ok) {
    const message = pickApiErrorMessage(data, responseText, `${label}失败`);
    console.error(`[LLM] ${label}失败:`, response.status, message);
    throw new Error(`${label}失败(${response.status})：${message}`);
  }

  const contentText = protocol === 'anthropic'
    ? extractAnthropicText(data)
    : extractOpenAIText(data);
  if (!contentText) {
    throw new Error(`${label}未返回可解析的文本内容（当前模型：${llmConfig.provider}/${llmConfig.model}）`);
  }
  return contentText;
}

async function readStreamTextResponse(response, requestEndpoint, label, protocol, llmConfig, onToken = () => {}) {
  if (!response.ok) {
    const responseText = await response.text();
    let data = null;
    try { data = responseText ? JSON.parse(responseText) : null; } catch (e) {}
    const message = pickApiErrorMessage(data, responseText, `${label}失败`);
    console.error(`[LLM] ${label}失败:`, response.status, message);
    throw new Error(`${label}失败(${response.status})：${message}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const contentText = await readJsonTextResponse(response, requestEndpoint, label, protocol, llmConfig);
    if (contentText) onToken(contentText);
    return contentText;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let rawText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const delta = extractStreamDelta(json, protocol);
        if (!delta) continue;
        rawText += delta;
        onToken(delta);
      } catch (e) {}
    }
  }

  return rawText;
}

async function callConfiguredLLMText(systemPrompt, userContent, options = {}) {
  const llmConfig = getLLMConfig();
  if (!llmConfig.apiKey) throw new Error('未读取到 API Key，请先在设置中保存模型配置');

  const provider = llmConfig.provider || 'custom';
  const model = llmConfig.model || llmConfig.deploymentName || 'gpt-4';
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  const temperature = options.temperature ?? 0.3;
  const label = options.label || '模型调用';
  const multimodalContent = buildVisionUserContent(provider, userContent, options.visionFiles);
  let requestEndpoint;
  let protocol = 'openai';
  let headers;
  let body;

  if (provider === 'anthropic') {
    protocol = 'anthropic';
    requestEndpoint = getAnthropicMessagesUrl(llmConfig.baseUrl, llmConfig.requestUrl);
    headers = buildAnthropicHeaders(llmConfig.apiKey);
    body = {
      model,
      max_tokens: options.maxTokens || DEFAULT_TEXT_MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: multimodalContent }],
      temperature
    };
    if (options.stream) body.stream = true;
  } else if (provider === 'azure') {
    const deploymentName = llmConfig.deploymentName || llmConfig.model;
    requestEndpoint = getAzureChatCompletionsUrl(llmConfig.endpoint || llmConfig.baseUrl, deploymentName, llmConfig.requestUrl);
    headers = {
      'Content-Type': 'application/json',
      'api-key': llmConfig.apiKey
    };
    body = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: multimodalContent }
      ],
      temperature
    };
    if (options.stream) body.stream = true;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
  } else {
    const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
    requestEndpoint = getChatCompletionsUrl(baseUrl, llmConfig.requestUrl);
    headers = buildOpenAIHeaders(llmConfig.apiKey, baseUrl);
    body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: multimodalContent }
      ],
      temperature
    };
    if (options.stream) body.stream = true;
    if (options.maxTokens) body.max_tokens = options.maxTokens;
  }

  const response = await fetchFn(requestEndpoint, {
    method: 'POST',
    headers,
    signal: options.signal,
    body: JSON.stringify(body)
  });

  if (response.status === 413 && Array.isArray(options.visionFiles) && options.visionFiles.length > 0) {
    if (!options.skipVisionContextRetry) {
      console.warn(`[LLM] ${label} 请求体过大，保留图片并去掉视觉辅助文本后重试`);
      const compactVisionFiles = options.visionFiles.map(file => ({
        ...file,
        contextText: '',
        textFallback: '',
        text: ''
      }));
      return callConfiguredLLMText(systemPrompt, userContent, {
        ...options,
        visionFiles: compactVisionFiles,
        skipVisionContextRetry: true
      });
    }
    throw new Error(`${label}失败(413)：模型网关限制请求体大小。已去掉 HTML 辅助文本后仍然过大，请减少一次上传的图片数量，或提高模型网关 nginx client_max_body_size。`);
  }

  if (options.stream) {
    return readStreamTextResponse(response, requestEndpoint, label, protocol, llmConfig, options.onToken);
  }
  return readJsonTextResponse(response, requestEndpoint, label, protocol, llmConfig);
}

const SYSTEM_PROMPT = `你是 QA 测试工程师。根据需求生成可自动执行的测试用例。

【核心原则】
每条用例的 steps 必须是浏览器可直接执行的动作，不要写抽象描述。

【分类要求】
按业务模块分类，每个模块包含：正常流程、异常场景、边界情况、风险点

【输出格式】
先输出分析结果，再逐条输出用例。

1. 分析结果：用 ###ANALYSIS### 开头，后跟 JSON，包含识别到的核心模块
格式：###ANALYSIS###{"modules":["模块1","模块2","模块3"]}

2. 用例：每条用一行，用 ###CASE### 开头，后跟 JSON 对象
用例之间不要输出任何其他内容。

格式示例：
###ANALYSIS###{"modules":["用户体系","商品体系","订单与支付"]}
###CASE###{"category":"用户体系","id":"1","title":"验证邮箱注册","priority":"P0","reason":"注册是入口，得先打通","source":"需求第1点：用户注册支持手机号+验证码注册","steps":["打开注册页面","在邮箱输入框输入 test@example.com","在密码输入框输入 Test1234","点击注册按钮"],"expected":"页面跳转到首页，显示欢迎信息"}
###CASE###{"category":"用户体系","id":"2","title":"验证重复邮箱注册","priority":"P1","reason":"重复注册容易出bug","source":"需求第1点：同一手机号不可重复注册","steps":["打开注册页面","在邮箱输入框输入 已注册@example.com","在密码输入框输入 Test1234","点击注册按钮"],"expected":"显示邮箱已被注册提示"}

【steps 编写规则】
1. 单端 Web 用例第一步写「打开 Web 测试入口」；单端手机用例第一步写「打开手机测试入口」，不要写具体 URL
2. 需求同时涉及后台 Web 和手机端/小程序/H5 时，必须生成跨端用例，并给每个步骤添加端标记：
   - Web 后台步骤以「[Web]」开头
   - 手机、小程序或 H5 步骤以「[手机]」开头
   - 必须保持真实业务顺序，例如先「[Web] 创建订单」，再「[手机] 查看订单」
   - 不要把有前后数据依赖的跨端流程拆成两条互不关联的用例
3. 如果需求中提供了【一级产品名称】，必须保留真实导航层级：
   - 第二步：在 Web 目录或导航中找到并进入 [一级产品名称]
   - 第三步：在 [一级产品名称] 中找到并进入当前 category 对应的模块
   - 然后再执行当前用例的具体操作
   - category 是二级模块，禁止把它当作一级产品入口，也禁止跳过一级产品直接全局查找二级模块
4. 每步必须是具体动作，格式为：端标记（跨端时）+ 动词 + 目标 + 内容
5. 合格示例：
   - "打开 Web 测试入口"
   - "在 Web 目录中找到并进入 智能工作站"
   - "在 智能工作站 中找到并进入 工位查询"
   - "在用户名输入框输入 admin"
   - "点击登录按钮"
   - "在搜索框输入 iPhone"
   - "点击第一个商品图片"
   - "验证页面显示 退出登录"
   - "等待 2 秒"
   - "[Web] 在后台创建采购单 CG001"
   - "[手机] 打开采购小程序"
   - "[手机] 验证待处理列表显示采购单 CG001"
6. 不合格示例（禁止）：
   - "执行主要操作" （太抽象）
   - "验证结果" （没有具体内容）
   - "输入标准数据" （没有具体值）
   - "提交" （没有说点什么按钮）
   - "打开 https://example.com/login" （不要写 URL）
   - "打开工位查询页面" （已提供一级产品名称时跳过了产品目录层级）

【字段说明】
- category: 所属模块名（中文）
- id: 唯一编号
- title: 一句话说明测试目标
- priority: P0/P1/P2/P3
- reason: 你为什么加这条用例，15字以内，语气像跟同事说话（比如“边界值容易漏”“这个场景用户常遇到”）
- source: 这条用例对应需求的哪句话，简短引用（比如“需求第1点：用户注册支持手机号+验证码”）
- steps: 测试步骤数组，每步必须可自动执行
- expected: 预期结果，要具体（页面显示什么文字、跳转到哪里）

【注意】
1. 每条用例必须以 ###CASE### 开头，紧跟 JSON，无换行
2. 每个模块至少 3 条用例
3. reason 要真诚自然，不要用“核心链路”“关键场景”这类套话
4. 不要输出任何 ###CASE### 之外的文字
5. 如果用户上传了多张图片/原型截图，必须逐张覆盖：每张图片至少生成 3 条用例；字段、按钮、表格、状态较多的页面至少生成 5-8 条用例。不要把多张图概括成少量总用例。
6. 多图场景下，source 必须写明来自哪张图片或文件名，便于用户追溯。`

function normalizeCaseData(caseData = {}, index = 0) {
  const title = String(caseData.title || caseData.name || caseData.caseName || '').trim();
  if (!title) return null;
  const steps = Array.isArray(caseData.steps)
    ? caseData.steps.map(step => String(step || '').trim()).filter(Boolean)
    : String(caseData.steps || '').split(/\n|；|;/).map(step => step.trim()).filter(Boolean);
  return {
    category: String(caseData.category || caseData.module || caseData.moduleName || caseData.type || '未分类').trim() || '未分类',
    id: String(caseData.id || caseData.caseId || `AI-${Date.now()}-${index + 1}`),
    title,
    priority: caseData.priority || 'P1',
    reason: caseData.reason || caseData.source || '模型生成',
    source: caseData.source || '',
    steps: steps.length ? steps : ['打开测试入口', `验证${title}`],
    expected: String(caseData.expected || caseData.expect || caseData.result || '结果符合需求').trim()
  };
}

function groupCasesByCategory(cases = []) {
  const catMap = {};
  cases.map(normalizeCaseData).filter(Boolean).forEach(caseData => {
    const catName = caseData.category || '未分类';
    if (!catMap[catName]) catMap[catName] = { type: catName, name: catName, cases: [] };
    catMap[catName].cases.push(caseData);
  });
  return Object.values(catMap);
}

function flattenCategories(categories = []) {
  const cases = [];
  (categories || []).forEach(category => {
    (category.cases || []).forEach(caseData => {
      const normalized = normalizeCaseData({
        ...caseData,
        category: caseData.category || category.name || category.type
      }, cases.length);
      if (normalized) cases.push(normalized);
    });
  });
  return cases;
}

function sanitizeCaseId(value) {
  return String(value || '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function stampVisionCase(caseData, file, imageIndex, totalImages, usedIds) {
  const normalized = normalizeCaseData(caseData, usedIds.size);
  if (!normalized) return null;
  const sourcePrefix = `图片${imageIndex + 1}/${totalImages}${file.filename ? `：${file.filename}` : ''}`;
  if (!String(normalized.source || '').includes(sourcePrefix)) {
    normalized.source = normalized.source
      ? `${sourcePrefix}；${normalized.source}`
      : sourcePrefix;
  }
  const rawId = sanitizeCaseId(normalized.id || normalized.title || `${imageIndex + 1}-${usedIds.size + 1}`);
  const baseId = `IMG${imageIndex + 1}-${rawId || usedIds.size + 1}`;
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix++}`;
  }
  normalized.id = id;
  usedIds.add(id);
  return normalized;
}

function buildVisionFileFocusContent(content, file, imageIndex, totalImages) {
  const sourceName = file.filename || `图片${imageIndex + 1}`;
  return [
    content,
    `【当前图片处理要求】这是多图需求中的第 ${imageIndex + 1}/${totalImages} 张：${sourceName}`,
    '本次只围绕当前这张图片生成用例，必须覆盖图片中可见的页面标题、模块、字段、按钮、表格、状态、提示文案和业务规则。',
    '当前图片至少生成 3 条用例；如果页面包含多个按钮/字段/状态/列表操作，生成 5-8 条用例。',
    `每条用例的 source 必须包含：图片${imageIndex + 1}/${totalImages}${file.filename ? `：${file.filename}` : ''}`,
    '不要只输出模块分析，必须输出可落到导图的 ###CASE### 用例。'
  ].filter(Boolean).join('\n\n');
}

function buildVisionAnalysisFocusContent(content, file, imageIndex, totalImages) {
  const sourceName = file.filename || `图片${imageIndex + 1}`;
  return [
    content,
    `【当前图片分析要求】这是多图需求中的第 ${imageIndex + 1}/${totalImages} 张：${sourceName}`,
    '本次只分析当前这张图片，不要概括其它图片，不要因为还有其它图片就省略当前页面细节。',
    '必须抽取当前图片可见的页面/模块、字段、按钮、表格、状态、流程、规则、风险和待确认问题。',
    '如果图片信息丰富，modules、risks、questions、testStrategy 都要尽量具体。',
    `所有风险、问题或策略条目中如有 source/来源 字段，必须标明：图片${imageIndex + 1}/${totalImages}${file.filename ? `：${file.filename}` : ''}`
  ].filter(Boolean).join('\n\n');
}

function buildCaseReviewSummary(cases = []) {
  return cases.map((caseData, index) => ({
    index: index + 1,
    id: caseData.id,
    category: caseData.category,
    title: caseData.title,
    source: caseData.source,
    steps: caseData.steps,
    expected: caseData.expected
  }));
}

function buildAnalysisReviewSummary(categories = []) {
  const report = mergeAnalysisCategories(categories, 0)[0] || {};
  return {
    summary: report.summary,
    modules: report.modules,
    questions: report.questions,
    acceptance: report.acceptance,
    testStrategy: report.testStrategy,
    risks: (report.cases || []).map(item => ({
      category: item.category,
      title: item.title,
      priority: item.priority,
      detail: Array.isArray(item.steps) ? item.steps.join('；') : item.steps,
      expected: item.expected,
      source: item.source
    }))
  };
}

function uniqueByText(items = [], getText = item => JSON.stringify(item)) {
  const seen = new Set();
  const result = [];
  items.forEach(item => {
    const key = String(getText(item) || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function mergeAnalysisCategories(categories = [], totalImages = 0) {
  const reports = categories
    .filter(category => category && category.type === 'analysis')
    .map(category => ({
      summary: category.summary || '',
      modules: Array.isArray(category.modules) ? category.modules : [],
      testScope: category.testScope || { inScope: [], outOfScope: [] },
      questions: Array.isArray(category.questions) ? category.questions : [],
      acceptance: Array.isArray(category.acceptance) ? category.acceptance : [],
      testStrategy: Array.isArray(category.testStrategy) ? category.testStrategy : [],
      cases: Array.isArray(category.cases) ? category.cases : []
    }));

  const modules = uniqueByText(reports.flatMap(report => report.modules), item => {
    if (typeof item === 'string') return item;
    return item.name || item.module || item.title || JSON.stringify(item);
  });
  const inScope = uniqueByText(reports.flatMap(report => report.testScope?.inScope || []), item => typeof item === 'string' ? item : JSON.stringify(item));
  const outOfScope = uniqueByText(reports.flatMap(report => report.testScope?.outOfScope || []), item => typeof item === 'string' ? item : JSON.stringify(item));
  const questions = uniqueByText(reports.flatMap(report => report.questions || []), item => typeof item === 'string' ? item : item.title || item.question || JSON.stringify(item));
  const acceptance = uniqueByText(reports.flatMap(report => report.acceptance || []), item => typeof item === 'string' ? item : JSON.stringify(item));
  const testStrategy = uniqueByText(reports.flatMap(report => report.testStrategy || []), item => typeof item === 'string' ? item : JSON.stringify(item));
  const cases = uniqueByText(reports.flatMap(report => report.cases || []), item => `${item.category || ''}:${item.title || ''}:${item.steps?.[0] || ''}`)
    .map((caseData, index) => ({
      ...caseData,
      id: caseData.id || `analysis-${index + 1}`
    }));

  return [{
    type: 'analysis',
    name: '需求分析',
    summary: totalImages > 1
      ? `已按 ${totalImages} 张图片逐张完成需求分析，合并整理为模块、风险、待确认问题和测试策略。`
      : reports[0]?.summary || '已完成需求分析。',
    modules,
    testScope: { inScope, outOfScope },
    questions,
    acceptance,
    testStrategy,
    cases
  }];
}

function normalizeCategoryResult(result) {
  if (!result) return [];
  const categories = Array.isArray(result.categories) ? result.categories : result;
  if (!Array.isArray(categories)) return [];

  const looksLikeCaseArray = categories.some(item => item && (item.title || item.caseName) && (item.steps || item.expected || item.expect));
  if (looksLikeCaseArray) {
    return groupCasesByCategory(categories);
  }

  return categories.map((category, index) => {
    const name = category.name || category.type || category.category || category.module || `模块${index + 1}`;
    const cases = Array.isArray(category.cases)
      ? category.cases.map((caseData, caseIndex) => normalizeCaseData({ ...caseData, category: caseData.category || name }, caseIndex)).filter(Boolean)
      : [];
    return { type: name, name, cases };
  }).filter(category => category.cases.length > 0);
}

function parseCategoriesFromModelText(text) {
  const markedCases = parseMarkedJsonObjects(text, '###CASE###');
  const markedCategories = groupCasesByCategory(markedCases);
  if (markedCategories.length) return markedCategories;

  let cleaned = String(text || '').trim()
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '');

  const tryParse = (candidate) => {
    if (!candidate) return [];
    try {
      return normalizeCategoryResult(JSON.parse(candidate));
    } catch (e) {
      try {
        return normalizeCategoryResult(JSON.parse(jsonrepair(candidate)));
      } catch (repairError) {
        return [];
      }
    }
  };

  let categories = tryParse(cleaned);
  if (categories.length) return categories;

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  categories = tryParse(jsonMatch?.[0]);
  if (categories.length) return categories;

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  categories = tryParse(arrayMatch?.[0]);
  if (categories.length) return categories;

  const looseCases = [];
  for (const objectText of cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || []) {
    try {
      const parsed = JSON.parse(jsonrepair(objectText));
      if (parsed && (parsed.title || parsed.caseName) && (parsed.steps || parsed.expected || parsed.expect)) {
        looseCases.push(parsed);
      }
    } catch (e) {}
  }
  return groupCasesByCategory(looseCases);
}

// 解析 JSON/标记协议响应
function parseJsonResponse(text) {
  const categories = parseCategoriesFromModelText(text);
  if (categories.length) return categories;
  console.log('无法解析 LLM 返回，使用示例数据');
  return generateMockCategories('');
}

async function generateGlobalFlowCases(content, allCases, totalImages, options = {}) {
  if (!allCases.length || options.disableGlobalReview) return [];
  const summary = buildCaseReviewSummary(allCases);
  const prompt = `${buildSystemPrompt()}

【全局复盘任务】
你已经看到 ${totalImages} 张图片逐张生成出来的页面级用例。现在不要重复已有页面用例，只补充跨页面、跨模块、跨端、状态流转、数据一致性、权限与回归影响用例。

必须关注：
1. 多张图片之间是否构成完整业务流程
2. Web 后台与手机/小程序/H5 是否有前后依赖
3. 创建、审核、状态变更、查询、售后、质检、退款等链路是否需要串起来
4. 页面级用例覆盖不到的端到端场景
5. 不要重复已有 title 或只换说法

输出仍然只使用 ###CASE###，每条一行。source 写“全局流程复盘”。`;

  const userContent = [
    `原始需求：\n${content}`,
    `已生成用例摘要：\n${JSON.stringify(summary, null, 2)}`
  ].join('\n\n');

  const contentText = await callConfiguredLLMText(prompt, userContent, {
    label: '全局流程补充用例模型调用',
    temperature: 0.2
  });
  const categories = parseCategoriesFromModelText(contentText);
  return flattenCategories(categories);
}

// 读取 .scout 配置
function loadScoutConfig() {
  try {
    const configPath = path.join(process.cwd(), '.scout');
    if (fs.existsSync(configPath)) {
      return fs.readFileSync(configPath, 'utf-8');
    }
  } catch (err) {}
  return null;
}

function buildSystemPrompt() {
  let prompt = SYSTEM_PROMPT;
  const scoutConfig = loadScoutConfig();
  if (scoutConfig) {
    prompt += `\n\n用户配置：\n${scoutConfig}`;
  }
  return prompt;
}

function parseMarkedJsonObjects(text, marker) {
  const objects = [];
  let searchIndex = 0;
  while (searchIndex < text.length) {
    const markerIndex = text.indexOf(marker, searchIndex);
    if (markerIndex === -1) break;

    let index = markerIndex + marker.length;
    while (index < text.length && /\s/.test(text[index])) index++;
    if (text[index] !== '{') {
      searchIndex = index + 1;
      continue;
    }

    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < text.length; index++) {
      const ch = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      }
    }

    if (depth === 0) {
      const rawObject = text.slice(start, index);
      try {
        objects.push(JSON.parse(rawObject));
      } catch (e) {
        try {
          objects.push(JSON.parse(jsonrepair(rawObject)));
        } catch (repairError) {}
      }
    }
    searchIndex = Math.max(index, start + 1);
  }
  return objects;
}

// OpenAI / 兼容接口
async function callOpenAI(content, apiKey, baseUrl, model, requestUrl = '') {
  const baseURL = baseUrl || 'https://api.openai.com/v1';
  
  // 构建消息内容
  let userContent;
  if (content.match(/\.(png|jpg|jpeg|gif|webp)$/i) || content.startsWith('http')) {
    userContent = [
      { type: 'text', text: '请分析这个需求图片，生成测试用例。' },
      { type: 'image_url', image_url: { url: content } }
    ];
  } else {
    userContent = `需求：\n${content}`;
  }
  
  // 使用 node-fetch 或内置 fetch
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
  // 构建请求头（MIMO 用 api-key，其他用 Authorization）
  const headers = {
    'Content-Type': 'application/json'
  };
  if (baseURL.includes('mimo') || baseURL.includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时
  
  let response;
  try {
    response = await fetchFn(getChatCompletionsUrl(baseURL, requestUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userContent }
        ]
      }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error('API 请求超时');
    }
    throw e;
  }
  clearTimeout(timeoutId);
  
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`模型接口返回了非 JSON 内容，请检查 Base URL（当前：${baseURL}）`);
  }
  if (!response.ok) {
    throw new Error(data.error?.message || 'API 调用失败');
  }

  const contentText = data.choices?.[0]?.message?.content;
  if (!contentText) throw new Error('模型接口未返回可解析的文本内容');
  return parseJsonResponse(contentText);
}

// Anthropic
async function callAnthropic(content, apiKey, model, baseUrl = '', requestUrl = '', systemPrompt = buildSystemPrompt()) {
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  const response = await fetchFn(getAnthropicMessagesUrl(baseUrl, requestUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-sonnet-20240229',
      max_tokens: DEFAULT_TEXT_MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: `需求：\n${content}` }]
    })
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Anthropic 接口返回了非 JSON 内容，请检查请求 URL（当前：${getAnthropicMessagesUrl(baseUrl, requestUrl)}）`);
  }
  if (!response.ok) {
    throw new Error(data.error?.message || responseText || 'Anthropic API 调用失败');
  }

  const contentText = extractAnthropicText(data);
  if (!contentText) throw new Error('Anthropic 接口未返回可解析的文本内容');
  return parseJsonResponse(contentText);
}

// 主函数
async function generateCases(content, options = {}) {
  if (!options || typeof options !== 'object') options = {};
  const llmConfig = getLLMConfig();
  const provider = llmConfig.provider;
  console.log(`LLM 提供商: ${provider}`);
  
  try {
    if (!llmConfig.apiKey) {
      console.log('未配置 API Key，返回示例用例');
      return generateMockCategories(content);
    }

    const visionFiles = normalizeVisionFiles(options.visionFiles);
    if (visionFiles.length > 1 && !options.disableVisionBatching) {
      console.log(`[Vision] 普通生成按图片逐张处理：${visionFiles.length} 张`);
      const allCases = [];
      const usedIds = new Set();
      for (let index = 0; index < visionFiles.length; index++) {
        const file = visionFiles[index];
        try {
          const batchContent = buildVisionFileFocusContent(content, file, index, visionFiles.length);
          const categories = await generateCases(batchContent, {
            ...options,
            visionFiles: [file],
            disableVisionBatching: true,
            disableMockOnError: true
          });
          flattenCategories(categories).forEach(caseData => {
            const stamped = stampVisionCase(caseData, file, index, visionFiles.length, usedIds);
            if (stamped) allCases.push(stamped);
          });
        } catch (error) {
          console.error(`[Vision] 图片 ${index + 1}/${visionFiles.length} 生成失败:`, error.message);
        }
      }
      if (allCases.length > 0) {
        try {
          const globalCases = await generateGlobalFlowCases(content, allCases, visionFiles.length, options);
          globalCases.forEach(caseData => {
            const normalized = normalizeCaseData({ ...caseData, source: caseData.source || '全局流程复盘' }, allCases.length);
            if (!normalized) return;
            const key = `${normalized.category}:${normalized.title}`;
            if (allCases.some(item => `${item.category}:${item.title}` === key)) return;
            normalized.id = `FLOW-${sanitizeCaseId(normalized.id || normalized.title || allCases.length + 1)}`;
            allCases.push(normalized);
          });
        } catch (error) {
          console.error('[Vision] 全局流程补充用例失败:', error.message);
        }
        return groupCasesByCategory(allCases);
      }
      throw new Error('多图逐张生成后仍未得到测试用例');
    }

    const contentText = await callConfiguredLLMText(
      buildSystemPrompt(),
      `需求：\n${content}`,
      { label: '生成用例模型调用', temperature: 0.3, visionFiles: options.visionFiles }
    );
    return parseJsonResponse(contentText);
    
  } catch (error) {
    if (options.disableMockOnError) throw error;
    console.error('AI 生成失败:', error.message);
    return generateMockCategories(content);
  }
}

// 示例用例
function generateMockCategories(content) {
  const id = Date.now().toString(36);
  
  return [
    {
      type: 'normal',
      name: '正常场景',
      cases: [
        { id: `${id}-1`, title: '核心流程验证', priority: 'P0', steps: ['执行主要操作', '验证结果'], expected: '流程正常完成' },
        { id: `${id}-2`, title: '标准输入处理', priority: 'P1', steps: ['输入标准数据', '提交'], expected: '数据正确处理' }
      ]
    },
    {
      type: 'exception',
      name: '异常场景',
      cases: [
        { id: `${id}-3`, title: '空输入处理', priority: 'P1', steps: ['不输入任何内容', '提交'], expected: '显示必填提示' },
        { id: `${id}-4`, title: '错误格式输入', priority: 'P1', steps: ['输入错误格式', '提交'], expected: '显示格式错误提示' }
      ]
    },
    {
      type: 'boundary',
      name: '边界情况',
      cases: [
        { id: `${id}-5`, title: '最小值测试', priority: 'P2', steps: ['输入最小允许值', '提交'], expected: '正常处理' },
        { id: `${id}-6`, title: '最大值测试', priority: 'P2', steps: ['输入最大允许值', '提交'], expected: '正常处理' }
      ]
    },
    {
      type: 'risk',
      name: '风险点',
      cases: [
        { id: `${id}-7`, title: 'XSS 注入防护', priority: 'P1', steps: ['输入脚本标签', '提交'], expected: '内容被转义' },
        { id: `${id}-8`, title: '并发操作', priority: 'P2', steps: ['同时提交多次'], expected: '只处理一次' }
      ]
    }
  ];
}

// 流式生成用例
async function generateCasesStreamByVisionFiles(content, onEvent, customSystemPrompt, options = {}) {
  const visionFiles = normalizeVisionFiles(options.visionFiles);
  const allCases = [];
  const usedIds = new Set();

  onEvent('progress', {
    message: `检测到 ${visionFiles.length} 张图片，正在逐张生成用例，避免模型漏图...`,
    totalImages: visionFiles.length
  });

  for (let index = 0; index < visionFiles.length; index++) {
    const file = visionFiles[index];
    const label = file.filename || `图片${index + 1}`;
    let localCount = 0;
    onEvent('progress', {
      message: `正在处理第 ${index + 1}/${visionFiles.length} 张：${label}`,
      imageIndex: index + 1,
      totalImages: visionFiles.length
    });

    const emitCase = (caseData) => {
      const stamped = stampVisionCase(caseData, file, index, visionFiles.length, usedIds);
      if (!stamped) return;
      localCount++;
      allCases.push(stamped);
      onEvent('case', { case: stamped, totalCases: allCases.length });
    };

    try {
      const batchContent = buildVisionFileFocusContent(content, file, index, visionFiles.length);
      await generateCasesStream(batchContent, (event, data) => {
        if (event === 'case' && data.case) {
          emitCase(data.case);
          return;
        }
        if (event === 'analysis' && data.modules) {
          onEvent('analysis', data);
          return;
        }
        if (event === 'progress' && data.message) {
          onEvent('progress', {
            ...data,
            message: `第 ${index + 1}/${visionFiles.length} 张：${data.message}`,
            imageIndex: index + 1,
            totalImages: visionFiles.length
          });
        }
      }, customSystemPrompt, {
        ...options,
        visionFiles: [file],
        disableVisionBatching: true,
        allowEmpty: true
      });

      if (localCount === 0) {
        onEvent('progress', {
          message: `第 ${index + 1}/${visionFiles.length} 张流式未解析到用例，正在补偿生成...`,
          imageIndex: index + 1,
          totalImages: visionFiles.length
        });
        const categories = await generateCases(batchContent, {
          ...options,
          visionFiles: [file],
          disableVisionBatching: true,
          disableMockOnError: true
        });
        flattenCategories(categories).forEach(emitCase);
      }

      onEvent('progress', {
        message: `第 ${index + 1}/${visionFiles.length} 张完成，已累计 ${allCases.length} 条用例`,
        imageIndex: index + 1,
        totalImages: visionFiles.length,
        totalCases: allCases.length
      });
    } catch (error) {
      console.error(`[Vision] 第 ${index + 1}/${visionFiles.length} 张生成失败:`, error.message);
      onEvent('progress', {
        message: `第 ${index + 1}/${visionFiles.length} 张生成失败：${error.message}`,
        imageIndex: index + 1,
        totalImages: visionFiles.length
      });
    }
  }

  if (allCases.length > 0) {
    onEvent('progress', {
      message: `逐图用例已生成 ${allCases.length} 条，正在做全局流程复盘...`,
      totalImages: visionFiles.length,
      totalCases: allCases.length
    });
    try {
      const globalCases = await generateGlobalFlowCases(content, allCases, visionFiles.length, options);
      globalCases.forEach(caseData => {
        const normalized = normalizeCaseData({ ...caseData, source: caseData.source || '全局流程复盘' }, allCases.length);
        if (!normalized) return;
        const key = `${normalized.category}:${normalized.title}`;
        if (allCases.some(item => `${item.category}:${item.title}` === key)) return;
        normalized.id = `FLOW-${sanitizeCaseId(normalized.id || normalized.title || allCases.length + 1)}`;
        allCases.push(normalized);
        onEvent('case', { case: normalized, totalCases: allCases.length });
      });
      onEvent('progress', {
        message: `全局流程复盘完成，累计 ${allCases.length} 条用例`,
        totalImages: visionFiles.length,
        totalCases: allCases.length
      });
    } catch (error) {
      console.error('[Vision] 全局流程补充用例失败:', error.message);
      onEvent('progress', { message: `全局流程复盘失败：${error.message}` });
    }
  }

  const categories = groupCasesByCategory(allCases);
  if (allCases.length === 0 && !options.allowEmpty) {
    throw new Error('多图逐张生成后仍未得到测试用例');
  }
  onEvent('complete', {
    categories,
    rawTextLength: 0,
    rawTextPreview: '',
    totalImages: visionFiles.length,
    totalCases: allCases.length
  });
}

async function generateCasesStream(content, onEvent, customSystemPrompt, options = {}) {
  const llmConfig = getLLMConfig();
  onEvent('progress', { message: `正在调用当前模型：${llmConfig.provider || 'custom'}/${llmConfig.model || llmConfig.deploymentName || 'unknown'}...` });

  const visionFiles = normalizeVisionFiles(options.visionFiles);
  if (visionFiles.length > 1 && !options.disableVisionBatching) {
    return generateCasesStreamByVisionFiles(content, onEvent, customSystemPrompt, {
      ...options,
      visionFiles
    });
  }

  if (!llmConfig.apiKey) {
    const categories = generateMockCategories(content);
    categories.forEach(category => {
      (category.cases || []).forEach(caseData => {
        onEvent('case', { case: { ...caseData, category: caseData.category || category.name || category.type } });
      });
    });
    onEvent('complete', { categories });
    return;
  }

  let tokenBuffer = '';
  let rawText = '';
  let allCases = [];
  let analysisSent = false;
  let replySent = false;
  const emittedCases = new Set();
  const emittedUpdates = new Set();

  onEvent('progress', { message: '正在分析需求...' });

  const handleToken = (delta) => {
    if (!delta) return;
    tokenBuffer += delta;
    rawText += delta;

    if (!replySent) {
      const replyMarkerIdx = tokenBuffer.indexOf('###REPLY###');
      if (replyMarkerIdx !== -1) {
        const afterReplyMarker = tokenBuffer.substring(replyMarkerIdx + 11);
        const replyEnd = afterReplyMarker.indexOf('\n');
        if (replyEnd !== -1) {
          const reply = afterReplyMarker.substring(0, replyEnd).trim();
          if (reply) {
            onEvent('reply', { text: reply });
            replySent = true;
          }
        }
      }
    }

    // 检测分析结果分隔符
    const analysisMarkerIdx = tokenBuffer.indexOf('###ANALYSIS###');
    if (analysisMarkerIdx !== -1 && !analysisSent) {
      const afterMarker = tokenBuffer.substring(analysisMarkerIdx + 14); // 14 = '###ANALYSIS###'.length
      const analysisMatch = afterMarker.match(/\{[\s\S]*?\}/);
      if (analysisMatch) {
        try {
          const analysisData = JSON.parse(analysisMatch[0]);
          if (analysisData.modules && Array.isArray(analysisData.modules)) {
            console.log('[LLM] 发送分析结果:', analysisData.modules);
            onEvent('analysis', { modules: analysisData.modules });
            analysisSent = true;
          }
        } catch (e) {}
      }
    }

    // 检测用例分隔符
    while (true) {
      const markerIdx = tokenBuffer.indexOf('###CASE###');
      if (markerIdx === -1) break;

      // 分隔符前的内容是上一条用例的剩余部分
      const before = tokenBuffer.substring(0, markerIdx).trim();
      tokenBuffer = tokenBuffer.substring(markerIdx + 10); // 10 = '###CASE###'.length

      if (before) {
        try {
          const caseData = JSON.parse(before);
          const caseKey = caseData.id || `${caseData.category || ''}:${caseData.title || ''}`;
          if (!emittedCases.has(caseKey)) {
            emittedCases.add(caseKey);
            allCases.push(caseData);
            onEvent('case', { case: caseData, totalCases: allCases.length });
          }
        } catch (e) {
          // 上一条 JSON 不完整，跳过
        }
      }
    }
  };

  await callConfiguredLLMText(
    customSystemPrompt || buildSystemPrompt(),
    `需求：\n${content}`,
    {
      label: '生成用例流式模型调用',
      temperature: 0.3,
      stream: true,
      onToken: handleToken,
      signal: options.signal,
      maxTokens: options.maxTokens,
      visionFiles: options.visionFiles
    }
  );

  // 处理缓冲区中最后一条（可能没有以分隔符结尾）
  const remaining = tokenBuffer.trim();
  if (!replySent && remaining) {
    const replyMatch = remaining.match(/###REPLY###([^\n]*)/);
    if (replyMatch?.[1]?.trim()) {
      onEvent('reply', { text: replyMatch[1].trim() });
      replySent = true;
    }
  }
  if (!replySent && options.allowEmpty) {
    const plainReply = rawText
      .replace(/###CASE###[\s\S]*/g, '')
      .replace(/###UPDATE###[\s\S]*/g, '')
      .replace(/###ANALYSIS###[\s\S]*/g, '')
      .replace(/###REPLY###/g, '')
      .trim();
    if (plainReply) {
      onEvent('reply', { text: plainReply });
      replySent = true;
    }
  }
  for (const updateData of parseMarkedJsonObjects(rawText, '###UPDATE###')) {
    const updateKey = updateData.id || JSON.stringify(updateData);
    if (updateData.id && !emittedUpdates.has(updateKey)) {
      emittedUpdates.add(updateKey);
      onEvent('update', { case: updateData });
    }
  }
  for (const caseData of parseMarkedJsonObjects(rawText, '###CASE###')) {
    const caseKey = caseData.id || `${caseData.category || ''}:${caseData.title || ''}`;
    if (!emittedCases.has(caseKey)) {
      emittedCases.add(caseKey);
      allCases.push(caseData);
      onEvent('case', { case: caseData, totalCases: allCases.length });
    }
  }
  if (remaining && !remaining.includes('###UPDATE###')) {
    // 尝试从剩余内容中提取 JSON
    const jsonMatch = remaining.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const caseData = JSON.parse(jsonMatch[0]);
        const caseKey = caseData.id || `${caseData.category || ''}:${caseData.title || ''}`;
        if (!emittedCases.has(caseKey)) {
          emittedCases.add(caseKey);
          allCases.push(caseData);
          onEvent('case', { case: caseData, totalCases: allCases.length });
        }
      } catch (e) {}
    }
  }

  if (allCases.length === 0) {
    const recoveredCategories = parseCategoriesFromModelText(rawText);
    recoveredCategories.forEach(category => {
      (category.cases || []).forEach(caseData => {
        const normalizedCase = normalizeCaseData({ ...caseData, category: caseData.category || category.name || category.type });
        if (!normalizedCase) return;
        const caseKey = normalizedCase.id || `${normalizedCase.category || ''}:${normalizedCase.title || ''}`;
        if (emittedCases.has(caseKey)) return;
        emittedCases.add(caseKey);
        allCases.push(normalizedCase);
        onEvent('case', { case: normalizedCase, totalCases: allCases.length });
      });
    });
    if (allCases.length > 0) {
      onEvent('progress', { message: `已从模型完整响应中恢复 ${allCases.length} 条用例` });
    }
  }

  // 按 category 组装最终结果
  const catMap = {};
  for (const c of allCases) {
    const catName = c.category || '未分类';
    if (!catMap[catName]) catMap[catName] = { type: catName, name: catName, cases: [] };
    catMap[catName].cases.push(c);
  }
  if (allCases.length === 0 && !options.allowEmpty) {
    throw new Error('模型响应中没有解析到测试用例');
  }
  onEvent('complete', { categories: Object.values(catMap), rawTextLength: rawText.length, rawTextPreview: rawText });
}

// 通用 LLM 调用（用于碎片提取等）
async function callLLM(systemPrompt, userContent) {
  return callConfiguredLLMText(systemPrompt, userContent, {
    label: '通用模型调用',
    temperature: 0.3
  });
}

// 专用分析调用（强制 JSON 输出）
async function callLLMForAnalysis(systemPrompt, userContent, options = {}) {
  return callConfiguredLLMText(systemPrompt, userContent, {
    label: '需求分析模型调用',
    temperature: 0.1,
    visionFiles: options.visionFiles
  });
}

async function callLLMForAnalysisStream(systemPrompt, userContent, onToken, options = {}) {
  return callConfiguredLLMText(systemPrompt, userContent, {
    label: '需求分析流式模型调用',
    temperature: 0.1,
    stream: true,
    onToken,
    signal: options.signal,
    maxTokens: options.maxTokens,
    visionFiles: options.visionFiles
  });
}

// 多模态 LLM 调用（支持图片）
async function callLLMWithImage(systemPrompt, textContent, imageBase64, maxTokens = DEFAULT_VISION_MAX_OUTPUT_TOKENS) {
  const llmConfig = getLLMConfig();
  const apiKey = llmConfig.apiKey;
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const requestUrl = llmConfig.requestUrl || '';
  const model = llmConfig.model || 'gpt-4-vision-preview';
  
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

  if (llmConfig.provider === 'anthropic') {
    const userContent = [{ type: 'text', text: textContent }];
    if (imageBase64) {
      const image = parseImageDataUrl(imageBase64);
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.data
        }
      });
    }

    const requestEndpoint = getAnthropicMessagesUrl(baseUrl, requestUrl);
    const response = await fetchFn(requestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (e) {
      throw new Error(`图片识别接口返回了非 JSON 内容，请检查请求 URL（当前：${requestEndpoint}）`);
    }

    if (!response.ok) {
      const message = pickApiErrorMessage(data, responseText, 'Anthropic 图片识别调用失败');
      console.error('[Vision API] Anthropic 调用失败:', response.status, message);
      throw new Error(`图片识别失败(${response.status})：${withVisionHint(message, llmConfig.provider, model)}`);
    }

    const contentText = extractAnthropicText(data);
    if (!contentText) throw new Error('图片识别接口未返回可解析的文本内容');
    return contentText;
  }

  if (llmConfig.provider === 'azure') {
    const userContent = [{ type: 'text', text: textContent }];
    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageBase64 }
      });
    }

    const deploymentName = llmConfig.deploymentName || llmConfig.model;
    const requestEndpoint = getAzureChatCompletionsUrl(llmConfig.endpoint || baseUrl, deploymentName, requestUrl);
    const response = await fetchFn(requestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
        max_tokens: maxTokens
      })
    });

    return readJsonTextResponse(response, requestEndpoint, '图片识别模型调用', 'openai', llmConfig);
  }
  
  const headers = { 'Content-Type': 'application/json' };
  if (baseUrl.includes('mimo') || baseUrl.includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  // 构建多模态消息
  const userContent = [
    { type: 'text', text: textContent }
  ];
  
  // 如果有图片，添加图片内容
  if (imageBase64) {
    userContent.push({
      type: 'image_url',
      image_url: { url: imageBase64 }
    });
  }
  
  const requestEndpoint = getChatCompletionsUrl(baseUrl, requestUrl);
  const response = await fetchFn(requestEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.3,
      max_tokens: maxTokens
    })
  });
  
  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch (e) {
    throw new Error(`图片识别接口返回了非 JSON 内容，请检查请求 URL（当前：${requestEndpoint}）`);
  }

  if (!response.ok) {
    const message = pickApiErrorMessage(data, responseText, 'API 调用失败');
    console.error('[Vision API] OpenAI 兼容调用失败:', response.status, message);
    throw new Error(`图片识别失败(${response.status})：${withVisionHint(message, llmConfig.provider, model)}`);
  }

  const contentText = data?.choices?.[0]?.message?.content;
  if (!contentText) throw new Error('图片识别接口未返回可解析的文本内容');
  return contentText;
}

/**
 * 理解图片内容
 */
async function understandImage(imageBase64, question = '请描述这张图片的内容') {
  const systemPrompt = `你是一个图像理解助手。请仔细观察图片，用简洁准确的语言描述图片内容。
如果图片中包含 UI 界面，请特别关注：
- 页面布局和结构
- 可交互元素（按钮、输入框、链接等）
- 文字内容
- 功能模块

请用结构化的方式描述。`;
  
  return await callLLMWithImage(systemPrompt, question, imageBase64, 1000);
}

/**
 * 从图片提取需求
 */
async function extractRequirementFromImage(imageBase64, options = {}) {
  const isHtmlScreenshot = /html|screenshot|prototype|axure/i.test(options.sourceType || '');
  const contextText = String(options.contextText || '').trim();
  const filename = String(options.filename || '').trim();
  const systemPrompt = `你是一个需求分析专家。用户会给你一张 UI 设计图或原型图，请从中提取出功能需求。

输出格式：
1. 页面/模块名称
2. 功能点列表（每个功能点包含：功能名、描述、涉及的交互）
3. 注意事项或边界条件

请用清晰的结构输出。

特别注意：
- 如果图片来自 HTML/原型截图，请以截图中的可见页面、标题、菜单、按钮、表单、表格、状态和业务文案为准。
- 不要根据 HTML 文件名或通用后台模板臆造需求。
- 如果截图信息很少，只输出已能确认的业务范围，并明确提示“截图信息不足”。`;
  
  const userText = [
    isHtmlScreenshot
      ? '这是一张 HTML/原型页面渲染后的截图。请直接阅读截图里的页面内容，提取可以用于生成测试用例的需求、模块、字段、按钮、流程和规则。'
      : '请简洁提取这张图片中的功能需求和关键交互，不要展开解释',
    filename ? `文件名：${filename}` : '',
    contextText
      ? `以下是系统从 HTML 中辅助抽取的文本，只作参考，最终以截图可见内容为准：\n${contextText}`
      : '',
  ].filter(Boolean).join('\n\n');

  return await callLLMWithImage(systemPrompt, userText, imageBase64, DEFAULT_VISION_MAX_OUTPUT_TOKENS);
}

// 需求分析
const ANALYSIS_PROMPT = `你是一位资深测试负责人，正在审阅一份产品需求文档。

你的任务不是简单挑错，而是输出一份可以直接给产品、研发、测试一起评审的需求分析报告：先讲清楚需求是什么，再拆模块、流程、规则、风险、测试范围和待确认问题。

【重要：输出格式要求】
你必须只输出一个合法 JSON 对象，不要输出任何其他文字、解释或 markdown 格式。

输出格式：
{
  "summary": "用 1-2 句话概括需求目标、核心用户和主要价值",
  "modules": [
    {
      "name": "模块名称",
      "goal": "模块目标",
      "flows": ["关键流程 1", "关键流程 2"],
      "rules": ["业务规则或状态流转"],
      "data": ["关键字段、权限、状态或接口数据"]
    }
  ],
  "risks": [
    {
      "category": "风险类型",
      "severity": "P0/P1/P2/P3",
      "title": "问题标题",
      "detail": "详细说明，包括为什么这是问题、影响什么用户或流程",
      "suggestion": "建议如何处理，或需要和产品确认什么",
      "testFocus": "后续测试重点"
    }
  ],
  "testScope": {
    "inScope": ["明确需要覆盖的测试范围"],
    "outOfScope": ["需求未说明或暂不建议纳入的范围"]
  },
  "questions": ["必须在开发/测试前确认的问题"],
  "acceptance": ["建议的验收标准"],
  "testStrategy": ["推荐的测试策略，例如冒烟、主流程、异常、兼容、回归、自动化优先级"]
}

【绝对重要】
1. 直接输出 JSON 对象，不要用 \`\`\`json 包裹
2. 不要在 JSON 前后输出任何文字
3. 确保输出是合法 JSON
4. 输出必须以 { 开头，以 } 结尾
5. 如果文档信息不足，要在 questions 中指出，不要编造不存在的规则

【风险类型说明】
- 边界未定义：需求中没有明确定义的边界条件
- 逻辑漏洞：需求逻辑上存在漏洞或矛盾
- 歧义描述：需求描述模糊，可能有多种理解
- 遗漏场景：需求没有考虑到的用户场景
- 数据风险：字段、状态、权限、接口、历史数据迁移等不清楚
- 技术风险：可能存在的实现、性能、兼容或第三方依赖风险
- 体验问题：可能导致用户体验不佳的设计

【分析原则】
1. 优先抽取真实模块和关键业务流程
2. 风险要具体，能落到页面、字段、状态、角色、接口或操作
3. 每个风险都要给测试关注点，方便后续生成用例
4. 不要只列正常流程，要覆盖异常、边界、权限、数据一致性、兼容、回归影响
5. 问题应该是产品经理、研发或测试负责人需要回答的

现在，请分析以下需求：`;

// JSON 修复函数 - 修复字符串值中的未转义换行符等
function fixJsonString(str) {
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      result += char;
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    
    if (inString) {
      if (char === '\n') { result += '\\n'; continue; }
      if (char === '\r') { result += '\\r'; continue; }
      if (char === '\t') { result += '\\t'; continue; }
    }
    
    result += char;
  }
  
  // 修复尾部逗号
  result = result.replace(/,\s*([}\]])/g, '$1');
  
  return result;
}

function parseJsonLoose(candidate) {
  const variants = [
    candidate,
    fixJsonString(candidate)
  ];

  for (const variant of variants) {
    try {
      return JSON.parse(variant);
    } catch (e) {}
  }

  for (const variant of variants) {
    try {
      return JSON.parse(jsonrepair(variant));
    } catch (e) {}
  }

  return null;
}

function extractBalancedJson(str, openChar, closeChar) {
  const start = str.indexOf(openChar);
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;

    if (depth === 0) {
      return str.slice(start, i + 1);
    }
  }

  return str.slice(start);
}

// 尝试多策略解析 JSON 数组
function tryParseJsonArray(str) {
  // 策略1: 直接解析
  const parsed = parseJsonLoose(str);
  if (Array.isArray(parsed)) return parsed;
  
  // 策略2: 逐行尝试找到第一个有效 JSON 数组
  // 有些 LLM 在 JSON 前后加了解释文字
  const lines = str.split('\n');
  let jsonStart = -1;
  let jsonEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('[')) jsonStart = i;
    if (lines[i].trim().endsWith(']')) jsonEnd = i;
  }
  if (jsonStart >= 0 && jsonEnd >= jsonStart) {
    const candidate = lines.slice(jsonStart, jsonEnd + 1).join('\n');
    const lineParsed = parseJsonLoose(candidate);
    if (Array.isArray(lineParsed)) return lineParsed;
  }

  const balanced = extractBalancedJson(str, '[', ']');
  if (balanced) {
    const balancedParsed = parseJsonLoose(balanced);
    if (Array.isArray(balancedParsed)) return balancedParsed;
  }
  
  return null;
}

function tryParseJsonObject(str) {
  const candidates = [str];
  const balanced = extractBalancedJson(str, '{', '}');
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    const result = parseJsonLoose(candidate);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  }

  return null;
}

function normalizeAnalysisReport(payload) {
  if (Array.isArray(payload)) {
    return {
      summary: '已识别需求中的主要风险和待确认问题。',
      modules: [],
      risks: payload,
      testScope: { inScope: [], outOfScope: [] },
      questions: payload.map(item => item.suggestion).filter(Boolean),
      acceptance: [],
      testStrategy: []
    };
  }

  if (!payload || typeof payload !== 'object') return null;

  const risks = Array.isArray(payload.risks)
    ? payload.risks
    : Array.isArray(payload.issues)
      ? payload.issues
      : [];

  return {
    summary: payload.summary || payload.overview || '已完成需求分析。',
    modules: Array.isArray(payload.modules) ? payload.modules : [],
    risks,
    testScope: payload.testScope && typeof payload.testScope === 'object'
      ? payload.testScope
      : { inScope: [], outOfScope: [] },
    questions: Array.isArray(payload.questions) ? payload.questions : [],
    acceptance: Array.isArray(payload.acceptance) ? payload.acceptance : [],
    testStrategy: Array.isArray(payload.testStrategy) ? payload.testStrategy : []
  };
}

function parseAnalysisText(result) {
  // 解析 JSON 结果
  let cleaned = String(result || '').trim();
  
  // 尝试解析外层 JSON（某些 API 返回 {content: ...} 格式）
  try {
    const outer = JSON.parse(cleaned);
    if (outer.content) {
      cleaned = outer.content;
    } else if (outer.choices?.[0]?.message?.content) {
      cleaned = outer.choices[0].message.content;
    }
  } catch (e) {
    // 不是外层 JSON，继续处理
  }
  
  // 如果结果是被转义的 JSON 字符串，先解析它
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    try {
      cleaned = JSON.parse(cleaned);
    } catch (e) {
      // 解析失败，继续
    }
  }
  
  // 移除 markdown 代码块标记（支持多种格式）
  // 先尝试匹配完整的代码块
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1];
  } else {
    // 如果没有完整匹配，尝试移除开头和结尾的标记
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/i, '');
  }
  cleaned = cleaned.trim();
  
  // 替换中文双引号为标准 JSON 引号，保留中文单引号，避免误伤内容里的自然语言引用
  cleaned = cleaned.replace(/[\u201c\u201d]/g, '"');
  
  // 尝试解析为新报告对象或旧问题数组
  let report = null;
  let issues = null;
  
  const trimmed = cleaned.trim();

  if (trimmed.startsWith('{') || cleaned.includes('{')) {
    console.log('[分析] 尝试解析 JSON 对象...');
    report = normalizeAnalysisReport(tryParseJsonObject(cleaned));
    if (!report) {
      console.log('[分析] JSON 对象解析失败');
    }
  }
  
  // 策略1: 直接作为数组解析
  if (!report && (trimmed.startsWith('[') || cleaned.includes('['))) {
    console.log('[分析] 尝试解析 JSON 数组...');
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    issues = tryParseJsonArray(arrayMatch ? arrayMatch[0] : cleaned);
    if (!issues) {
      console.log('[分析] JSON 数组解析失败');
    }
  }
  
  // 策略2: 作为对象解析，提取数组
  if (!report && !issues && trimmed.startsWith('{')) {
    try {
      const fixed = fixJsonString(cleaned);
      const obj = JSON.parse(fixed);
      // 查找对象中的数组属性
      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key]) && obj[key].length > 0) {
          issues = obj[key];
          break;
        }
      }
    } catch (e) {}
  }

  if (!report && issues) {
    report = normalizeAnalysisReport(issues);
  }
  
  if (report) {
    const risks = Array.isArray(report.risks) ? report.risks : [];
    const riskCases = risks.map((issue, i) => ({
      id: `analysis-risk-${i + 1}`,
      title: issue.title || `风险 ${i + 1}`,
      priority: issue.severity || 'P1',
      steps: [issue.detail || issue.testFocus || ''],
      expected: issue.suggestion || '',
      category: issue.category || '风险',
      testFocus: issue.testFocus || ''
    }));

    const questionCases = (report.questions || []).map((question, i) => ({
      id: `analysis-question-${i + 1}`,
      title: question,
      priority: 'P1',
      steps: ['该问题需要在开发或测试前确认，否则可能影响用例设计和验收口径。'],
      expected: '请产品、研发、测试共同确认。',
      category: '待确认'
    }));

    return [{
      type: 'analysis',
      name: '需求分析',
      summary: report.summary,
      modules: report.modules,
      testScope: report.testScope,
      questions: report.questions,
      acceptance: report.acceptance,
      testStrategy: report.testStrategy,
      cases: [...riskCases, ...questionCases]
    }];
  }
  
  console.warn('[分析] JSON 解析失败，返回降级报告，不再重复请求模型');
  return [{
    type: 'analysis',
    name: '需求分析',
    summary: '模型已返回内容，但格式不完整，系统未能整理为结构化报告。',
    modules: [],
    testScope: { inScope: [], outOfScope: ['需要重新分析或复制原始内容人工查看'] },
    questions: ['模型返回格式异常，建议重新点击分析或缩短需求内容后重试'],
    acceptance: [],
    testStrategy: ['先人工确认原始分析内容，再进入用例生成'],
    cases: [{
      id: 'analysis-1',
      title: '模型返回格式异常',
      priority: 'P1',
      steps: [result],
      expected: '建议重新分析，或复制原始内容人工查看',
      category: '格式异常'
    }]
  }];
}

async function reviewGlobalAnalysis(content, partialAnalysis, totalImages, options = {}) {
  if (!partialAnalysis.length || options.disableGlobalReview) {
    return mergeAnalysisCategories(partialAnalysis, totalImages);
  }
  const summary = buildAnalysisReviewSummary(partialAnalysis);
  const prompt = `${ANALYSIS_PROMPT}

【全局复盘任务】
前面已经按 ${totalImages} 张图片逐张完成页面级需求分析。现在请基于这些逐图分析结果，做一次完整业务流程复盘。

重点补充：
1. 图片之间的业务顺序和主链路
2. 跨页面、跨模块、跨端的数据流和状态流转
3. 页面级分析看不到的端到端风险
4. 权限、角色、数据一致性、回归影响和自动化优先级
5. 不要丢弃逐图分析中已经发现的模块、风险和待确认问题

仍然只输出合法 JSON 对象。`;
  const userContent = [
    `原始需求：\n${content}`,
    `逐图分析合并摘要：\n${JSON.stringify(summary, null, 2)}`
  ].join('\n\n');
  const result = await callLLMForAnalysis(prompt, userContent, {});
  const reviewed = parseAnalysisText(result);
  return mergeAnalysisCategories([...partialAnalysis, ...reviewed], totalImages);
}

async function analyzeRequirement(content, options = {}) {
  console.log('[分析] 开始需求分析...');
  const visionFiles = normalizeVisionFiles(options.visionFiles);
  if (visionFiles.length > 1 && !options.disableVisionBatching) {
    console.log(`[分析] 多图按图片逐张分析：${visionFiles.length} 张`);
    const allAnalysis = [];
    for (let index = 0; index < visionFiles.length; index++) {
      const file = visionFiles[index];
      const focusedContent = buildVisionAnalysisFocusContent(content, file, index, visionFiles.length);
      try {
        const partial = await analyzeRequirement(focusedContent, {
          ...options,
          visionFiles: [file],
          disableVisionBatching: true
        });
        allAnalysis.push(...partial);
      } catch (error) {
        console.error(`[分析] 第 ${index + 1}/${visionFiles.length} 张分析失败:`, error.message);
      }
    }
    if (allAnalysis.length > 0) {
      return reviewGlobalAnalysis(content, allAnalysis, visionFiles.length, options);
    }
    throw new Error('多图逐张分析后仍未得到需求分析结果');
  }
  const result = await callLLMForAnalysis(ANALYSIS_PROMPT, content, options);
  console.log('[分析] LLM 返回结果长度:', result.length);
  console.log('[分析] LLM 返回结果前200字符:', result.substring(0, 200));
  return parseAnalysisText(result);
}

async function analyzeRequirementStream(content, onEvent, options = {}) {
  console.log('[分析] 开始流式需求分析...');
  const visionFiles = normalizeVisionFiles(options.visionFiles);
  if (visionFiles.length > 1 && !options.disableVisionBatching) {
    console.log(`[分析] 流式多图按图片逐张分析：${visionFiles.length} 张`);
    const allAnalysis = [];
    const rawParts = [];
    for (let index = 0; index < visionFiles.length; index++) {
      const file = visionFiles[index];
      const label = file.filename || `图片${index + 1}`;
      onEvent('progress', {
        message: `正在分析第 ${index + 1}/${visionFiles.length} 张：${label}`,
        imageIndex: index + 1,
        totalImages: visionFiles.length
      });
      let partialRaw = '';
      try {
        const focusedContent = buildVisionAnalysisFocusContent(content, file, index, visionFiles.length);
        partialRaw = await callLLMForAnalysisStream(ANALYSIS_PROMPT, focusedContent, (token) => {
          rawParts.push(token);
          onEvent('token', { text: token });
        }, {
          ...options,
          visionFiles: [file],
          disableVisionBatching: true
        });
        const partialAnalysis = parseAnalysisText(partialRaw);
        allAnalysis.push(...partialAnalysis);
        onEvent('progress', {
          message: `第 ${index + 1}/${visionFiles.length} 张分析完成，正在继续下一张...`,
          imageIndex: index + 1,
          totalImages: visionFiles.length
        });
      } catch (error) {
        console.error(`[分析] 第 ${index + 1}/${visionFiles.length} 张分析失败:`, error.message);
        onEvent('progress', {
          message: `第 ${index + 1}/${visionFiles.length} 张分析失败：${error.message}`,
          imageIndex: index + 1,
          totalImages: visionFiles.length
        });
      }
    }
    onEvent('progress', {
      message: `逐图分析已完成，正在进行全局业务流程复盘...`,
      totalImages: visionFiles.length
    });
    let analysis = mergeAnalysisCategories(allAnalysis, visionFiles.length);
    try {
      analysis = await reviewGlobalAnalysis(content, allAnalysis, visionFiles.length, options);
      onEvent('progress', {
        message: '全局业务流程复盘完成',
        totalImages: visionFiles.length
      });
    } catch (error) {
      console.error('[分析] 全局业务流程复盘失败:', error.message);
      onEvent('progress', {
        message: `全局业务流程复盘失败：${error.message}`,
        totalImages: visionFiles.length
      });
    }
    const rawText = rawParts.join('');
    onEvent('complete', { cases: analysis, rawText });
    return analysis;
  }
  let lastEmit = 0;
  const rawText = await callLLMForAnalysisStream(ANALYSIS_PROMPT, content, (token) => {
    const now = Date.now();
    onEvent('token', { text: token });
    if (now - lastEmit > 3000) {
      lastEmit = now;
      onEvent('progress', { message: '模型正在持续输出分析内容...' });
    }
  }, options);

  console.log('[分析] 流式 LLM 返回结果长度:', rawText.length);
  const analysis = parseAnalysisText(rawText);
  onEvent('complete', { cases: analysis, rawText });
  return analysis;
}

module.exports = { generateCases, generateCasesStream, analyzeRequirement, analyzeRequirementStream, callLLM, callLLMWithImage, understandImage, extractRequirementFromImage };
