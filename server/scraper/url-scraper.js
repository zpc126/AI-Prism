// input: URL 字符串
// output: { title, content, images[], type }
// position: URL 内容抓取模块，支持飞书/Notion/通用网页

const cheerio = require('cheerio');
const { chromium } = require('playwright');

// 通用 fetch（兼容 node-fetch 和内置 fetch）
function getFetch() {
  return typeof fetch !== 'undefined' ? fetch : require('node-fetch');
}

// 浏览器实例（懒加载，复用）
let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

/**
 * 检测 URL 类型
 */
function detectUrlType(url) {
  const u = url.toLowerCase();
  if (u.includes('feishu.cn') || u.includes('larksuite.com')) return 'feishu';
  if (u.includes('notion.so') || u.includes('notion.site')) return 'notion';
  if (u.includes('yuque.com')) return 'yuque';
  if (u.includes('docs.google.com')) return 'google-docs';
  if (u.includes('figma.com')) return 'figma';
  if (u.includes('confluence')) return 'confluence';
  return 'generic';
}

/**
 * 通用网页抓取
 */
async function scrapeGeneric(url) {
  const fetchFn = getFetch();
  
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
    timeout: 15000,
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const html = await response.text();
  const $ = cheerio.load(html);
  
  // 移除无用元素
  $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], [role="banner"]').remove();
  $('.sidebar, .menu, .nav, .footer, .header, .ad, .advertisement').remove();
  
  // 提取标题
  const title = $('title').text().trim() 
    || $('h1').first().text().trim() 
    || $('meta[property="og:title"]').attr('content') 
    || '';
  
  // 提取正文（优先用 article/main，降级到 body）
  let content = '';
  
  // 尝试 article 标签
  const article = $('article').first();
  if (article.length) {
    content = article.text();
  }
  
  // 尝试 main 标签
  if (!content.trim()) {
    const main = $('main').first();
    if (main.length) {
      content = main.text();
    }
  }
  
  // 尝试 .content / .post-content / .article-content
  if (!content.trim()) {
    const selectors = ['.content', '.post-content', '.article-content', '.entry-content', '.markdown-body', '#content'];
    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 100) {
        content = el.text();
        break;
      }
    }
  }
  
  // 降级到 body
  if (!content.trim()) {
    content = $('body').text();
  }
  
  // 清理文本
  content = content
    .replace(/\s+/g, ' ')           // 合并空白
    .replace(/\n\s*\n/g, '\n')      // 合并空行
    .replace(/\t/g, ' ')            // Tab 转空格
    .trim();
  
  // 提取图片
  const images = [];
  $('img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    const alt = $(el).attr('alt') || '';
    if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
      const fullUrl = src.startsWith('http') ? src : new URL(src, url).href;
      images.push({ url: fullUrl, alt });
    }
  });
  
  return {
    title,
    content,
    images,
    type: 'webpage',
    url,
  };
}

/**
 * 飞书文档抓取
 * 飞书文档需要 JS 渲染，使用 playwright 抓取
 */
async function scrapeFeishu(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    console.log(`[Scraper] 开始抓取飞书文档: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // 等待内容加载
    await page.waitForTimeout(3000);
    
    // 提取内容
    const result = await page.evaluate(() => {
      // 飞书文档内容容器
      const selectors = [
        '.doc-content',
        '.wiki-content',
        '[data-testid="doc-content"]',
        '.lark-doc-content',
        '.doc-block-container',
        '.ne-doc-container',
        '.ne-doc-major-editor',
        '.doc-main',
        'article',
        'main',
      ];
      
      let content = '';
      let matchedSelector = '';
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 50) {
          content = el.textContent;
          matchedSelector = sel;
          break;
        }
      }
      
      if (!content.trim()) {
        content = document.body.textContent;
        matchedSelector = 'body';
      }
      
      const title = document.title || document.querySelector('h1')?.textContent || '飞书文档';
      
      return { title: title.trim(), content: content.trim(), matchedSelector, bodyLength: document.body.textContent.length };
    });
    
    console.log(`[Scraper] 飞书文档抓取结果: 标题="${result.title}", 选择器="${result.matchedSelector}", 内容长度=${result.content.length}, body长度=${result.bodyLength}`);
    
    // 清理文本
    const content = result.content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    return {
      title: result.title,
      content,
      images: [],
      type: 'feishu',
      url,
    };
  } finally {
    await page.close();
  }
}

/**
 * Notion 文档抓取
 */
async function scrapeNotion(url) {
  const fetchFn = getFetch();
  
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html',
    },
    redirect: 'follow',
    timeout: 15000,
  });
  
  const html = await response.text();
  const $ = cheerio.load(html);
  
  // Notion 内容容器
  let content = '';
  const selectors = ['.notion-page-content', '.layout-content', 'article', 'main', '#content'];
  
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 50) {
      content = el.text();
      break;
    }
  }
  
  if (!content.trim()) {
    content = $('body').text();
  }
  
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'Notion 文档';
  
  content = content.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  
  return {
    title,
    content,
    images: [],
    type: 'notion',
    url,
  };
}

/**
 * 主入口：抓取 URL 内容
 */
async function scrapeUrl(url) {
  // 验证 URL
  try {
    new URL(url);
  } catch (e) {
    throw new Error('无效的 URL 格式');
  }
  
  const urlType = detectUrlType(url);
  console.log(`[Scraper] 抓取 ${urlType} 类型: ${url}`);
  
  try {
    switch (urlType) {
      case 'feishu':
        return await scrapeFeishu(url);
      case 'notion':
        return await scrapeNotion(url);
      default:
        return await scrapeGeneric(url);
    }
  } catch (error) {
    console.error(`[Scraper] 抓取失败:`, error.message);
    throw new Error(`抓取失败: ${error.message}`);
  }
}

/**
 * 检测文本中是否包含 URL
 */
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * 检测是否是纯 URL 输入
 */
function isUrlInput(text) {
  const trimmed = text.trim();
  return /^https?:\/\/[^\s]+$/.test(trimmed);
}

module.exports = {
  scrapeUrl,
  scrapeGeneric,
  scrapeFeishu,
  scrapeNotion,
  extractUrls,
  isUrlInput,
  detectUrlType,
};
