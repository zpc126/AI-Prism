// input: Playwright 浏览器实例
// output: PI 工具定义，支持 navigate、click、fill、screenshot
// position: PI Agent 的浏览器操作工具

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const adbDevice = require('../../device/adb-device');

// Web 与手机端分别保留独立会话，跨端用例切换时不会丢失当前页面。
const browserSessions = {
  web: { browser: null, context: null, page: null },
  mobile: { browser: null, context: null, page: null },
};
let activeDevice = 'web';
const browserProfileDir = path.join(__dirname, '../../data/browser-profile');

const DEVICE_CONFIGS = {
  web: {
    label: 'Web',
    profileDir: browserProfileDir,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  mobile: {
    label: '手机',
    profileDir: `${browserProfileDir}-mobile`,
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  },
};

// 截图目录
const screenshotDir = path.join(__dirname, '../../data/screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// 检查浏览器是否可用
async function isBrowserAlive(device = activeDevice) {
  const session = browserSessions[device];
  try {
    if (!session.context) return false;
    if (!session.page || session.page.isClosed()) {
      session.page = session.context.pages().find(candidate => !candidate.isClosed()) || await session.context.newPage();
    }
    await session.page.evaluate(() => document.title);
    return true;
  } catch {
    return false;
  }
}

function resetBrowserState(device) {
  browserSessions[device] = { browser: null, context: null, page: null };
}

// 启动浏览器
async function launchBrowser(device = activeDevice) {
  const normalizedDevice = device === 'mobile' ? 'mobile' : 'web';
  activeDevice = normalizedDevice;
  const config = DEVICE_CONFIGS[normalizedDevice];
  const session = browserSessions[normalizedDevice];

  if (!(await isBrowserAlive(normalizedDevice))) {
    if (session.context) {
      try {
        await session.context.close();
      } catch {}
    }
    resetBrowserState(normalizedDevice);
    
    fs.mkdirSync(config.profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(config.profileDir, {
      headless: false,
      channel: 'chrome',
      viewport: config.viewport,
      userAgent: config.userAgent,
      deviceScaleFactor: config.deviceScaleFactor,
      hasTouch: config.hasTouch,
      isMobile: config.isMobile,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    const browser = context.browser();
    const page = context.pages().find(candidate => !candidate.isClosed()) || await context.newPage();
    browserSessions[normalizedDevice] = { browser, context, page };

    browser?.on('disconnected', () => {
      resetBrowserState(normalizedDevice);
    });
  }
  return { ...browserSessions[normalizedDevice], device: normalizedDevice, deviceLabel: config.label };
}

async function switchDevice(device) {
  const normalized = /手机|mobile|phone|ios|android/i.test(String(device || '')) ? 'mobile' : 'web';
  activeDevice = normalized;
  if (normalized === 'mobile') {
    const status = adbDevice.getDeviceStatus();
    if (!status.connected) {
      throw new Error('未连接 Android 真机，请通过 USB 数据线或无线 ADB 连接');
    }
    return {
      success: true,
      action: 'switch_device',
      device: 'mobile',
      deviceLabel: `Android 真机${status.active?.model ? ` · ${status.active.model}` : ''}`,
      serial: status.active?.serial,
    };
  }
  const result = await launchBrowser('web');
  return {
    success: true,
    action: 'switch_device',
    device: normalized,
    deviceLabel: DEVICE_CONFIGS[normalized].label,
    viewport: DEVICE_CONFIGS[normalized].viewport,
    url: result.page.url(),
  };
}

// 关闭浏览器
async function closeBrowser() {
  for (const device of Object.keys(browserSessions)) {
    const session = browserSessions[device];
    if (session.context) {
      try {
        await session.context.close();
      } catch {}
    }
    resetBrowserState(device);
  }
  activeDevice = 'web';
}

// 导航到 URL
async function navigate(url) {
  if (activeDevice === 'mobile') return adbDevice.navigate(url);
  const { page, device, deviceLabel } = await launchBrowser();
  const currentUrl = page.url();
  if (currentUrl === url || currentUrl.replace(/\/+$/, '') === url.replace(/\/+$/, '')) {
    return {
      success: true,
      action: 'navigate',
      reused: true,
      device,
      deviceLabel,
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
    device,
    deviceLabel,
  };
}

// 点击元素
async function click(target) {
  if (activeDevice === 'mobile') return adbDevice.click(target);
  const { page, device, deviceLabel } = await launchBrowser();
  
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
        device,
        deviceLabel,
      };
    } catch {
      continue;
    }
  }
  
  throw new Error(`找不到元素: ${target}`);
}

// 填充输入框
async function fill(target, value) {
  if (activeDevice === 'mobile') return adbDevice.fill(target, value);
  const { page, device, deviceLabel } = await launchBrowser();
  
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
        device,
        deviceLabel,
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
    device,
    deviceLabel,
  };
}

// 截图
async function screenshot(label = 'screenshot') {
  if (activeDevice === 'mobile') return adbDevice.screenshot(label);
  const { page, device, deviceLabel } = await launchBrowser();
  
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
    device,
    deviceLabel,
  };
}

async function captureFrame() {
  if (activeDevice === 'mobile') {
    const captured = await adbDevice.screenshot('video_frame');
    if (captured?.filepath && fs.existsSync(captured.filepath)) {
      return fs.readFileSync(captured.filepath);
    }
    return null;
  }
  const { page } = await launchBrowser();
  return await page.screenshot({ type: 'png', fullPage: false });
}

// 获取页面快照（DOM 结构摘要）
async function getSnapshot() {
  if (activeDevice === 'mobile') return adbDevice.getSnapshot();
  const { page, device, deviceLabel } = await launchBrowser();
  
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
    device,
    deviceLabel,
    snapshot,
    summary: `页面: ${snapshot.title} | 按钮: ${snapshot.buttons.length} | 链接: ${snapshot.links.length} | 输入框: ${snapshot.inputs.length}`
  };
}

// 等待元素出现
async function waitForElement(selector, timeout = 5000) {
  if (activeDevice === 'mobile') return adbDevice.waitForElement(selector, timeout);
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
  if (activeDevice === 'mobile') return adbDevice.scroll(direction, amount);
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
  description: '执行 Web 或手机浏览器操作，可切换设备、打开页面、点击、输入、截图、查看页面快照等',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型: switch_device(切换 Web/手机), navigate(导航), click(点击), fill(填写), screenshot(截图), get_snapshot(获取页面快照), wait(等待元素), scroll(滚动)',
        enum: ['switch_device', 'navigate', 'click', 'fill', 'screenshot', 'get_snapshot', 'wait', 'scroll'],
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
          const activeSession = browserSessions[activeDevice];
          await activeSession.page?.waitForTimeout(500);
        }
        
        let result;
        
        switch (params.action) {
          case 'switch_device':
            result = await switchDevice(params.target || params.value || 'web');
            break;
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
  captureFrame,
  getSnapshot,
  waitForElement,
  scroll,
  switchDevice,
};
