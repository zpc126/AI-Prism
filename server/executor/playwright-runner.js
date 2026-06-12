const { chromium } = require('playwright');

// Playwright 浏览器自动化
class PlaywrightRunner {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  // 初始化浏览器
  async init(options = {}) {
    this.browser = await chromium.launch({
      headless: options.headless ?? false,
      slowMo: options.slowMo ?? 100
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    this.page = await this.context.newPage();
    console.log('[Playwright] 浏览器已启动');
  }

  // 执行测试步骤
  async executeStep(step) {
    const startTime = Date.now();
    
    try {
      switch (step.action) {
        case 'navigate':
          await this.page.goto(step.url, { waitUntil: 'networkidle' });
          break;
        case 'click':
          await this.page.click(step.selector);
          break;
        case 'fill':
          await this.page.fill(step.selector, step.value);
          break;
        case 'wait':
          await this.page.waitForSelector(step.selector, { timeout: step.timeout || 10000 });
          break;
        case 'screenshot':
          return await this.page.screenshot({ path: step.path });
        case 'getText':
          return await this.page.textContent(step.selector);
        case 'isVisible':
          return await this.page.isVisible(step.selector);
        default:
          throw new Error(`未知操作: ${step.action}`);
      }
      
      return {
        success: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  // 截图
  async screenshot(path) {
    return await this.page.screenshot({ path, fullPage: true });
  }

  // 关闭浏览器
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[Playwright] 浏览器已关闭');
    }
  }
}

module.exports = { PlaywrightRunner };
