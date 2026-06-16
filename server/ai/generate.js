// input: .env 配置、.scout 配置、OpenAI 兼容接口响应
// output: generateCases(content) 返回分类的测试用例、analyzeRequirement(content) 返回需求分析结果
// position: LLM 调用核心，支持多提供商、Base URL 规范化与流式响应校验

const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
const { getLLMConfig } = require('../config');

function getChatCompletionsUrl(baseUrl) {
  const normalized = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  try {
    const url = new URL(normalized);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return `${url.toString().replace(/\/+$/, '')}/chat/completions`;
    }
  } catch (e) {}
  return `${normalized}/chat/completions`;
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
4. 不要输出任何 ###CASE### 之外的文字`

// 解析 JSON 响应
function parseJsonResponse(text) {
  // 清理文本，提取可能的 JSON
  let cleaned = text.trim();
  
  // 移除 markdown 代码块
  cleaned = cleaned.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '');
  
  // 尝试直接解析
  try {
    const result = JSON.parse(cleaned);
    if (result.categories) return result.categories;
    if (Array.isArray(result)) return result;
  } catch (e) {
    console.log('直接解析失败，尝试修复...');
  }
  
  // 尝试提取 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      // 修复常见的 JSON 问题
      let jsonStr = jsonMatch[0]
        .replace(/,\s*}/g, '}')  // 移除对象末尾的逗号
        .replace(/,\s*]/g, ']')  // 移除数组末尾的逗号
        .replace(/\n/g, ' ')     // 移除换行
        .replace(/\t/g, ' ');    // 移除制表符
      
      const result = JSON.parse(jsonStr);
      if (result.categories) return result.categories;
      if (Array.isArray(result)) return result;
    } catch (e) {
      console.log('JSON 修复失败:', e.message);
    }
  }
  
  // 最后尝试：提取数组
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const result = JSON.parse(arrayMatch[0]);
      if (Array.isArray(result)) return result;
    } catch (e) {}
  }
  
  // 如果所有尝试都失败，返回示例数据
  console.log('无法解析 LLM 返回，使用示例数据');
  return generateMockCategories('');
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

// OpenAI / 兼容接口
async function callOpenAI(content, apiKey, baseUrl, model) {
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
    response = await fetchFn(getChatCompletionsUrl(baseURL), {
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
async function callAnthropic(content, apiKey, model) {
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new Error('需要安装: npm install @anthropic-ai/sdk');
  }
  
  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: model || 'claude-3-sonnet-20240229',
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: `需求：\n${content}` }]
  });
  
  return parseJsonResponse(message.content[0].text);
}

// 主函数
async function generateCases(content) {
  const llmConfig = getLLMConfig();
  const provider = llmConfig.provider;
  console.log(`LLM 提供商: ${provider}`);
  
  try {
    let categories;
    
    if (!llmConfig.apiKey) {
      console.log('未配置 API Key，返回示例用例');
      return generateMockCategories(content);
    }
    
    switch (provider) {
      case 'openai':
      case 'custom':
        categories = await callOpenAI(content, llmConfig.apiKey, llmConfig.baseUrl, llmConfig.model);
        break;
        
      case 'anthropic':
        categories = await callAnthropic(content, llmConfig.apiKey, llmConfig.model);
        break;
        
      default:
        throw new Error(`不支持的提供商: ${provider}`);
    }
    
    return categories;
    
  } catch (error) {
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
async function generateCasesStream(content, onEvent, customSystemPrompt, options = {}) {
  const llmConfig = getLLMConfig();
  const apiKey = llmConfig.apiKey;
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const model = llmConfig.model || 'gpt-4';

  onEvent('progress', { message: '正在调用 AI...' });

  // 使用 node-fetch 或内置 fetch
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
  // 构建请求头（MIMO 用 api-key，其他用 Authorization）
  const headers = {
    'Content-Type': 'application/json'
  };
  if (baseUrl.includes('mimo') || baseUrl.includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchFn(getChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: customSystemPrompt || buildSystemPrompt() },
        { role: 'user', content: `需求：\n${content}` }
      ],
      stream: true,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {})
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 调用失败: ${error}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`模型流式接口返回了非 SSE 内容，请检查 Base URL（当前：${baseUrl}）`);
    }
    const contentText = data.choices?.[0]?.message?.content;
    if (!contentText) throw new Error('模型接口未返回可解析的文本内容');
    if (options.allowEmpty) {
      const replyMatch = contentText.match(/###REPLY###([^\n]*)/);
      if (replyMatch?.[1]?.trim()) {
        onEvent('reply', { text: replyMatch[1].trim() });
      }
      onEvent('complete', { categories: [] });
      return;
    }
    onEvent('complete', { categories: parseJsonResponse(contentText) });
    return;
  }

  // 处理流式响应 — 分隔符协议
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let tokenBuffer = '';
  let rawText = '';
  let sseBuffer = '';
  let allCases = [];
  let analysisSent = false;
  let replySent = false;
  const emittedUpdates = new Set();

  onEvent('progress', { message: '正在分析需求...' });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (!delta) continue;

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
              allCases.push(caseData);
              onEvent('case', { case: caseData, totalCases: allCases.length });
            } catch (e) {
              // 上一条 JSON 不完整，跳过
            }
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

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
  for (const match of rawText.matchAll(/###UPDATE###\s*(\{[^\n]*\})/g)) {
    try {
      const updateData = JSON.parse(match[1]);
      const updateKey = JSON.stringify(updateData);
      if (updateData.id && !emittedUpdates.has(updateKey)) {
        emittedUpdates.add(updateKey);
        onEvent('update', { case: updateData });
      }
    } catch (e) {}
  }
  if (remaining && !remaining.includes('###UPDATE###')) {
    // 尝试从剩余内容中提取 JSON
    const jsonMatch = remaining.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const caseData = JSON.parse(jsonMatch[0]);
        allCases.push(caseData);
        onEvent('case', { case: caseData, totalCases: allCases.length });
      } catch (e) {}
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
  onEvent('complete', { categories: Object.values(catMap) });
}

// 通用 LLM 调用（用于碎片提取等）
async function callLLM(systemPrompt, userContent) {
  const llmConfig = getLLMConfig();
  const apiKey = llmConfig.apiKey;
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const model = llmConfig.model || 'gpt-4';
  
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
  const headers = { 'Content-Type': 'application/json' };
  if (baseUrl.includes('mimo') || baseUrl.includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  const response = await fetchFn(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.3
    })
  });
  
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API 调用失败');
  return data.choices[0].message.content;
}

// 专用分析调用（强制 JSON 输出）
async function callLLMForAnalysis(systemPrompt, userContent) {
  const llmConfig = getLLMConfig();
  const apiKey = llmConfig.apiKey;
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const model = llmConfig.model || 'gpt-4';
  
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
  const headers = { 'Content-Type': 'application/json' };
  if (baseUrl.includes('mimo') || baseUrl.includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  // 尝试使用 response_format 强制 JSON 输出
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.1
  };
  
  // 部分 API 支持 response_format，但可能导致错误，暂不使用
  // if (!baseUrl.includes('mimo') && !baseUrl.includes('xiaomi')) {
  //   body.response_format = { type: 'json_object' };
  // }
  
  const response = await fetchFn(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API 调用失败');
  return data.choices[0].message.content;
}

async function callLLMForAnalysisStream(systemPrompt, userContent, onToken, options = {}) {
  const llmConfig = getLLMConfig();
  const apiKey = llmConfig.apiKey;
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const model = llmConfig.model || 'gpt-4';

  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

  const headers = { 'Content-Type': 'application/json' };
  if (baseUrl.includes('mimo') || baseUrl.includes('xiaomi')) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchFn(getChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers,
    signal: options.signal,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      stream: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'API 调用失败');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const responseText = await response.text();
    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content || '';
    if (content) onToken(content);
    return content;
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
        const delta = json.choices?.[0]?.delta?.content || '';
        if (!delta) continue;
        rawText += delta;
        onToken(delta);
      } catch (e) {}
    }
  }

  return rawText;
}

// 多模态 LLM 调用（支持图片）
async function callLLMWithImage(systemPrompt, textContent, imageBase64, maxTokens = 1200) {
  const llmConfig = getLLMConfig();
  const apiKey = llmConfig.apiKey;
  const baseUrl = llmConfig.baseUrl || 'https://api.openai.com/v1';
  const model = llmConfig.model || 'gpt-4-vision-preview';
  
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
  
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
  
  const response = await fetchFn(`${baseUrl}/chat/completions`, {
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
  
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API 调用失败');
  return data.choices[0].message.content;
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
async function extractRequirementFromImage(imageBase64) {
  const systemPrompt = `你是一个需求分析专家。用户会给你一张 UI 设计图或原型图，请从中提取出功能需求。

输出格式：
1. 页面/模块名称
2. 功能点列表（每个功能点包含：功能名、描述、涉及的交互）
3. 注意事项或边界条件

请用清晰的结构输出。`;
  
  return await callLLMWithImage(systemPrompt, '请简洁提取这张图片中的功能需求和关键交互，不要展开解释', imageBase64, 1200);
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
      questions: payload.map(item => item.suggestion).filter(Boolean).slice(0, 8),
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

async function analyzeRequirement(content) {
  console.log('[分析] 开始需求分析...');
  const result = await callLLMForAnalysis(ANALYSIS_PROMPT, content);
  console.log('[分析] LLM 返回结果长度:', result.length);
  console.log('[分析] LLM 返回结果前200字符:', result.substring(0, 200));
  return parseAnalysisText(result);
}

async function analyzeRequirementStream(content, onEvent, options = {}) {
  console.log('[分析] 开始流式需求分析...');
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
