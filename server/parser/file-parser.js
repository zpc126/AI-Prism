// input: 上传的文件（PDF、DOCX、HTML、图片）
// output: 提取的文本内容
// position: 文件解析模块，支持 PDF、DOCX、HTML、表格、图片和文本

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 解析 PDF 文件
 */
async function parsePdf(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);

    return {
      type: 'pdf',
      text: data.text,
      pages: data.numpages,
      metadata: data.info || {},
    };
  } catch (error) {
    throw new Error(`PDF 解析失败: ${error.message}`);
  }
}

/**
 * 解析 DOCX 文件
 */
async function parseDocx(filePath) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });

    return {
      type: 'docx',
      text: result.value,
      warnings: result.messages || [],
    };
  } catch (error) {
    throw new Error(`DOCX 解析失败: ${error.message}`);
  }
}

/**
 * 解析 Excel/CSV 文件
 */
async function parseSpreadsheet(filePath) {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    
    const sheets = [];
    let allText = '';
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // 转换为文本
      const sheetText = jsonData
        .filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''))
        .map(row => row.join('\t'))
        .join('\n');
      
      sheets.push({
        name: sheetName,
        rows: jsonData.length,
        columns: jsonData[0]?.length || 0,
        data: jsonData,
        text: sheetText
      });
      
      allText += `【${sheetName}】\n${sheetText}\n\n`;
    }
    
    return {
      type: 'spreadsheet',
      text: allText.trim(),
      sheets,
      sheetNames: workbook.SheetNames
    };
  } catch (error) {
    throw new Error(`表格解析失败: ${error.message}`);
  }
}

/**
 * 解析图片文件（返回描述，需要多模态 LLM）
 */
async function parseImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const supportedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

  if (!supportedExts.includes(ext)) {
    throw new Error(`不支持的图片格式: ${ext}`);
  }

  // 读取图片为 base64
  const imageBuffer = fs.readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');
  const mimeType = getMimeType(ext);

  return {
    type: 'image',
    path: filePath,
    base64: `data:${mimeType};base64,${base64}`,
    mimeType,
    size: imageBuffer.length,
  };
}

/**
 * 解析纯文本文件
 */
function parseText(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  return {
    type: 'text',
    text: content,
    lines: content.split('\n').length,
  };
}

/**
 * 规范化可见文本
 */
function normalizeVisibleText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitVisibleText(value) {
  return normalizeVisibleText(value)
    .split(/\n+|(?<=。)|(?<=；)/)
    .map(line => normalizeVisibleText(line))
    .filter(Boolean);
}

function pushUnique(list, value, limit = 0) {
  const text = normalizeVisibleText(value);
  if (!text || text.length < 2) return;
  if (/^(确定|取消|返回|保存|提交)$/.test(text) && list.includes(text)) return;
  if (list.some(item => item === text)) return;
  list.push(limit > 0 && text.length > limit ? `${text.slice(0, limit)}...` : text);
}

function isNoiseText(text) {
  if (!text) return true;
  if (/^(javascript|resources\/|data\/|files\/|http|https|rgba?\(|#[0-9a-f]{3,8})/i.test(text)) return true;
  if (/^(px|auto|none|block|hidden|visible|absolute|relative|static)$/i.test(text)) return true;
  if (/^\d{1,4}$/.test(text)) return true;
  return false;
}

function formatSection(title, items, emptyText = '未识别到') {
  if (!items || items.length === 0) return `【${title}】\n- ${emptyText}`;
  return `【${title}】\n${items.map(item => `- ${item}`).join('\n')}`;
}

function buildHtmlTextSummary({ sourceName, title, metaDescription, headings, importantLines, formFields, actions, tables, bodyLines, isBundlePage = false }) {
  const lines = [];
  lines.push(isBundlePage ? `### ${sourceName || title || '未命名页面'}` : '【HTML需求结构化摘要】');
  if (!isBundlePage) {
    lines.push(`来源文件：${sourceName || '未知 HTML'}`);
    lines.push('解析说明：已过滤脚本、样式、布局节点，只保留页面标题、业务文案、表单、按钮、链接和表格线索。');
  }
  if (title) lines.push(`页面标题：${title}`);
  if (metaDescription) lines.push(`页面描述：${metaDescription}`);
  lines.push('');
  lines.push(formatSection('页面/模块层级', headings, title || '未识别到明确标题'));
  lines.push('');
  lines.push(formatSection('需求/业务规则线索', importantLines));
  lines.push('');
  lines.push(formatSection('表单字段', formFields));
  lines.push('');
  lines.push(formatSection('按钮/链接/操作入口', actions));
  lines.push('');
  lines.push(formatSection('表格/列表字段', tables));
  lines.push('');
  lines.push(formatSection('可见正文片段', bodyLines));

  const usableSignals = headings.length + importantLines.length + formFields.length + actions.length + tables.length + bodyLines.length;
  if (usableSignals < 12) {
    lines.push('');
    lines.push('【信息完整性提示】');
    lines.push('- 当前 HTML 可见需求信息偏少，生成用例时只覆盖已出现的模块和业务范围，不要臆造未出现的详细规则。');
    lines.push('- 如果这是 Axure/原型导出页，建议上传整个导出目录的 ZIP 包，单个 HTML 往往只包含当前页摘要。');
  }

  return lines.join('\n');
}

/**
 * 解析 HTML 内容，保留更适合生成测试用例的结构化信息
 */
function parseHtmlContent(content, sourceName = 'HTML 文档', options = {}) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(String(content || '').replace(/^\uFEFF/, ''));

    $('script, style, noscript, template, svg, canvas, iframe').remove();

    const title = normalizeVisibleText($('title').first().text());
    const metaDescription = normalizeVisibleText(
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    );

    const headings = [];
    const importantLines = [];
    const formFields = [];
    const actions = [];
    const tables = [];
    const bodyLines = [];

    const importantPattern = /(需求|范围|模块|功能|流程|规则|状态|权限|字段|校验|异常|边界|质检|售后|订单|下单|小程序|管理|新增|修改|删除|支持|优化|重构|审核|导入|导出|查询|筛选|提示|限制|配置|报表|报告|统计|支付|退款|库存|采购|供应商|门店|用户|角色)/;

    if (title) pushUnique(headings, title, 60);

    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const level = element.tagName ? element.tagName.toUpperCase() : 'H';
      pushUnique(headings, `${level} ${$(element).text()}`, 90);
    });

    // Axure/原型导出常用 ax_default + _标题 类表达标题。
    $('[class*="标题"], [class*="heading"], [class*="title"]').each((_, element) => {
      const text = normalizeVisibleText($(element).text());
      if (text) pushUnique(headings, text);
    });

    $('p, li, dd, dt, blockquote, [class*="text"], [id$="_text"]').each((_, element) => {
      splitVisibleText($(element).text()).forEach(line => {
        if (isNoiseText(line)) return;
        pushUnique(bodyLines, line);
        if (importantPattern.test(line)) pushUnique(importantLines, line);
      });
    });

    $('input, textarea, select').each((_, element) => {
      const $el = $(element);
      const id = $el.attr('id');
      const name = $el.attr('name');
      const type = ($el.attr('type') || element.tagName || '').toLowerCase();
      const label = normalizeVisibleText(
        (id ? $(`label[for="${id}"]`).first().text() : '') ||
        $el.closest('label').text() ||
        $el.attr('aria-label') ||
        $el.attr('placeholder') ||
        name ||
        id ||
        ''
      );
      if (!label || isNoiseText(label)) return;
      const required = $el.attr('required') !== undefined ? '，必填' : '';
      const placeholder = normalizeVisibleText($el.attr('placeholder'));
      const optionTexts = element.tagName?.toLowerCase() === 'select'
        ? $el.find('option').map((__, option) => normalizeVisibleText($(option).text())).get().filter(Boolean)
        : [];
      const optionText = optionTexts.length ? `，选项：${optionTexts.join('/')}` : '';
      const placeholderText = placeholder && placeholder !== label ? `，占位：${placeholder}` : '';
      pushUnique(formFields, `${label}（${type || '字段'}${required}${placeholderText}${optionText}）`);
    });

    $('button, a, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]').each((_, element) => {
      const $el = $(element);
      const text = normalizeVisibleText($el.text() || $el.attr('value') || $el.attr('aria-label') || $el.attr('title') || '');
      if (!text || isNoiseText(text)) return;
      const href = normalizeVisibleText($el.attr('href'));
      const hrefText = href && !href.startsWith('#') ? ` -> ${href}` : '';
      pushUnique(actions, `${text}${hrefText}`);
    });

    $('table').each((index, table) => {
      const $table = $(table);
      const rows = $table.find('tr').map((_, tr) => {
        return $(tr).find('th,td').map((__, cell) => normalizeVisibleText($(cell).text())).get().filter(Boolean);
      }).get().filter(row => Array.isArray(row) && row.length > 0);
      if (rows.length === 0) return;
      const header = rows.find(row => row.length >= 2) || rows[0];
      const text = header.join(' / ');
      if (text && !isNoiseText(text)) pushUnique(tables, `表格${index + 1}：${text}`);
    });

    if (bodyLines.length === 0) {
      splitVisibleText($('body').text()).forEach(line => {
        if (!isNoiseText(line)) pushUnique(bodyLines, line);
      });
    }

    const text = buildHtmlTextSummary({
      sourceName,
      title,
      metaDescription,
      headings,
      importantLines,
      formFields,
      actions,
      tables,
      bodyLines,
      isBundlePage: options.isBundlePage,
    });

    return {
      type: 'html',
      text,
      title,
      lines: bodyLines.length,
      summary: {
        headings: headings.length,
        importantLines: importantLines.length,
        formFields: formFields.length,
        actions: actions.length,
        tables: tables.length,
      },
    };
  } catch (error) {
    throw new Error(`HTML 解析失败: ${error.message}`);
  }
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

async function renderHtmlScreenshot(filePath) {
  let browser = null;
  try {
    const { chromium } = require('playwright');
    const executablePath = resolveChromeExecutable();
    const launchOptions = {
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-web-security'],
    };
    if (executablePath) launchOptions.executablePath = executablePath;

    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      deviceScaleFactor: 1,
    });

    await page.goto(`file://${path.resolve(filePath)}`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(500);

    const size = await page.evaluate(() => ({
      width: Math.max(document.documentElement.scrollWidth || 0, document.body?.scrollWidth || 0, 1440),
      height: Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0, 900),
    }));
    const width = Math.min(Math.max(size.width, 1024), 1800);
    const height = Math.min(Math.max(size.height, 900), 5000);
    await page.setViewportSize({ width, height });

    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 92,
      fullPage: true,
      timeout: 20000,
    });

    return {
      base64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      screenshot: {
        mimeType: 'image/jpeg',
        size: buffer.length,
        width,
        height,
      },
    };
  } catch (error) {
    return { renderError: error.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * 解析 HTML 文件
 */
async function parseHtml(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseHtmlContent(content, path.basename(filePath));
  const rendered = await renderHtmlScreenshot(filePath);
  return {
    ...parsed,
    ...rendered,
    visionInput: Boolean(rendered.base64),
    visionSource: 'html-screenshot',
    textFallback: parsed.text,
  };
}

/**
 * 解析 HTML/原型导出 ZIP 包
 */
async function parseZipArchive(filePath) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const htmlFiles = Object.values(zip.files)
      .filter(file => !file.dir && /\.html?$/i.test(file.name))
      .filter(file => !/(^|\/)(resources|__MACOSX)\//i.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    if (htmlFiles.length === 0) {
      throw new Error('ZIP 中没有找到 HTML 页面');
    }

    let rendered = {};
    let tempDir = '';
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-html-'));
      for (const file of Object.values(zip.files)) {
        if (file.dir) continue;
        const targetPath = path.normalize(path.join(tempDir, file.name));
        if (!targetPath.startsWith(tempDir)) continue;
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, await file.async('nodebuffer'));
      }
      const mainHtml = htmlFiles.find(file => /(^|\/)(index|home|start|main)\.html?$/i.test(file.name)) || htmlFiles[0];
      rendered = await renderHtmlScreenshot(path.join(tempDir, mainHtml.name));
      if (rendered.base64) {
        rendered.renderedPage = mainHtml.name;
      }
    } catch (error) {
      rendered = { renderError: error.message };
    } finally {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const pages = [];
    for (const file of htmlFiles) {
      const content = await file.async('string');
      const parsed = parseHtmlContent(content, file.name, { isBundlePage: true });
      pages.push({
        name: file.name,
        title: parsed.title,
        text: parsed.text,
        summary: parsed.summary,
      });
    }

    const text = [
      '【HTML原型包结构化摘要】',
      `来源文件：${path.basename(filePath)}`,
      `页面数量：${htmlFiles.length}`,
      '解析说明：已按页面抽取标题、业务文案、表单、按钮、链接和表格字段；生成用例时应按页面/模块组织，不要按 HTML 文件名机械分类。',
      '',
      ...pages.map(page => page.text),
    ].join('\n\n');

    return {
      type: 'html_bundle',
      text,
      ...rendered,
      visionInput: Boolean(rendered.base64),
      visionSource: 'html-bundle-screenshot',
      textFallback: text,
      files: htmlFiles.length,
      parsedFiles: pages.length,
      pages: pages.map(page => ({
        name: page.name,
        title: page.title,
        summary: page.summary,
      })),
    };
  } catch (error) {
    throw new Error(`ZIP 解析失败: ${error.message}`);
  }
}

/**
 * 根据文件扩展名选择解析器
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await parsePdf(filePath);
    case '.docx':
    case '.doc':
      return await parseDocx(filePath);
    case '.xlsx':
    case '.xls':
    case '.csv':
      return await parseSpreadsheet(filePath);
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.bmp':
      return await parseImage(filePath);
    case '.txt':
    case '.md':
    case '.markdown':
      return parseText(filePath);
    case '.html':
    case '.htm':
      return await parseHtml(filePath);
    case '.zip':
      return await parseZipArchive(filePath);
    default:
      throw new Error(`不支持的文件格式: ${ext}`);
  }
}

/**
 * 获取 MIME 类型
 */
function getMimeType(ext) {
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 检查文件是否支持
 */
function isSupportedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const supportedExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.txt', '.md', '.html', '.htm', '.zip'];
  return supportedExts.includes(ext);
}

/**
 * 获取文件类型描述
 */
function getFileTypeDesc(filename) {
  const ext = path.extname(filename).toLowerCase();
  const descMap = {
    '.pdf': 'PDF 文档',
    '.docx': 'Word 文档',
    '.doc': 'Word 文档',
    '.xlsx': 'Excel 表格',
    '.xls': 'Excel 表格',
    '.csv': 'CSV 文件',
    '.png': 'PNG 图片',
    '.jpg': 'JPEG 图片',
    '.jpeg': 'JPEG 图片',
    '.gif': 'GIF 图片',
    '.webp': 'WebP 图片',
    '.txt': '纯文本',
    '.md': 'Markdown 文档',
    '.html': 'HTML 文档',
    '.htm': 'HTML 文档',
    '.zip': 'HTML 原型包',
  };
  return descMap[ext] || '未知格式';
}

module.exports = {
  parseFile,
  parsePdf,
  parseDocx,
  parseSpreadsheet,
  parseImage,
  parseText,
  parseHtml,
  parseHtmlContent,
  parseZipArchive,
  isSupportedFile,
  getFileTypeDesc,
};
