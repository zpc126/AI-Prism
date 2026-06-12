// input: Playwright 浏览器实例
// output: PI 工具定义，支持 navigate、click、fill、screenshot
// position: PI Agent 的浏览器操作工具

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 浏览器实例管理
let browser = null;
let context = null;
let page = null;
const browserProfileDir = path.join(__dirname, '../../data/browser-profile');

// 截图目录
const screenshotDir = path.join(__dirname, '../../data/screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// 检查浏览器是否可用
async function isBrowserAlive() {
  try {
    if (!context) return false;
    if (!page || page.isClosed()) {
      page = context.pages().find(candidate => !candidate.isClosed()) || await context.newPage();
    }
    // 尝试执行简单操作来检测浏览器是否还活着
    await page.evaluate(() => document.title);
    return true;
  } catch {
    return false;
  }
}

// 重置浏览器状态
function resetBrowserState() {
  browser = null;
  context = null;
  page = null;
}

// 启动浏览器
async function launchBrowser() {
  // 检查现有浏览器是否还活着
  if (!(await isBrowserAlive())) {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    resetBrowserState();
    
    fs.mkdirSync(browserProfileDir, { recursive: true });
    context = await chromium.launchPersistentContext(browserProfileDir, {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    browser = context.browser();
    page = context.pages().find(candidate => !candidate.isClosed()) || await context.newPage();

    // 监听浏览器关闭事件
    browser?.on('disconnected', () => {
      resetBrowserState();
    });
  }
  return { browser, context, page };
}

// 关闭浏览器
async function closeBrowser() {
  if (context) {
    await context.close();
  }
  resetBrowserState();
}

// 导航到 URL
async function navigate(url) {
  const { page } = await launchBrowser();
  const currentUrl = page.url();
  if (currentUrl === url || currentUrl.replace(/\/+$/, '') === url.replace(/\/+$/, '')) {
    return {
      success: true,
      action: 'navigate',
      reused: true,
      url: currentUrl,
      title: await page.title(),
    };
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  return {
    success: true,
    url: page.url(),
    title: await page.title(),
  };
}

// 点击元素
async function click(target) {
  const { page } = await launchBrowser();
  
  const selectors = [
    () => page.getByRole('button', { name: new RegExp(target, 'i') }).first().click({ timeout: 3000 }),
    () => page.getByRole('link', { name: new RegExp(target, 'i') }).first().click({ timeout: 3000 }),
    () => page.getByText(target, { exact: false }).first().click({ timeout: 3000 }),
    () => page.locator(`button:has-text("${target}")`).first().click({ timeout: 3000 }),
    () => page.locator(`a:has-text("${target}")`).first().click({ timeout: 3000 }),
    () => page.locator(`[aria-label*="${target}" i]`).first().click({ timeout: 3000 }),
    () => page.locator(`text=${target}`).first().click({ timeout: 3000 }),
  ];

  for (const selector of selectors) {
    try {
      await selector();
      return {
        success: true,
        action: 'click',
        target,
      };
    } catch {
      continue;
    }
  }
  
  throw new Error(`找不到元素: ${target}`);
}

// 填充输入框
async function fill(target, value) {
  const { page } = await launchBrowser();
  
  const selectors = [
    () => page.getByRole('textbox', { name: new RegExp(target || 'input', 'i') }).first(),
    () => page.getByPlaceholder(new RegExp(target || 'input', 'i')).first(),
    () => page.locator('input[type="text"]:visible').first(),
    () => page.locator('textarea:visible').first(),
    () => page.locator('[contenteditable="true"]').first(),
  ];

  for (const selector of selectors) {
    try {
      const input = selector();
      await input.click({ timeout: 2000 });
      await input.fill(value);
      return {
        success: true,
        action: 'fill',
        target,
        value,
      };
    } catch {
      continue;
    }
  }
  
  // 降级：键盘输入
  await page.keyboard.type(value, { delay: 50 });
  return {
    success: true,
    action: 'fill',
    target,
    value,
    method: 'keyboard',
  };
}

// 截图
async function screenshot(label = 'screenshot') {
  const { page } = await launchBrowser();
  
  const timestamp = Date.now();
  const filename = `${label}_${timestamp}.png`;
  const filepath = path.join(screenshotDir, filename);
  
  await page.screenshot({ path: filepath, fullPage: false });
  
  return {
    success: true,
    action: 'screenshot',
    filename,
    filepath,
    url: page.url(),
  };
}

// 获取页面快照（DOM 结构摘要）
async function getSnapshot() {
  const { page } = await launchBrowser();
  
  // 获取页面关键信息
  const snapshot = await page.evaluate(() => {
    const result = {
      url: window.location.href,
      title: document.title,
      buttons: [],
      links: [],
      inputs: [],
      headings: [],
      visibleText: []
    };
    
    // 获取按钮
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
      const text = el.textContent?.trim() || el.value || el.getAttribute('aria-label');
      if (text && el.offsetParent !== null) {
        result.buttons.push({ text: text.substring(0, 50), tag: el.tagName });
      }
    });
    
    // 获取链接
    document.querySelectorAll('a[href]').forEach(el => {
      const text = el.textContent?.trim();
      if (text && el.offsetParent !== null) {
        result.links.push({ text: text.substring(0, 50), href: el.href?.substring(0, 100) });
      }
    });
    
    // 获取输入框
    document.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(el => {
      const placeholder = el.placeholder || el.getAttribute('aria-label') || el.name;
      if (el.offsetParent !== null) {
        result.inputs.push({ placeholder: placeholder?.substring(0, 50), type: el.type || 'text' });
      }
    });
    
    // 获取标题
    document.querySelectorAll('h1, h2, h3').forEach(el => {
      if (el.offsetParent !== null) {
        result.headings.push({ tag: el.tagName, text: el.textContent?.trim().substring(0, 80) });
      }
    });
    
    // 获取可见文本片段
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    
    let node;
    const textSet = new Set();
    while ((node = walker.nextNode()) && textSet.size < 20) {
      const text = node.textContent?.trim();
      if (text && text.length > 2 && text.length < 100) {
        textSet.add(text);
      }
    }
    result.visibleText = Array.from(textSet);
    
    return result;
  });
  
  return {
    success: true,
    action: 'get_snapshot',
    snapshot,
    summary: `页面: ${snapshot.title} | 按钮: ${snapshot.buttons.length} | 链接: ${snapshot.links.length} | 输入框: ${snapshot.inputs.length}`
  };
}

// 等待元素出现
async function waitForElement(selector, timeout = 5000) {
  const { page } = await launchBrowser();
  
  try {
    await page.waitForSelector(selector, { timeout, state: 'visible' });
    return { success: true, action: 'wait', selector };
  } catch (e) {
    throw new Error(`等待元素超时: ${selector}`);
  }
}

// 滚动页面
async function scroll(direction = 'down', amount = 500) {
  const { page } = await launchBrowser();
  
  await page.evaluate(({ dir, amt }) => {
    window.scrollBy(0, dir === 'down' ? amt : -amt);
  }, { dir: direction, amt: amount });
  
  await page.waitForTimeout(500);
  
  return {
    success: true,
    action: 'scroll',
    direction,
    amount
  };
}

// PI 工具定义
const browserTool = {
  name: 'browser',
  label: '浏览器操作',
  description: '执行浏览器操作，如打开页面、点击、输入、截图、查看页面快照等',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型: navigate(导航), click(点击), fill(填写), screenshot(截图), get_snapshot(获取页面快照), wait(等待元素), scroll(滚动)',
        enum: ['navigate', 'click', 'fill', 'screenshot', 'get_snapshot', 'wait', 'scroll'],
      },
      target: {
        type: 'string',
        description: '目标元素或 URL',
      },
      value: {
        type: 'string',
        description: '输入值（仅 fill 操作需要）',
      },
    },
    required: ['action'],
  },
  execute: async (_toolCallId, params) => {
    // 在当前页面重试，不能因元素定位失败而新开浏览器或丢失登录态。
    const maxRetries = 2;
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Browser] 重试第 ${attempt} 次...`);
          await page?.waitForTimeout(500);
        }
        
        let result;
        
        switch (params.action) {
          case 'navigate':
            if (!params.target) {
              throw new Error('navigate 操作需要 target 参数（URL）');
            }
            result = await navigate(params.target);
            break;
            
          case 'click':
            if (!params.target) {
              throw new Error('click 操作需要 target 参数（目标元素）');
            }
            result = await click(params.target);
            break;
            
          case 'fill':
            if (!params.target || !params.value) {
              throw new Error('fill 操作需要 target 和 value 参数');
            }
            result = await fill(params.target, params.value);
            break;
            
          case 'screenshot':
            result = await screenshot(params.target || 'screenshot');
            break;
            
          case 'get_snapshot':
            result = await getSnapshot();
            break;
            
          case 'wait':
            if (!params.target) {
              throw new Error('wait 操作需要 target 参数（选择器）');
            }
            result = await waitForElement(params.target);
            break;
            
          case 'scroll':
            result = await scroll(params.target || 'down', parseInt(params.value) || 500);
            break;
            
          default:
            throw new Error(`未知操作: ${params.action}`);
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        lastError = error;
        
        // 如果是最后一次尝试，返回错误
        if (attempt === maxRetries) {
          return {
            content: [{ type: 'text', text: `浏览器操作失败: ${error.message}` }],
            details: { error: error.message, retries: attempt },
            isError: true,
          };
        }
      }
    }
    
    // 不应该到这里，但以防万一
    return {
      content: [{ type: 'text', text: `浏览器操作失败: ${lastError?.message}` }],
      details: { error: lastError?.message },
      isError: true,
    };
  },
};

module.exports = {
  browserTool,
  launchBrowser,
  closeBrowser,
  navigate,
  click,
  fill,
  screenshot,
  getSnapshot,
  waitForElement,
  scroll,
};
