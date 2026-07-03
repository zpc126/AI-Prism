// input: dotenv、express、业务路由、Web 静态资源、图片 base64 请求、分析报告分享请求
// output: Prism Web 页面、HTTP API、WebSocket 服务、分析报告分享页
// position: Web 应用服务入口，支持文档、图片需求分析与报告分享

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
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { loadConfig, saveWebConfig } = require('./config');
const { generateCases, generateCasesStream, analyzeRequirement, analyzeRequirementStream, callLLM, understandImage, extractRequirementFromImage } = require('./ai/generate');
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
let deviceRoutes;
let gitlabRoutes;

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

try {
  deviceRoutes = require('./device/routes');
} catch (e) {
  console.error('设备路由加载失败:', e.message);
  deviceRoutes = express.Router();
}

try {
  gitlabRoutes = require('./integrations/gitlab/routes');
} catch (e) {
  console.error('GitLab 路由加载失败:', e.message);
  gitlabRoutes = express.Router();
}

let piRoutes;
try {
  piRoutes = require('./pi/routes');
} catch (e) {
  console.error('PI Agent 路由加载失败:', e.message);
  piRoutes = express.Router();
}

const app = express();
const ANALYSIS_REPORT_DIR = path.join(__dirname, '../data/analysis-reports');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAnalysisReportPath(id) {
  return path.join(ANALYSIS_REPORT_DIR, `${id}.json`);
}

function renderList(items = [], emptyText = '暂无') {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="muted">${emptyText}</p>`;
  }
  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function normalizeSharedAnalysisReport(input = {}) {
  const id = String(input.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    id,
    title: input.title || '需求分析报告',
    createdAt: input.createdAt || input.time || input.date || new Date().toISOString(),
    summary: input.summary || input.report?.summary || '',
    requirement: input.requirement || input.source || '',
    plainText: input.plainText || input.content || input.text || '',
    report: input.report && typeof input.report === 'object' ? input.report : {}
  };
}

function renderAnalysisReportHtml(input) {
  const saved = normalizeSharedAnalysisReport(input);
  const report = saved.report || {};
  const risks = (report.cases || []).filter(item => item.category !== '待确认');
  const questions = Array.isArray(report.questions) && report.questions.length
    ? report.questions
    : (report.cases || []).filter(item => item.category === '待确认').map(item => item.title);
  const modules = Array.isArray(report.modules) ? report.modules : [];
  const testScope = report.testScope || {};
  const acceptance = Array.isArray(report.acceptance) ? report.acceptance : [];
  const testStrategy = Array.isArray(report.testStrategy) ? report.testStrategy : [];
  const hasStructuredReport = Boolean(report.summary || modules.length || risks.length || questions.length || acceptance.length || testStrategy.length || testScope.inScope?.length || testScope.outOfScope?.length);
  const section = (title, body) => `<section class="section"><h2>${title}</h2>${body}</section>`;
  const categoryClasses = {
    '边界未定义': 'tag-amber',
    '逻辑漏洞': 'tag-red',
    '歧义描述': 'tag-orange',
    '遗漏场景': 'tag-purple',
    '数据风险': 'tag-cyan',
    '技术风险': 'tag-blue',
    '体验问题': 'tag-green',
    '格式异常': 'tag-amber'
  };
  const priorityClasses = {
    P0: 'priority-high',
    P1: 'priority-high',
    P2: 'priority-mid',
    P3: 'priority-low'
  };
  const modulesHtml = modules.length ? modules.map(module => `
    <article class="module-card">
      <div class="module-head"><h3>${escapeHtml(module.name || '未命名模块')}</h3><span>模块</span></div>
      ${module.goal ? `<p>${escapeHtml(module.goal)}</p>` : ''}
      <div class="module-grid">
        <div><h4>关键流程</h4>${renderList(module.flows || [], '暂无流程')}</div>
        <div><h4>业务规则</h4>${renderList(module.rules || [], '暂无规则')}</div>
        <div><h4>数据/权限</h4>${renderList(module.data || [], '暂无数据点')}</div>
      </div>
    </article>
  `).join('') : section('模块拆解', '<p class="muted">模型未识别到明确模块。</p>');
  const risksHtml = risks.length ? risks.map(item => {
    const tagClass = categoryClasses[item.category] || 'tag-zinc';
    const priorityClass = priorityClasses[item.priority] || 'priority-mid';
    return `
      <article class="risk-card ${tagClass}">
        <div class="risk-title">
          <span class="risk-tag ${tagClass}">${escapeHtml(item.category || '风险')}</span>
          <span class="priority-tag ${priorityClass}">${escapeHtml(item.priority || 'P1')}</span>
          <strong>${escapeHtml(item.title || '')}</strong>
        </div>
        ${item.steps?.[0] ? `<p>${escapeHtml(item.steps[0])}</p>` : ''}
        ${item.expected ? `<p><em>建议：</em>${escapeHtml(item.expected)}</p>` : ''}
        ${item.testFocus ? `<p class="focus"><em>测试关注：</em>${escapeHtml(item.testFocus)}</p>` : ''}
      </article>
    `;
  }).join('') : '<p class="muted">暂未识别到高风险问题。</p>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(saved.title || '需求分析报告')} - Prism</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f6f7; color: #27272a; font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif; }
    .page { max-width: 1040px; margin: 0 auto; padding: 48px 24px; }
    .header { background: #fff; border: 1px solid #e4e4e7; border-radius: 24px; padding: 28px; box-shadow: 0 18px 50px rgba(24,24,27,.06); }
    .brand { color: #71717a; font-size: 13px; margin-bottom: 12px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: -0.04em; }
    .meta { margin-top: 10px; color: #a1a1aa; font-size: 13px; }
    .summary { margin-top: 22px; padding: 18px; border-radius: 18px; background: #18181b; color: #fafafa; line-height: 1.8; }
    .content { margin-top: 18px; display: grid; gap: 14px; }
    .section, .module-card, .risk-card { background: #fff; border: 1px solid #ececef; border-radius: 18px; padding: 18px; }
    h2 { margin: 0 0 12px; font-size: 15px; letter-spacing: -0.02em; }
    h3 { margin: 0; font-size: 15px; }
    h4 { margin: 0 0 8px; font-size: 12px; color: #71717a; }
    p, li { font-size: 13px; line-height: 1.8; color: #52525b; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.8 -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif; color: #52525b; }
    ul { margin: 0; padding-left: 18px; }
    .module-head, .risk-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .module-head span, .risk-title span { font-size: 11px; padding: 2px 7px; border-radius: 999px; }
    .risk-card { border-left-width: 4px; }
    .risk-card.tag-amber { border-left-color: #f59e0b; }
    .risk-card.tag-red { border-left-color: #ef4444; }
    .risk-card.tag-orange { border-left-color: #f97316; }
    .risk-card.tag-purple { border-left-color: #a855f7; }
    .risk-card.tag-cyan { border-left-color: #06b6d4; }
    .risk-card.tag-blue { border-left-color: #3b82f6; }
    .risk-card.tag-green { border-left-color: #22c55e; }
    .risk-card.tag-zinc { border-left-color: #a1a1aa; }
    .risk-tag.tag-amber { background: #fef3c7; color: #b45309; }
    .risk-tag.tag-red { background: #fee2e2; color: #dc2626; }
    .risk-tag.tag-orange { background: #ffedd5; color: #ea580c; }
    .risk-tag.tag-purple { background: #f3e8ff; color: #9333ea; }
    .risk-tag.tag-cyan { background: #cffafe; color: #0891b2; }
    .risk-tag.tag-blue { background: #dbeafe; color: #2563eb; }
    .risk-tag.tag-green { background: #dcfce7; color: #16a34a; }
    .risk-tag.tag-zinc { background: #f4f4f5; color: #71717a; }
    .priority-tag.priority-high { background: #fee2e2; color: #dc2626; }
    .priority-tag.priority-mid { background: #fef3c7; color: #b45309; }
    .priority-tag.priority-low { background: #f4f4f5; color: #71717a; }
    .module-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .focus { color: #2563eb; }
    .muted { color: #a1a1aa; }
    .footer { margin-top: 18px; color: #a1a1aa; font-size: 12px; text-align: center; }
    @media (max-width: 760px) { .module-grid { grid-template-columns: 1fr; } .page { padding: 24px 14px; } }
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div class="brand">Prism · 需求分析报告</div>
      <h1>${escapeHtml(saved.title || '需求分析报告')}</h1>
      <div class="meta">${escapeHtml(saved.createdAt ? new Date(saved.createdAt).toLocaleString('zh-CN') : '')} · ${modules.length} 个模块 · ${risks.length} 个风险 · ${questions.length} 个问题</div>
      ${report.summary ? `<div class="summary">${escapeHtml(report.summary)}</div>` : ''}
    </header>
    <div class="content">
      ${hasStructuredReport ? `
        ${modulesHtml}
        ${section('风险与测试关注', risksHtml)}
        <div class="module-grid">
          ${section('建议覆盖', renderList(testScope.inScope || []))}
          ${section('暂不覆盖/需确认', renderList(testScope.outOfScope || []))}
        </div>
        ${section('待确认问题', renderList(questions, '暂无待确认问题'))}
        ${section('验收标准', renderList(acceptance, '暂无验收标准'))}
        ${section('测试策略', renderList(testStrategy, '暂无测试策略'))}
      ` : section('报告内容', `<pre>${escapeHtml(saved.plainText || saved.summary || '这是一份旧版历史报告，暂无结构化内容。')}</pre>`)}
    </div>
    <div class="footer">由 Prism 生成 · 分享链接可直接打开查看</div>
  </main>
</body>
</html>`;
}

app.use(cors());
app.use(express.json({ limit: '500mb' }));

// 静态文件服务
app.use(express.static(path.join(__dirname, '../src'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

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

// Android 真机设备管理
app.use('/api/device', deviceRoutes);

// GitLab Issue 集成
app.use('/api/gitlab', gitlabRoutes);

// PI Agent 路由
app.use('/api/pi', piRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 需求分析报告分享
app.post('/api/analysis-reports', (req, res) => {
  try {
    const report = normalizeSharedAnalysisReport(req.body?.report || {});
    fs.mkdirSync(ANALYSIS_REPORT_DIR, { recursive: true });
    const saved = { ...report, sharedAt: new Date().toISOString() };
    fs.writeFileSync(getAnalysisReportPath(saved.id), JSON.stringify(saved, null, 2), 'utf-8');
    res.json({ success: true, id: saved.id, url: `/analysis-reports/${saved.id}` });
  } catch (error) {
    console.error('保存分析报告失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/analysis-reports/:id', (req, res) => {
  try {
    const safeId = String(req.params.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = getAnalysisReportPath(safeId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('分析报告不存在或已被清理');
    }
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderAnalysisReportHtml(saved));
  } catch (error) {
    console.error('读取分析报告失败:', error);
    res.status(500).send('分析报告读取失败');
  }
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
    limit: Number.MAX_SAFE_INTEGER,
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
    const { imageBase64, contextText = '', sourceType = '', filename = '' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: '请提供图片' });
    }
    const result = await extractRequirementFromImage(imageBase64, { contextText, sourceType, filename });
    res.json({ success: true, requirement: result });
  } catch (error) {
    console.error('需求提取失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 生成用例 - 普通模式
app.post('/api/generate-cases', async (req, res) => {
  try {
    let { content, productName = '', format = 'text', mode = 'cases', visionFiles = [] } = req.body;
    if (!content && (!Array.isArray(visionFiles) || visionFiles.length === 0)) {
      return res.status(400).json({ success: false, error: '请提供需求内容' });
    }
    content = content || '用户上传了视觉需求材料，请直接阅读图片/原型截图生成结果。';
    
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
      const analysis = await analyzeRequirement(enrichedContent, { visionFiles });
      recordModelUsage(enrichedContent, analysis);
      res.json({ success: true, cases: analysis, scraped: scrapedMeta });
    } else {
      const generationContent = productName
        ? `【一级产品名称】${productName}\n【需求内容】\n${content}`
        : content;
      const enrichedContent = appendHistoricalCaseKnowledge(generationContent);
      const cases = await generateCases(enrichedContent, { format, visionFiles });
      recordModelUsage(enrichedContent, cases);
      incrementStat(mode === 'regression' ? 'regression_cases' : 'generated_cases', countCases(cases));
      res.json({ success: true, cases, scraped: scrapedMeta });
    }
  } catch (error) {
    console.error('生成用例失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 需求分析 - 流式模式
app.post('/api/analyze-requirement-stream', async (req, res) => {
  let { content, productName = '', visionFiles = [] } = req.body;
  if (!content && (!Array.isArray(visionFiles) || visionFiles.length === 0)) {
    return res.status(400).json({ success: false, error: '请提供需求内容' });
  }
  content = content || '用户上传了视觉需求材料，请直接阅读图片/原型截图进行需求分析。';

  if (isUrlInput(content)) {
    try {
      const scraped = await scrapeUrl(content);
      content = scraped.content;
      console.log(`[URL] 流式需求分析，已抓取: ${scraped.title}`);
    } catch (e) {
      console.error('[URL] 抓取失败，使用原始输入:', e.message);
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  let responseFinished = false;
  res.on('close', () => {
    if (!responseFinished) {
      console.log('[分析] 客户端连接关闭，停止模型分析');
      controller.abort();
    }
  });

  try {
    const analysisContent = productName
      ? `【产品/模块名称】${productName}\n【需求内容】\n${content}`
      : content;
    const enrichedContent = appendHistoricalCaseKnowledge(analysisContent);
    await analyzeRequirementStream(enrichedContent, (event, data) => {
      if (event === 'complete') {
        recordModelUsage(enrichedContent, data.cases || []);
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }, { signal: controller.signal, visionFiles });
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[分析] 模型分析已取消');
    } else {
      console.error('流式需求分析失败:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  } finally {
    responseFinished = true;
  }

  res.end();
});

// 生成用例 - 流式模式
app.post('/api/generate-cases-stream', async (req, res) => {
  let { content, productName = '', visionFiles = [] } = req.body;
  if (!content && (!Array.isArray(visionFiles) || visionFiles.length === 0)) {
    return res.status(400).json({ success: false, error: '请提供需求内容' });
  }
  content = content || '用户上传了视觉需求材料，请直接阅读图片/原型截图生成测试用例。';
  
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
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

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
    }, null, { visionFiles });
  } catch (error) {
    console.error('流式生成失败:', error);
    // 降级到普通模式
    try {
      const generationContent = productName
        ? `【一级产品名称】${productName}\n【需求内容】\n${content}`
        : content;
      const enrichedContent = appendHistoricalCaseKnowledge(generationContent);
      const cases = await generateCases(enrichedContent, { visionFiles });
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
      
      res.write(`event: complete\ndata: ${JSON.stringify({ success: !result.stopped, ...result })}\n\n`);
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
    res.write(`event: complete\ndata: ${JSON.stringify({ success: !result.stopped && result.failed === 0, ...result })}\n\n`);
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
  const writeSse = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  writeSse('progress', { message: '消息已收到，正在连接模型...' });

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
    `${item.role === 'assistant' ? 'Prism' : '用户'}：${String(item.content || '')}`
  ).join('\n');

  const wantsConcreteChanges = /补一下|加一下|补充|补上|新增|生成|加点|添加|完善|落到导图|改导图|更新导图/.test(String(message));
  const lastAssistant = [...(history || [])].reverse().find(item => item.role === 'assistant' && item.content);
  const forbiddenModules = [...String(message).matchAll(/不在([^，。,. ]+)/g)].map(match => match[1]);
  const fullContent = `${historySummary ? `最近对话：\n${historySummary}\n\n` : ''}当前模块：${selectedCategory || '全部'}
相关测试用例（仅供参考）：\n${caseSummary || '无'}

用户最新消息：${message}
${wantsConcreteChanges ? '\n执行要求：用户本轮要把内容落到导图，必须输出 ###CASE### 或 ###UPDATE###，不能只回复建议。' : ''}`;
  console.log(`[CanvasChat:${requestId}] 开始 model-context cases=${relevantCases.length}/${cases?.length || 0} history=${history?.length || 0} message=${String(message).slice(0, 80)}`);
  const isForbiddenCategory = (name) => Boolean(name && forbiddenModules.some(item => name.includes(item) || item.includes(name)));
  const inferFallbackCategory = () => {
    const contextText = `${message}\n${lastAssistant?.content || ''}`;
    const bracketCandidates = [...contextText.matchAll(/【([^】]{2,30})】/g)].map(match => match[1]);
    const mentioned = relevantCases.find(item => item.category && contextText.includes(item.category));
    const byHistory = relevantCases.find(item => item.category && String(lastAssistant?.content || '').includes(item.category));
    const candidates = [
      ...bracketCandidates,
      mentioned?.category,
      byHistory?.category,
      selectedCategory,
      relevantCases[0]?.category,
      '未分类'
    ].filter(Boolean);
    return candidates.find(name => !isForbiddenCategory(name)) || '未分类';
  };
  const buildFallbackCasesFromReply = (replyText) => {
    if (!wantsConcreteChanges || !replyText) return [];
    const category = inferFallbackCategory();
    if (isForbiddenCategory(category)) return [];
    const parts = String(replyText)
      .split(/(?:\d+[）.)、]|[；;。]\s*)/)
      .map(item => item.replace(/^[-\s]+/, '').trim())
      .filter(item => item.length >= 8)
      ;
    return parts.map((text, index) => ({
      category,
      id: `AI-${Date.now()}-${index + 1}`,
      title: text,
      priority: index === 0 ? 'P1' : 'P2',
      reason: '用户要求补充',
      steps: [
        '打开测试入口',
        `进入${category}`,
        `验证${text}`
      ],
      expected: `${text}展示或流转符合需求`
    }));
  };
  const heartbeatMessages = [
    '正在读取完整用例上下文...',
    '正在等待模型生成回复...',
    '模型仍在分析，结果出来会马上显示...',
    '完整上下文较大，仍在处理中...'
  ];
  const heartbeatTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const index = Math.min(heartbeatMessages.length - 1, Math.floor(elapsed / 8));
    writeSse('progress', {
      message: heartbeatMessages[index],
      elapsed,
      cases: relevantCases.length,
      history: history?.length || 0
    });
  }, 2500);

  // 协作对话 prompt：先回复用户，再输出需要补充的用例
  const canvasChatPrompt = `你是 Prism，一个资深 QA 测试工程师，正在和用户一起协作完善测试用例。

用户会告诉你哪里需要调整。你需要：
1. 第一行必须用 ###REPLY### 开头，紧跟一句简短回复，格式：###REPLY###我明白了，我来按你的要求调整。
2. 如果需要补充用例，用 ###CASE### 格式逐条输出新用例
3. 如果用户要求修改已有用例，必须根据已有用例 id 输出 ###UPDATE###，直接修改原用例，禁止新增一条相似用例
4. 如果用户只是闲聊或确认，只回复对话，不用输出用例
5. 如果用户问“还差哪些、怎么看、建议补什么”，用 ###REPLY### 给出具体建议，可以列出建议项，但不要输出空内容
6. 如果用户说“补一下、加一下、补充、把刚才说的补上、那你补、新增、添加、完善”，必须输出至少 1 条 ###CASE### 或 ###UPDATE###，不能只回复文字
7. 如果用户说“不在某模块”，禁止放到该模块，要结合最近对话判断正确模块；如果无法判断，就放到最相关的现有模块并在 REPLY 里说明

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
- 只输出需要补充的新用例；但用户明确要求“补/加/新增/完善”时，必须输出可落导图的 CASE 或 UPDATE
- 对话回复只能放在 ###REPLY### 后面并单独占一行
- 无论是否修改用例，都必须至少输出一行 ###REPLY###`;

  try {
    let emittedMeaningfulEvent = false;
    let emittedMutation = false;
    let lastReplyText = '';
    let latestComplete = null;
    await generateCasesStream(fullContent, (event, data) => {
      if (event === 'complete') {
        latestComplete = data || null;
        recordModelUsage(fullContent, data);
        return;
      }
      if (event === 'reply') {
        emittedMeaningfulEvent = true;
        lastReplyText = data.text || '';
        console.log(`[CanvasChat:${requestId}] 首条回复 ${Date.now() - startedAt}ms: ${String(data.text || '').slice(0, 120)}`);
      } else if (event === 'case') {
        emittedMeaningfulEvent = true;
        emittedMutation = true;
        console.log(`[CanvasChat:${requestId}] 新增用例: ${data.case?.title || data.case?.id || '未命名'}`);
      } else if (event === 'update') {
        emittedMeaningfulEvent = true;
        emittedMutation = true;
        console.log(`[CanvasChat:${requestId}] 修改用例: ${data.case?.id || '未知ID'} ${data.case?.title || ''}`);
      }
      writeSse(event, data);
    }, canvasChatPrompt, { allowEmpty: true });
    if (wantsConcreteChanges && !emittedMutation) {
      const fallbackCases = buildFallbackCasesFromReply(lastReplyText || latestComplete?.rawTextPreview || message);
      fallbackCases.forEach(caseData => {
        emittedMeaningfulEvent = true;
        emittedMutation = true;
        console.log(`[CanvasChat:${requestId}] 兜底生成用例: ${caseData.title}`);
        writeSse('case', { case: caseData });
      });
      if (fallbackCases.length) {
        writeSse('reply', { text: `已根据刚才的建议补充 ${fallbackCases.length} 条用例到「${fallbackCases[0].category}」。` });
      }
    }
    if (!emittedMeaningfulEvent) {
      const fallbackReply = '我收到了，但这次没有解析到可以直接应用到导图的修改，当前用例先保持不变。你可以再发一次，我会继续处理。';
      console.log(`[CanvasChat:${requestId}] 空回复兜底 ${Date.now() - startedAt}ms`);
      if (latestComplete?.rawTextPreview) {
        console.log(`[CanvasChat:${requestId}] 模型原文预览: ${latestComplete.rawTextPreview.replace(/\s+/g, ' ').slice(0, 500)}`);
      }
      writeSse('reply', { text: fallbackReply });
    }
    writeSse('complete', { success: true });
    console.log(`[CanvasChat:${requestId}] 完成 ${Date.now() - startedAt}ms`);
  } catch (error) {
    console.error(`[CanvasChat:${requestId}] 失败 ${Date.now() - startedAt}ms:`, error.message);
    writeSse('error', { error: error.message });
    writeSse('complete', { success: false });
  } finally {
    clearInterval(heartbeatTimer);
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

function getChatCompletionsRequestUrl(baseUrl, requestUrl) {
  const manual = String(requestUrl || '').trim();
  if (manual) return manual;
  const normalized = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function getAnthropicMessagesRequestUrl(baseUrl, requestUrl) {
  const manual = String(requestUrl || '').trim();
  if (manual) return manual;
  const normalized = String(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  if (/\/messages$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

// 测试 LLM 连接
app.post('/api/test-connection', async (req, res) => {
  const { provider, apiKey, baseUrl, requestUrl, endpoint, deploymentName, model } = req.body;
  
  try {
    let testResult = false;
    
    switch (provider) {
      case 'openai':
      case 'custom': {
        const normalizedBaseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const finalRequestUrl = getChatCompletionsRequestUrl(normalizedBaseUrl, requestUrl);
        if (!model) throw new Error('请填写模型名称');
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        };
        if (normalizedBaseUrl.includes('mimo') || normalizedBaseUrl.includes('xiaomi')) {
          headers['api-key'] = apiKey;
        }
        const response = await fetch(finalRequestUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0
          })
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
        }
        testResult = true;
        break;
      }
      case 'anthropic': {
        if (!model) throw new Error('请填写模型名称');
        const finalRequestUrl = getAnthropicMessagesRequestUrl(baseUrl, requestUrl);
        const response = await fetch(finalRequestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }]
          })
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
        }
        testResult = true;
        break;
      }
      case 'azure': {
        if (!endpoint || !deploymentName) throw new Error('请填写 Azure Endpoint 和 Deployment Name');
        const normalizedEndpoint = endpoint.replace(/\/+$/, '');
        const response = await fetch(`${normalizedEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0
          })
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
        }
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
    const useHttps = process.env.HTTPS === '1' || process.env.HTTPS === 'true';
    const protocol = useHttps ? 'https' : 'http';
    let server;
    const onListen = () => {
      console.log(`Prism Web running on ${protocol}://${host}:${port}`);
      if (useHttps && host === '0.0.0.0') {
        console.log(`Local HTTPS URL: https://localhost:${port}`);
      }
      
      // 初始化评估 WebSocket
      try {
        const evalWs = require('./evaluation/ws');
        evalWs.initWs(server);
        console.log('评估 WebSocket 已启动');
      } catch (e) {
        console.error('评估 WebSocket 启动失败:', e.message);
      }

      try {
        const { initBrowserScrcpyWs } = require('./device/scrcpy-browser');
        initBrowserScrcpyWs(server);
        console.log('Android 浏览器投屏 WebSocket 已启动');
      } catch (e) {
        console.error('Android 浏览器投屏 WebSocket 启动失败:', e.message);
      }
      
      resolve(server);
    };

    if (useHttps) {
      const keyPath = process.env.SSL_KEY || path.join(__dirname, '../certs/localhost-key.pem');
      const certPath = process.env.SSL_CERT || path.join(__dirname, '../certs/localhost-cert.pem');
      if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        throw new Error(`HTTPS 证书不存在，请先执行 npm run cert:local 或配置 SSL_KEY/SSL_CERT。缺少：${keyPath} ${certPath}`);
      }
      server = https.createServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }, app).listen(port, host, onListen);
      return;
    }

    server = app.listen(port, host, onListen);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Prism Web 启动失败:', error);
    process.exitCode = 1;
  });
}

module.exports = { startServer, app };
