// input: 自然语言指令
// output: Playwright 流式执行日志（通过回调）
// position: 自动化执行器，用 Playwright 接管用户 Chrome（含登录态）

const { chromium } = require('playwright');
const os = require('os');
const path = require('path');
const fs = require('fs');

class AutoRunner {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
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

  // 复制 Chrome profile 到临时目录（避免和正在运行的 Chrome 冲突）
  copyChromeProfile(onLog) {
    const src = this.getChromeUserDataDir();
    const tmpDir = path.join(os.tmpdir(), 'scout-chrome-profile');

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const defaultSrc = path.join(src, 'Default');
    const defaultDst = path.join(tmpDir, 'Default');
    fs.mkdirSync(defaultDst, { recursive: true });

    // 关键文件：Cookie 和登录数据
    const criticalFiles = [
      'Cookies', 'Cookies-journal',
      'Login Data', 'Login Data-journal',
      'Preferences', 'Secure Preferences',
    ];

    let copied = 0;
    for (const file of criticalFiles) {
      const srcFile = path.join(defaultSrc, file);
      const dstFile = path.join(defaultDst, file);
      try {
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, dstFile);
          copied++;
        }
      } catch (e) {
        onLog({ type: 'system', text: `跳过 ${file}: ${e.code}` });
      }
    }

    // 复制 Local State
    const localState = path.join(src, 'Local State');
    if (fs.existsSync(localState)) {
      try {
        fs.copyFileSync(localState, path.join(tmpDir, 'Local State'));
        copied++;
      } catch (e) {}
    }

    onLog({ type: 'system', text: `已复制 ${copied} 个登录态文件` });
    return tmpDir;
  }

  // 启动浏览器
  async launch(onLog) {
    onLog({ type: 'system', text: `正在启动 Chrome...` });

    try {
      const tmpProfile = this.copyChromeProfile(onLog);

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
      onLog({ type: 'success', text: `Chrome 已启动，登录态已继承` });
    } catch (e) {
      onLog({ type: 'stderr', text: `启动失败: ${e.message}` });
      onLog({ type: 'system', text: `启动干净浏览器...` });
      this.browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      this.page = await this.context.newPage();
      onLog({ type: 'system', text: `干净浏览器已启动（无登录态）` });
    }
  }

  // 将自然语言指令拆成可执行步骤
  parseSteps(command) {
    // 只按真正的连接词拆分，不拆 "看看" "搜索" 等动作词
    const splitPoints = /(然后|接着|再|之后|并且|同时)/;
    let segments = command.split(splitPoints).map(s => s.trim()).filter(Boolean);

    // 按标点再拆
    const raw = [];
    for (const seg of segments) {
      const parts = seg.split(/[，,。.；;！!？?：:]+/).map(s => s.trim()).filter(Boolean);
      raw.push(...parts);
    }

    // 清理连接词
    const cleaned = raw
      .map(s => s.replace(/^(然后|接着|再|之后|并且|同时|之后再)$/, '').trim())
      .filter(Boolean);

    const steps = [];
    for (const text of cleaned) {
      // 打开/访问
      if (/^(帮我|给我|请)?\s*(打开|访问|goto|navigate|去|进|上)/.test(text)) {
        // 提取站点名（去掉动作前缀和后续动作）
        let siteName = text
          .replace(/^(帮我|给我|请)?\s*(打开|访问|一下|去|进|上)\s*/, '')
          .replace(/(看看|搜索|查一下|输入|填写).*$/, '')
          .trim();
        const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
        const url = urlMatch ? urlMatch[1] : this.guessUrl(siteName);
        steps.push({ action: 'navigate', url, desc: `打开 ${siteName}` });
        
        // 如果句子后面还有动作内容（如 "打开gpt看看今天天气"），提取出来
        const afterAction = text.replace(/^(帮我|给我|请)?\s*(打开|访问|一下|去|进|上)\s*/, '').trim();
        const actionMatch = afterAction.match(/(看看|搜索|查一下|输入|填写)\s*(.*)$/);
        if (actionMatch && actionMatch[2]) {
          steps.push({ action: 'fill', value: actionMatch[2].trim(), desc: actionMatch[2].trim() });
        }
      } else if (/^(点击|click|按|选择|选中|勾选)/.test(text)) {
        const target = text.replace(/^(点击|click|按|选择|选中|勾选)\s*/, '').trim();
        steps.push({ action: 'click', target, desc: text });
      } else if (/(输入|搜索|查一下|问问|告诉|写上)/.test(text)) {
        let content = text.replace(/^.*(输入|搜索|查一下|问问|告诉|写上)[：:]*\s*/, '').trim();
        content = content.replace(/^[""'']+|[""'']+$/g, '');
        if (content) {
          steps.push({ action: 'fill', value: content, desc: text });
        }
      } else if (/^(填写|填入|输入框|type|fill)/.test(text)) {
        const content = text.replace(/^(填写|填入|输入框|type|fill)\s*/, '').trim();
        steps.push({ action: 'fill', value: content, desc: text });
      } else if (/^(等待|wait|等一下)/.test(text)) {
        steps.push({ action: 'wait', desc: text });
      } else if (/^(截图|screenshot|截屏)/.test(text)) {
        steps.push({ action: 'screenshot', desc: text });
      } else {
        // 如果上一步是 navigate，这一步当作输入
        const prevStep = steps[steps.length - 1];
        if (prevStep && prevStep.action === 'navigate') {
          steps.push({ action: 'fill', value: text, desc: text });
        } else {
          steps.push({ action: 'interact', target: text, desc: text });
        }
      }
    }
    return steps;
  }

  // 猜 URL
  guessUrl(text) {
    const cleaned = text
      .replace(/^(帮我|给我|请)?\s*(打开|访问|一下|去|进|上)\s*/g, '')
      .replace(/(看看|搜索|查一下|然后|再|之后).*$/, '')
      .trim()
      .toLowerCase();

    if (/qq|腾讯/.test(cleaned)) return 'https://news.qq.com';
    if (/百度/.test(cleaned)) return 'https://www.baidu.com';
    if (/taobao|淘宝/.test(cleaned)) return 'https://www.taobao.com';
    if (/京东|jd/.test(cleaned)) return 'https://www.jd.com';
    if (/微博|weibo/.test(cleaned)) return 'https://weibo.com';
    if (/知乎/.test(cleaned)) return 'https://www.zhihu.com';
    if (/bilibili|b站/.test(cleaned)) return 'https://www.bilibili.com';
    if (/github/.test(cleaned)) return 'https://github.com';
    if (/chatgpt|gpt|openai/.test(cleaned)) return 'https://chat.openai.com';
    if (/抖音/.test(cleaned)) return 'https://www.douyin.com';
    if (/小红书/.test(cleaned)) return 'https://www.xiaohongshu.com';
    if (/google|谷歌/.test(cleaned)) return 'https://www.google.com';
    if (/^[a-z0-9-]+\.[a-z]{2,}/.test(cleaned)) return `https://${cleaned}`;
    return `https://www.baidu.com/s?wd=${encodeURIComponent(cleaned || text)}`;
  }

  // 执行单个步骤
  async executeStep(step, onLog) {
    try {
      switch (step.action) {
        case 'navigate':
          onLog({ type: 'thinking', text: `正在打开: ${step.url}` });
          await this.page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          onLog({ type: 'success', text: `页面已打开: ${await this.page.title()}` });
          break;

        case 'click':
          onLog({ type: 'thinking', text: `正在查找: ${step.target}` });
          try {
            await this.page.getByText(step.target, { exact: false }).first().click({ timeout: 8000 });
            onLog({ type: 'success', text: `已点击: ${step.target}` });
          } catch {
            await this.page.locator(`text=${step.target}`).first().click({ timeout: 5000 });
            onLog({ type: 'success', text: `已点击: ${step.target}` });
          }
          break;

        case 'fill':
          onLog({ type: 'thinking', text: `正在输入: ${step.value}` });
          // 先尝试找到输入框并点击聚焦
          try {
            const input = this.page.locator('textarea, [contenteditable="true"], input[type="text"]').first();
            await input.click({ timeout: 3000 });
            await this.page.waitForTimeout(300);
          } catch {
            // 找不到输入框，尝试直接用 keyboard
          }
          await this.page.keyboard.type(step.value, { delay: 50 });
          // 按回车发送（ChatGPT 等）
          await this.page.keyboard.press('Enter');
          onLog({ type: 'success', text: `已输入并发送: ${step.value}` });
          break;

        case 'wait':
          onLog({ type: 'thinking', text: `等待 3 秒...` });
          await this.page.waitForTimeout(3000);
          onLog({ type: 'success', text: `等待完成` });
          break;

        case 'screenshot':
          onLog({ type: 'thinking', text: `正在截图...` });
          await this.page.screenshot({ fullPage: false });
          onLog({ type: 'success', text: `截图完成` });
          break;

        case 'interact':
          onLog({ type: 'thinking', text: `尝试操作: ${step.target}` });
          try {
            await this.page.getByText(step.target, { exact: false }).first().click({ timeout: 5000 });
            onLog({ type: 'success', text: `已点击: ${step.target}` });
          } catch {
            try {
              await this.page.getByRole('button', { name: step.target }).first().click({ timeout: 3000 });
              onLog({ type: 'success', text: `已点击按钮: ${step.target}` });
            } catch {
              onLog({ type: 'stderr', text: `未找到: ${step.target}，跳过` });
            }
          }
          break;

        default:
          onLog({ type: 'stderr', text: `未知操作: ${step.action}` });
      }
    } catch (error) {
      onLog({ type: 'error', text: `步骤失败 [${step.desc}]: ${error.message}` });
      try {
        await this.page.screenshot({ path: path.join(os.tmpdir(), `scout-error-${Date.now()}.png`) });
        onLog({ type: 'system', text: `错误截图已保存到临时目录` });
      } catch {}
    }
  }

  // 主执行流程
  async execute(command, onLog) {
    onLog({ type: 'system', text: `收到指令: ${command}` });
    onLog({ type: 'divider', text: '' });

    await this.launch(onLog);
    onLog({ type: 'divider', text: '' });

    const steps = this.parseSteps(command);
    onLog({ type: 'system', text: `已解析 ${steps.length} 个步骤:` });
    steps.forEach((s, i) => {
      onLog({ type: 'command', text: `  ${i + 1}. ${s.desc}` });
    });
    onLog({ type: 'divider', text: '' });

    for (let i = 0; i < steps.length; i++) {
      onLog({ type: 'system', text: `--- 步骤 ${i + 1}/${steps.length} ---` });
      await this.executeStep(steps[i], onLog);
      await this.page.waitForTimeout(800);
    }

    onLog({ type: 'divider', text: '' });
    onLog({ type: 'success', text: `所有步骤执行完毕` });

    try {
      const finalTitle = await this.page.title();
      onLog({ type: 'system', text: `当前页面: ${finalTitle}` });
    } catch {}
  }

  async close() {
    try {
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch {}
  }
}

module.exports = { AutoRunner };
