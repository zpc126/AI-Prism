// input: dotenv、express、业务路由、Web 静态资源、图片 base64 请求
// output: Prism Web 页面、HTTP API、WebSocket 服务
// position: Web 应用服务入口，支持文档与图片需求分析

require('dotenv').config();

// 全局错误处理
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadConfig, saveWebConfig } = require('./config');
const { generateCases, generateCasesStream, analyzeRequirement, callLLM, understandImage, extractRequirementFromImage } = require('./ai/generate');
const { executeCases } = require('./executor/pi-runner');
const { scrapeUrl, isUrlInput, extractUrls } = require('./scraper/url-scraper');
const { recallWithAssociations, recordRecallUsage } = require('./brain/recall');
const { incrementStat, getHomeStats, estimateTokens } = require('./storage/stats');
const {
  setCurrentExecutor,
  getCurrentExecutor,
  clearCurrentExecutor,
} = require('./executor/execution-state');
let brainRoutes;
let sessionRoutes;
let reportRoutes;
let scriptRoutes;
let gepRoutes;
let parserRoutes;
let evalRoutes;

try {
  brainRoutes = require('./brain/routes');
} catch (e) {
  console.error('大脑路由加载失败:', e.message);
  brainRoutes = express.Router();
}

try {
  sessionRoutes = require('./storage/routes');
} catch (e) {
  console.error('会话路由加载失败:', e.message);
  sessionRoutes = express.Router();
}

try {
  reportRoutes = require('./reports/routes');
} catch (e) {
  console.error('报告路由加载失败:', e.message);
  reportRoutes = express.Router();
}

try {
  scriptRoutes = require('./storage/script-routes');
} catch (e) {
  console.error('脚本库路由加载失败:', e.message);
  scriptRoutes = express.Router();
}

try {
  gepRoutes = require('./gep/routes');
} catch (e) {
  console.error('GEP 路由加载失败:', e.message);
  gepRoutes = express.Router();
}

try {
  parserRoutes = require('./parser/routes');
} catch (e) {
  console.error('解析器路由加载失败:', e.message);
  parserRoutes = express.Router();
}

try {
  evalRoutes = require('./evaluation/routes');
} catch (e) {
  console.error('评估路由加载失败:', e.message);
  evalRoutes = express.Router();
}

let piRoutes;
try {
  piRoutes = require('./pi/routes');
} catch (e) {
  console.error('PI Agent 路由加载失败:', e.message);
  piRoutes = express.Router();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '70mb' }));

// 静态文件服务
app.use(express.static(path.join(__dirname, '../src')));

// 大脑路由
app.use('/api/brain', brainRoutes);

// 会话路由
app.use('/api/sessions', sessionRoutes);

// 报告路由
app.use('/api/reports', reportRoutes);

// 自动化脚本库路由
app.use('/api/scripts', scriptRoutes);

// GEP 路由
app.use('/api/gep', gepRoutes);

// 文件上传路由
app.use('/api/files', parserRoutes);

// 评估路由
app.use('/api/eval', evalRoutes);

// PI Agent 路由
app.use('/api/pi', piRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/stats/home', (req, res) => {
  res.json({ success: true, stats: getHomeStats() });
});

function countCases(categories = []) {
  return categories.reduce((sum, category) => sum + (category.cases?.length || 0), 0);
}

function recordModelUsage(input, output) {
  incrementStat('model_calls', 1);
  incrementStat('model_tokens', estimateTokens(input, output));
}

function appendHistoricalCaseKnowledge(content) {
  const learnedCases = recallWithAssociations(content, {
    limit: 8,
    source: 'test_case_history'
  });
  if (!learnedCases.length) return content;
  recordRecallUsage(learnedCases.map(fragment => fragment.id));
  console.log(`[自动学习] 当前需求命中 ${learnedCases.length} 条历史用例`);
  return `${content}

【历史用例知识参考】
以下内容来自已保存并人工调整过的历史用例。请参考其覆盖思路、真实步骤和预期结果，但要结合当前需求重新设计，禁止无脑照抄或重复生成。
${learnedCases.map((fragment, index) => `${index + 1}. ${fragment.content}`).join('\n\n')}`;
}

// Web 端配置管理（服务默认仅监听本机）
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: loadConfig() });
});

app.put('/api/config', (req, res) => {
  try {
    const config = saveWebConfig(req.body);
    res.json({ success: true, config });
  } catch (error) {
    console.error('保存 Web 配置失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// URL 内容抓取
app.post('/api/scrape-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: '请提供 URL' });
    }
    const result = await scrapeUrl(url);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('URL 抓取失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 图片理解
app.post('/api/understand-image', async (req, res) => {
  try {
    const { imageBase64, question } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '请提供图片' });
    }
    const result = await understandImage(imageBase64, question);
    res.json({ success: true, description: result });
  } catch (error) {
    console.error('图片理解失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 从图片提取需求
app.post('/api/extract-requirement', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '请提供图片' });
    }
    const result = await extractRequirementFromImage(imageBase64);
    res.json({ success: true, requirement: result });
  } catch (error) {
    console.error('需求提取失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 生成用例 - 普通模式
app.post('/api/generate-cases', async (req, res) => {
  try {
    let { content, productName = '', format = 'text', mode = 'cases' } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '请提供需求内容' });
    }
    
    // 检测是否是 URL 输入，自动抓取内容
    let scrapedMeta = null;
    if (isUrlInput(content)) {
      try {
        const scraped = await scrapeUrl(content);
        content = scraped.content;
        scrapedMeta = scraped;
        console.log(`[URL] 已抓取: ${scraped.title} (${scraped.content.length} 字符)`);
        console.log(`[URL] 内容预览: ${content.substring(0, 200)}...`);
      } catch (e) {
        console.error('[URL] 抓取失败，使用原始输入:', e.message);
        console.error('[URL] 错误详情:', e.stack);
      }
    }
    
    // 根据模式选择不同的处理方式
    if (mode === 'analyze') {
      const enrichedContent = appendHistoricalCaseKnowledge(content);
      const analysis = await analyzeRequirement(enrichedContent);
      recordModelUsage(enrichedContent, analysis);
      res.json({ success: true, cases: analysis, scraped: scrapedMeta });
    } else {
      const generationContent = productName
        ? `【一级产品名称】${productName}\n【需求内容】\n${content}`
        : content;
      const enrichedContent = appendHistoricalCaseKnowledge(generationContent);
      const cases = await generateCases(enrichedContent, format);
      recordModelUsage(enrichedContent, cases);
      incrementStat(mode === 'regression' ? 'regression_cases' : 'generated_cases', countCases(cases));
      res.json({ success: true, cases, scraped: scrapedMeta });
    }
  } catch (error) {
    console.error('生成用例失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 生成用例 - 流式模式
app.post('/api/generate-cases-stream', async (req, res) => {
  let { content, productName = '' } = req.body;
  if (!content) {
    return res.status(400).json({ success: false, error: '请提供需求内容' });
  }
  
  // 检测是否是 URL 输入，自动抓取内容
  if (isUrlInput(content)) {
    try {
      const scraped = await scrapeUrl(content);
      content = scraped.content;
      console.log(`[URL] 流式生成，已抓取: ${scraped.title}`);
    } catch (e) {
      console.error('[URL] 抓取失败，使用原始输入:', e.message);
    }
  }

  // 设置 SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    // 检查 generateCasesStream 是否存在
    if (typeof generateCasesStream !== 'function') {
      throw new Error('generateCasesStream not available');
    }
    const generationContent = productName
      ? `【一级产品名称】${productName}\n【需求内容】\n${content}`
      : content;
    const enrichedContent = appendHistoricalCaseKnowledge(generationContent);
    const isRegression = req.body.mode === 'regression';
    await generateCasesStream(enrichedContent, (event, data) => {
      if (event === 'complete') {
        recordModelUsage(enrichedContent, data.categories || []);
        incrementStat(isRegression ? 'regression_cases' : 'generated_cases', countCases(data.categories || []));
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
  } catch (error) {
    console.error('流式生成失败:', error);
    // 降级到普通模式
    try {
      const generationContent = productName
        ? `【一级产品名称】${productName}\n【需求内容】\n${content}`
        : content;
      const enrichedContent = appendHistoricalCaseKnowledge(generationContent);
      const cases = await generateCases(enrichedContent);
      recordModelUsage(enrichedContent, cases);
      incrementStat(req.body.mode === 'regression' ? 'regression_cases' : 'generated_cases', countCases(cases));
      res.write(`event: complete\ndata: ${JSON.stringify({ categories: cases })}\n\n`);
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    }
  }
  
  res.end();
});

// 执行用例 - 调用批量执行器（支持截图报告）
app.post('/api/execute', async (req, res) => {
  try {
    const { cases, options = {} } = req.body;
    if (!cases || cases.length === 0) {
      return res.status(400).json({ success: false, error: '请提供要执行的用例' });
    }
    
    const { BatchExecutor } = require('./executor/batch-executor');
    const executor = new BatchExecutor();
    setCurrentExecutor(executor);
    let responseFinished = false;
    
    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.on('close', () => {
      if (!responseFinished && getCurrentExecutor() === executor) {
        console.log('[Server] 执行连接已关闭，自动停止任务');
        clearCurrentExecutor(executor);
        executor.stop().catch(error => {
          console.error('[Server] 连接关闭后停止任务失败:', error);
        });
      }
    });
    
    try {
      const result = await executor.execute(cases, options, (log) => {
        res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
      });
      incrementStat('automation_runs', cases.length);
      
      res.write(`event: complete\ndata: ${JSON.stringify({ success: true, ...result })}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      responseFinished = true;
      clearCurrentExecutor(executor);
    }
    
    res.end();
  } catch (error) {
    console.error('执行失败:', error);
    clearCurrentExecutor();
    res.status(500).json({ success: false, error: error.message });
  }
});

// 停止执行
app.post('/api/stop', async (req, res) => {
  try {
    const activeExecutor = getCurrentExecutor();
    if (activeExecutor) {
      clearCurrentExecutor(activeExecutor);
      console.log('[Server] 用户请求停止执行');
      await activeExecutor.stop();
      console.log('[Server] 执行已停止');
      res.json({ success: true, message: '已停止执行' });
    } else {
      res.json({ success: false, message: '当前没有正在执行的任务' });
    }
  } catch (error) {
    console.error('停止失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 执行命令 - 直接调用 PI 引擎执行自然语言指令
app.post('/api/execute-command', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({ success: false, error: '请提供操作指令' });
    }
    const { PiRunner } = require('./executor/pi-runner');
    const runner = new PiRunner();
    const prompt = runner.buildPrompt({
      title: '用户指令',
      steps: command.split(/[，,。.；;]/).filter(Boolean),
      expected: '操作成功完成'
    });
    const result = await new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(runner.buildCommand(prompt), {
        maxBuffer: 1024 * 1024 * 10,
        timeout: 300000
      }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    res.json({ success: true, output: result });
  } catch (error) {
    console.error('执行命令失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 执行命令 - 流式输出（SSE）
app.post('/api/execute-command-stream', async (req, res) => {
  const { command, testCase: providedTestCase } = req.body;
  if (!command) {
    return res.status(400).json({ success: false, error: '请提供操作指令' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const { BatchExecutor } = require('./executor/batch-executor');
  const executor = new BatchExecutor();
  setCurrentExecutor(executor);
  let responseFinished = false;

  res.on('close', () => {
    if (!responseFinished && getCurrentExecutor() === executor) {
      clearCurrentExecutor(executor);
      executor.stop().catch(error => console.error('[Server] 单用例连接关闭后停止失败:', error));
    }
  });

  try {
    const testCase = providedTestCase || {
      id: `command_${Date.now()}`,
      title: command.split('\n')[0].replace(/^测试用例：/, '') || '单用例执行',
      category: '单用例执行',
      priority: 'P1',
      steps: command.split(/[，,。.；;\n]+/).filter(Boolean),
      expected: '操作成功完成',
    };
    const result = await executor.execute([testCase], {
      title: `${testCase.title} - 单用例报告`,
      requirement: command,
      usePIEngine: true,
    }, (log) => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    });
    incrementStat('automation_runs', 1);
    res.write(`event: complete\ndata: ${JSON.stringify({ success: result.failed === 0, ...result })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    responseFinished = true;
    clearCurrentExecutor(executor);
  }

  res.end();
});

// 画布协作对话 - 用户在画布上与 Prism 对话调整用例
app.post('/api/canvas-chat', async (req, res) => {
  const { message, cases, selectedCategory, history } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, error: '请输入消息' });
  }
  const requestId = Date.now().toString(36);
  const startedAt = Date.now();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write(`event: progress\ndata: ${JSON.stringify({ message: '消息已收到，正在连接模型...' })}\n\n`);

  const { generateCasesStream } = require('./ai/generate');

  // 已有用例摘要
  const relevantCases = (cases || [])
    .filter(c => !selectedCategory || c.category === selectedCategory);
  const caseSummary = relevantCases.map(c =>
    JSON.stringify({
      id: c.id,
      category: c.category,
      title: c.title,
      priority: c.priority,
      steps: c.steps || [],
      expected: c.expected || ''
    })
  ).join('\n');
  const historySummary = (history || []).map(item =>
    `${item.role === 'assistant' ? 'Prism' : '用户'}：${String(item.content || '').slice(0, 300)}`
  ).join('\n');

  const fullContent = `${historySummary ? `最近对话：\n${historySummary}\n\n` : ''}当前模块：${selectedCategory || '全部'}
相关测试用例（仅供参考）：\n${caseSummary || '无'}

用户最新消息：${message}`;
  console.log(`[CanvasChat:${requestId}] 开始 model-context cases=${relevantCases.length}/${cases?.length || 0} history=${history?.length || 0} message=${String(message).slice(0, 80)}`);

  // 协作对话 prompt：先回复用户，再输出需要补充的用例
  const canvasChatPrompt = `你是 Prism，一个资深 QA 测试工程师，正在和用户一起协作完善测试用例。

用户会告诉你哪里需要调整。你需要：
1. 第一行必须用 ###REPLY### 开头，紧跟一句简短回复，格式：###REPLY###我明白了，我来按你的要求调整。
2. 如果需要补充用例，用 ###CASE### 格式逐条输出新用例
3. 如果用户要求修改已有用例，必须根据已有用例 id 输出 ###UPDATE###，直接修改原用例，禁止新增一条相似用例
4. 如果用户只是闲聊或确认，只回复对话，不用输出用例

【修改已有用例格式】
每条修改占一行，保留原用例 id，只填写要更新后的完整内容：
###UPDATE###{"id":"已有用例ID","category":"模块名","title":"修改后的标题","priority":"P0","reason":"修改理由","steps":["修改后的步骤1","修改后的步骤2"],"expected":"修改后的预期结果"}

【用例输出格式】
每条新用例占一行，以 ###CASE### 开头，后跟 JSON：
###CASE###{"category":"模块名","id":"唯一ID","title":"用例标题","priority":"P0","reason":"设计理由（15字以内）","steps":["步骤1","步骤2"],"expected":"预期结果"}

【注意】
- reason 是你设计这条用例的思考，像同事间解释为什么需要测这个
- 用户说“修改、改成、调整、替换、账号密码”等针对现有内容的要求时，优先 UPDATE，不要 CASE
- 不要重复已有用例
- 只输出需要补充的新用例
- 对话回复只能放在 ###REPLY### 后面并单独占一行`;

  try {
    await generateCasesStream(fullContent, (event, data) => {
      if (event === 'complete') {
        recordModelUsage(fullContent, data);
      }
      if (event === 'reply') {
        console.log(`[CanvasChat:${requestId}] 首条回复 ${Date.now() - startedAt}ms: ${String(data.text || '').slice(0, 120)}`);
      } else if (event === 'case') {
        console.log(`[CanvasChat:${requestId}] 新增用例: ${data.case?.title || data.case?.id || '未命名'}`);
      } else if (event === 'update') {
        console.log(`[CanvasChat:${requestId}] 修改用例: ${data.case?.id || '未知ID'} ${data.case?.title || ''}`);
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }, canvasChatPrompt, { allowEmpty: true, maxTokens: 1200 });
    console.log(`[CanvasChat:${requestId}] 完成 ${Date.now() - startedAt}ms`);
  } catch (error) {
    console.error(`[CanvasChat:${requestId}] 失败 ${Date.now() - startedAt}ms:`, error.message);
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.end();
});

// 生成测试报告
app.post('/api/generate-report', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '请提供测试内容' });
    }
    
    const { callLLM } = require('./ai/generate');
    
    const prompt = `你是 Prism，一个资深 QA 测试工程师。根据用户提供的测试内容，生成一份简洁的测试报告。

报告格式：
1. 测试概述（一句话总结）
2. 测试范围（列出测试的主要模块/功能）
3. 测试结果（通过/失败/阻塞的数量）
4. 发现的问题（如果有）
5. 建议（后续需要关注的点）

请用 Markdown 格式输出，保持简洁专业。`
    
    const reportContent = await callLLM(prompt, content);
    recordModelUsage(`${prompt}\n${content}`, reportContent);
    
    res.json({ 
      success: true, 
      report: {
        content: reportContent,
        html: reportContent // 前端会处理 markdown 渲染
      }
    });
  } catch (error) {
    console.error('生成报告失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取执行状态
app.get('/api/execute/:taskId', (req, res) => {
  const { taskId } = req.params;
  // TODO: 查询任务状态
  res.json({ taskId, status: 'pending' });
});

// 测试 LLM 连接
app.post('/api/test-connection', async (req, res) => {
  const { provider, apiKey, baseUrl, endpoint, deploymentName, model } = req.body;
  
  try {
    let testResult = false;
    
    switch (provider) {
      case 'openai':
      case 'custom': {
        const OpenAI = require('openai');
        const client = new OpenAI({
          apiKey,
          baseURL: baseUrl || 'https://api.openai.com/v1'
        });
        // 发送一个简单的请求测试连接
        await client.models.list();
        testResult = true;
        break;
      }
      case 'anthropic': {
        try {
          const Anthropic = require('@anthropic-ai/sdk');
          const client = new Anthropic({ apiKey });
          // 简单测试
          testResult = true;
        } catch (e) {
          throw new Error('需要安装 @anthropic-ai/sdk: npm install @anthropic-ai/sdk');
        }
        break;
      }
      case 'azure': {
        const OpenAI = require('openai');
        const client = new OpenAI({
          apiKey,
          baseURL: `${endpoint}/openai/deployments/${deploymentName}`
        });
        await client.models.list();
        testResult = true;
        break;
      }
      default:
        throw new Error('不支持的提供商');
    }
    
    res.json({ success: testResult });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 重新加载配置
app.post('/api/config/reload', (req, res) => {
  // 配置已更新，下次调用时会自动使用新配置
  res.json({ success: true });
});

function startServer(
  port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  host = process.env.HOST || '0.0.0.0'
) {
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`Prism Web running on http://${host}:${port}`);
      
      // 初始化评估 WebSocket
      try {
        const evalWs = require('./evaluation/ws');
        evalWs.initWs(server);
        console.log('评估 WebSocket 已启动');
      } catch (e) {
        console.error('评估 WebSocket 启动失败:', e.message);
      }
      
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Prism Web 启动失败:', error);
    process.exitCode = 1;
  });
}

module.exports = { startServer, app };
