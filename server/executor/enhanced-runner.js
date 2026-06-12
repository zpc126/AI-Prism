// input: 测试用例数据（含 steps 和 expected），reportId，onLog 回调
// output: 带截图的测试执行结果（每步截图 + 预期结果验证）
// position: 核心执行器，智能步骤解析 + 多策略元素定位 + 预期结果验证

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

class EnhancedRunner {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.reportId = options.reportId;
    this.reportDir = options.reportDir || path.join(os.tmpdir(), 'scout-reports');
    this.screenshotIndex = 0;
    this.currentResultId = null;
  }

  // 获取用户 Chrome profile 路径
  getChromeUserDataDir() {
    const platform = process.platform;
    if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
    } else if (platform === 'win32') {
      return path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data');
    }
    return path.join(os.homedir(), '.config/google-chrome');
  }

  // 启动浏览器
  async launch(onLog) {
    onLog({ type: 'system', text: '正在启动 Chrome...' });

    try {
      // 尝试使用持久化上下文继承登录态
      const userDataDir = this.getChromeUserDataDir();
      const tmpProfile = path.join(os.tmpdir(), 'scout-chrome-profile');

      // 复制关键文件
      if (!fs.existsSync(tmpProfile)) {
        fs.mkdirSync(tmpProfile, { recursive: true });
      }

      const defaultSrc = path.join(userDataDir, 'Default');
      const defaultDst = path.join(tmpProfile, 'Default');
      if (!fs.existsSync(defaultDst)) {
        fs.mkdirSync(defaultDst, { recursive: true });
      }

      // 复制登录态文件
      const criticalFiles = ['Cookies', 'Login Data', 'Preferences', 'Secure Preferences'];
      for (const file of criticalFiles) {
        try {
          const srcFile = path.join(defaultSrc, file);
          const dstFile = path.join(defaultDst, file);
          if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, dstFile);
          }
        } catch (e) {
          // 忽略复制失败
        }
      }

      this.context = await chromium.launchPersistentContext(tmpProfile, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      });

      this.page = this.context.pages()[0] || await this.context.newPage();
      onLog({ type: 'success', text: 'Chrome 已启动，登录态已继承' });
    } catch (e) {
      onLog({ type: 'stderr', text: `启动失败: ${e.message}` });
      onLog({ type: 'system', text: '启动干净浏览器...' });

      this.browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      this.page = await this.context.newPage();
      onLog({ type: 'system', text: '干净浏览器已启动（无登录态）' });
    }
  }

  // 截图并保存
  async takeScreenshot(stepDescription) {
    this.screenshotIndex++;
    const filename = `step_${this.screenshotIndex}_${Date.now()}.png`;
    const filepath = path.join(this.reportDir, filename);

    try {
      await this.page.screenshot({ path: filepath, fullPage: false });
      return { filename, filepath };
    } catch (e) {
      console.error('截图失败:', e);
      return null;
    }
  }

  // 执行单个测试用例
  async executeTestCase(testCase, onLog) {
    const startTime = Date.now();
    const steps = testCase.steps || [];
    const stepResults = [];

    onLog({ type: 'info', text: `开始执行: ${testCase.title}` });

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepStart = Date.now();
      const stepResult = {
        stepIndex: i,
        description: step,
        status: 'running',
        screenshotPath: null,
        errorMessage: null,
        durationMs: 0,
      };

      try {
        onLog({ type: 'thinking', text: `步骤 ${i + 1}: ${step}` });

        // 如果页面还在空白页，且步骤不是导航，提示用户
        const currentUrl = this.page.url();
        const isNavigate = /^(打开|访问|goto|navigate|去|进|上)/.test(step.trim().toLowerCase());
        if (!isNavigate && (currentUrl === 'about:blank' || currentUrl === '')) {
          throw new Error('页面未打开，请先提供测试地址（在执行弹窗中填写 URL）');
        }

        // 解析并执行步骤
        await this.executeStep(step, onLog);

        // 关键步骤截图
        const screenshot = await this.takeScreenshot(step);
        if (screenshot) {
          stepResult.screenshotPath = screenshot.filepath;
          stepResult.status = 'passed';
          onLog({ type: 'success', text: `步骤 ${i + 1} 完成` });
        }
      } catch (error) {
        stepResult.status = 'failed';
        stepResult.errorMessage = error.message;

        // 失败时也截图
        const screenshot = await this.takeScreenshot(`失败_${step}`);
        if (screenshot) {
          stepResult.screenshotPath = screenshot.filepath;
        }

        onLog({ type: 'error', text: `步骤 ${i + 1} 失败: ${error.message}` });
      }

      stepResult.durationMs = Date.now() - stepStart;
      stepResults.push(stepResult);

      // 如果步骤失败，整个用例失败
      if (stepResult.status === 'failed') {
        return {
          status: 'failed',
          steps: stepResults,
          errorMessage: stepResult.errorMessage,
          durationMs: Date.now() - startTime,
        };
      }

      // 步骤间等待
      await this.page.waitForTimeout(500);
    }

    // 所有步骤执行完毕，验证预期结果
    const expected = testCase.expected;
    if (expected) {
      try {
        onLog({ type: 'thinking', text: `验证: ${expected}` });
        await this.verifyPageContains(expected);
        const verifyScreenshot = await this.takeScreenshot('验证结果');
        stepResults.push({
          stepIndex: steps.length,
          description: `验证: ${expected}`,
          status: 'passed',
          screenshotPath: verifyScreenshot?.filepath || null,
          errorMessage: null,
          durationMs: 0,
        });
        onLog({ type: 'success', text: `✓ 验证通过: ${expected}` });
      } catch (e) {
        const verifyScreenshot = await this.takeScreenshot('验证失败');
        stepResults.push({
          stepIndex: steps.length,
          description: `验证: ${expected}`,
          status: 'failed',
          screenshotPath: verifyScreenshot?.filepath || null,
          errorMessage: e.message,
          durationMs: 0,
        });
        return {
          status: 'failed',
          steps: stepResults,
          errorMessage: `验证失败: ${expected}`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    return {
      status: 'passed',
      steps: stepResults,
      durationMs: Date.now() - startTime,
    };
  }

  // 解析并执行单个步骤
  async executeStep(stepText, onLog) {
    const text = stepText.trim();
    const lower = text.toLowerCase();

    // 1. 导航
    if (/^(打开|访问|goto|navigate|去|进|上)/.test(lower)) {
      const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        await this.page.goto(urlMatch[1], { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        const siteName = text.replace(/^(打开|访问|goto|navigate|去|进|上)\s*/, '').trim();
        const url = this.guessUrl(siteName);
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      await this.page.waitForTimeout(1500);
      return;
    }

    // 2. 等待
    if (/^(等待|wait|等一下)/.test(lower)) {
      const secMatch = text.match(/(\d+)/);
      const ms = secMatch ? parseInt(secMatch[1]) * 1000 : 2000;
      await this.page.waitForTimeout(ms);
      return;
    }

    // 3. 截图
    if (/^(截图|screenshot|截屏)/.test(lower)) {
      await this.takeScreenshot(stepText);
      return;
    }

    // 4. 验证 — 「验证页面显示xxx」
    if (/^(验证|检查|确认|assert|verify)/.test(lower)) {
      let content = text.replace(/^(验证|检查|确认|assert|verify)\s*/, '')
        .replace(/^(页面|界面|弹窗|提示|显示)\s*(显示|出现|包含)?\s*/, '').trim();
      if (content) {
        await this.verifyPageContains(content);
      }
      return;
    }

    // 5. 在 [目标] 输入 [内容] — 「在用户名输入框输入 admin」
    const inputMatch = text.match(/^在(.+?)(?:输入框?|框|栏|字段)?(?:中)?(?:输入|填写|填入|键入)\s*(.+)$/);
    if (inputMatch) {
      const target = inputMatch[1].trim();
      const value = inputMatch[2].trim().replace(/^[""'']+|[""'']+$/g, '');
      await this.fillInputSmart(target, value, onLog);
      return;
    }

    // 6. 输入 [内容] — 简单输入
    if (/^(输入|填写|填入|键入)\s/.test(lower)) {
      const content = text.replace(/^(输入|填写|填入|键入)[：:]*\s*/, '').trim().replace(/^[""'']+|[""'']+$/g, '');
      if (content) {
        await this.fillInput(content);
      }
      return;
    }

    // 7. 点击/选择 — 「点击登录按钮」「点击第一个商品图片」
    if (/^(点击|click|按|选择|选中|勾选|勾|点选)/.test(lower)) {
      const target = text.replace(/^(点击|click|按|选择|选中|勾选|勾|点选)\s*/, '').trim();
      await this.clickElementSmart(target, onLog);
      return;
    }

    // 8. 默认：尝试作为可点击文本
    await this.clickElementSmart(text, onLog);
  }

  // 智能填写输入框（带目标提示）
  async fillInputSmart(target, value, onLog) {
    onLog({ type: 'info', text: `填写「${target}」: ${value}` });

    // 按优先级尝试多种定位策略
    const strategies = [
      // 按 placeholder / label / aria-label 精确匹配
      () => this.page.getByPlaceholder(new RegExp(target, 'i')).first(),
      () => this.page.getByLabel(new RegExp(target, 'i')).first(),
      () => this.page.locator(`[placeholder*="${target}" i]`).first(),
      () => this.page.locator(`[aria-label*="${target}" i]`).first(),
      // 按关联文本匹配（label 在输入框附近）
      () => this.page.locator(`text=${target}`).locator('..').locator('input, textarea, [contenteditable]').first(),
      // 通用可见输入框
      () => this.page.locator('textarea:visible').first(),
      () => this.page.locator('input[type="text"]:visible').first(),
      () => this.page.locator('input:not([type]):visible').first(),
      () => this.page.locator('[contenteditable="true"]:visible').first(),
    ];

    for (const getLocator of strategies) {
      try {
        const el = getLocator();
        await el.click({ timeout: 2000 });
        await el.fill(value);
        return;
      } catch { continue; }
    }

    // 降级：键盘输入
    await this.page.keyboard.type(value, { delay: 50 });
  }

  // 智能点击（带更丰富的匹配策略）
  async clickElementSmart(target, onLog) {
    onLog({ type: 'info', text: `点击: ${target}` });

    // 提取关键词（去掉「第一个」「第二个」等量词）
    const cleanTarget = target.replace(/^(第[一二三四五六七八九十\d]+个?)?\s*/, '').trim();

    const strategies = [
      // 按角色匹配
      () => this.page.getByRole('button', { name: new RegExp(cleanTarget, 'i') }).first(),
      () => this.page.getByRole('link', { name: new RegExp(cleanTarget, 'i') }).first(),
      // 按文本匹配
      () => this.page.getByText(cleanTarget, { exact: false }).first(),
      // 按 aria-label
      () => this.page.locator(`[aria-label*="${cleanTarget}" i]`).first(),
      // 按 CSS text selector
      () => this.page.locator(`text=${cleanTarget}`).first(),
      // 按按钮文本
      () => this.page.locator(`button:has-text("${cleanTarget}")`).first(),
      () => this.page.locator(`a:has-text("${cleanTarget}")`).first(),
    ];

    for (const getLocator of strategies) {
      try {
        const el = getLocator();
        await el.click({ timeout: 3000 });
        return;
      } catch { continue; }
    }

    throw new Error(`找不到可点击元素: ${target}`);
  }

  // 验证页面包含指定文本
  async verifyPageContains(content) {
    try {
      await this.page.waitForFunction(
        (text) => document.body.innerText.includes(text),
        content,
        { timeout: 10000 }
      );
    } catch {
      throw new Error(`页面未找到: ${content}`);
    }
  }

  // 点击元素（保留兼容）
  async clickElement(target) {
    return this.clickElementSmart(target, () => {});
  }

  // 填写输入框（保留兼容）
  async fillInput(content) {
    const selectors = [
      'textarea:visible',
      'input[type="text"]:visible',
      'input:not([type]):visible',
      '[contenteditable="true"]:visible',
    ];
    for (const selector of selectors) {
      try {
        const input = this.page.locator(selector).first();
        await input.click({ timeout: 2000 });
        await input.fill(content);
        return;
      } catch { continue; }
    }
    await this.page.keyboard.type(content, { delay: 50 });
  }

  // 验证元素存在（保留兼容）
  async verifyElement(content) {
    return this.verifyPageContains(content);
  }

  // 猜测 URL
  guessUrl(text) {
    const cleaned = text.toLowerCase().trim();
    if (/qq|腾讯/.test(cleaned)) return 'https://news.qq.com';
    if (/百度/.test(cleaned)) return 'https://www.baidu.com';
    if (/taobao|淘宝/.test(cleaned)) return 'https://www.taobao.com';
    if (/京东|jd/.test(cleaned)) return 'https://www.jd.com';
    if (/微博|weibo/.test(cleaned)) return 'https://weibo.com';
    if (/知乎/.test(cleaned)) return 'https://www.zhihu.com';
    if (/bilibili|b站/.test(cleaned)) return 'https://www.bilibili.com';
    if (/github/.test(cleaned)) return 'https://github.com';
    if (/chatgpt|gpt|openai/.test(cleaned)) return 'https://chat.openai.com';
    if (/google|谷歌/.test(cleaned)) return 'https://www.google.com';
    return `https://www.baidu.com/s?wd=${encodeURIComponent(text)}`;
  }

  // 关闭浏览器
  async close() {
    try {
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch {}
  }
}

module.exports = { EnhancedRunner };
