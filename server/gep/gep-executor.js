// input: Gene 列表，执行配置
// output: 执行结果（含 Capsule 和 Insights）
// position: GEP 核心执行器 - 双通道方案（Accessibility Tree + 截图验证）

/**
 * GEP 执行器的核心设计：
 * 
 * 1. 双通道理解页面：
 *    - Accessibility Tree：结构化理解，精准定位
 *    - 截图：视觉验证，确认结果
 * 
 * 2. 三种执行策略：
 *    - 复用（reuse）：环境高度匹配，直接按 Capsule 路径执行
 *    - 适配（adapt）：环境部分变化，参考路径但灵活调整
 *    - 探索（explore）：全新环境，从头理解页面
 * 
 * 3. 经验进化：
 *    - 每次执行提取 Insights
 *    - 下次执行注入相关 Insights
 *    - 跑得越多越快越稳
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { getGeneById, createGene, extractGeneFromTestCase } = require('./gene');
const { createCapsule, getBestCapsule, calculateEnvMatch, decideStrategy } = require('./capsule');
const { createInsight, getRelevantInsights, extractInsightsFromLog } = require('./insights');
const { callLLM } = require('../ai/generate');

class GEPExecutor {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.reportDir = options.reportDir || path.join(os.tmpdir(), 'scout-gep-reports');
    this.screenshotIndex = 0;
    this.onLog = options.onLog || (() => {});

    // 确保报告目录存在
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  // ==================== 浏览器管理 ====================

  getChromeUserDataDir() {
    const platform = process.platform;
    if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
    } else if (platform === 'win32') {
      return path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data');
    }
    return path.join(os.homedir(), '.config/google-chrome');
  }

  async launch() {
    this.onLog({ type: 'system', text: '正在启动 Chrome...' });

    try {
      // 直接启动干净浏览器，不尝试继承登录态（避免冲突）
      this.browser = await chromium.launch({
        headless: false,
        channel: 'chrome',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--start-maximized',
        ],
      });
      
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      
      this.page = await this.context.newPage();
      this.onLog({ type: 'success', text: '✓ 浏览器已启动' });
    } catch (e) {
      this.onLog({ type: 'error', text: `启动失败: ${e.message}` });
      throw e;
    }
  }

  async close() {
    try {
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch {}
  }

  // ==================== 环境指纹 ====================

  async getEnvironmentFingerprint() {
    const url = this.page.url();
    const title = await this.page.title();

    // 获取 Accessibility Tree
    const accessibilityTree = await this.getAccessibilityTree();

    // 提取关键元素（按钮、链接、输入框）
    const keyElements = this.extractKeyElements(accessibilityTree);

    // 计算结构哈希
    const accessibilityTreeHash = this.hashAccessibilityTree(accessibilityTree);

    return {
      url,
      title,
      keyElements,
      accessibilityTreeHash,
      timestamp: Date.now(),
    };
  }

  async getAccessibilityTree() {
    try {
      // Playwright 的 accessibility snapshot
      const snapshot = await this.page.accessibility.snapshot();
      return snapshot;
    } catch (e) {
      this.onLog({ type: 'stderr', text: `获取 Accessibility Tree 失败: ${e.message}` });
      return null;
    }
  }

  extractKeyElements(tree) {
    const elements = [];
    if (!tree) return elements;

    const traverse = (node) => {
      if (node.role && ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(node.role)) {
        elements.push({
          role: node.role,
          name: node.name || '',
          value: node.value || '',
        });
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree);
    return elements;
  }

  hashAccessibilityTree(tree) {
    if (!tree) return '';
    const str = JSON.stringify(tree);
    // 简单哈希
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  // ==================== 截图管理 ====================

  async takeScreenshot(label) {
    this.screenshotIndex++;
    const filename = `${this.screenshotIndex}_${label}_${Date.now()}.png`;
    const filepath = path.join(this.reportDir, filename);

    try {
      await this.page.screenshot({ path: filepath, fullPage: false });
      return filepath;
    } catch (e) {
      this.onLog({ type: 'stderr', text: `截图失败: ${e.message}` });
      return null;
    }
  }

  // ==================== 核心执行 ====================

  /**
   * 执行单个 Gene
   */
  async executeGene(gene, options = {}) {
    const startTime = Date.now();
    const executionLog = {
      geneId: gene.id,
      strategy: 'explore',
      status: 'pending',
      stepsLog: [],
      insightsGained: [],
    };

    this.onLog({ type: 'info', text: `━━━ 执行 Gene: ${gene.intent} ━━━` });

    // 1. 获取当前环境指纹
    const currentFingerprint = await this.getEnvironmentFingerprint();

    // 2. 查找最佳 Capsule
    const bestCapsule = getBestCapsule(gene.id);

    // 3. 决定执行策略
    let strategy = 'explore';
    if (bestCapsule) {
      const matchScore = calculateEnvMatch(bestCapsule.envFingerprint, currentFingerprint);
      strategy = decideStrategy(matchScore);
      this.onLog({ type: 'system', text: `环境匹配度: ${(matchScore * 100).toFixed(0)}% → 策略: ${strategy}` });
    } else {
      this.onLog({ type: 'system', text: '无历史 Capsule，使用探索策略' });
    }

    executionLog.strategy = strategy;

    // 4. 获取相关 Insights
    const insights = getRelevantInsights(gene.id, {
      url: currentFingerprint.url,
      title: currentFingerprint.title,
    });

    if (insights.length > 0) {
      this.onLog({ type: 'system', text: `注入 ${insights.length} 条历史经验` });
    }

    // 5. 根据策略执行
    let result;
    try {
      switch (strategy) {
        case 'reuse':
          result = await this.executeWithReuse(gene, bestCapsule, insights);
          break;
        case 'adapt':
          result = await this.executeWithAdapt(gene, bestCapsule, currentFingerprint, insights);
          break;
        case 'explore':
        default:
          result = await this.executeWithExplore(gene, currentFingerprint, insights);
          break;
      }

      executionLog.status = result.status;
      executionLog.stepsLog = result.stepsLog;
    } catch (error) {
      executionLog.status = 'failed';
      this.onLog({ type: 'error', text: `执行异常: ${error.message}` });
    }

    // 6. 保存 Capsule（如果成功）
    if (executionLog.status === 'success') {
      const finalFingerprint = await this.getEnvironmentFingerprint();
      createCapsule({
        geneId: gene.id,
        path: executionLog.stepsLog,
        envFingerprint: finalFingerprint,
        status: 'success',
        durationMs: Date.now() - startTime,
      });
      this.onLog({ type: 'success', text: '✓ Capsule 已保存' });
    }

    // 7. 提取并保存 Insights
    const newInsights = extractInsightsFromLog(executionLog.stepsLog, gene.id);
    for (const insight of newInsights) {
      createInsight(insight);
    }
    executionLog.insightsGained = newInsights;

    executionLog.durationMs = Date.now() - startTime;
    this.onLog({ type: 'system', text: `执行完成，耗时 ${(executionLog.durationMs / 1000).toFixed(1)}s` });

    return executionLog;
  }

  // ==================== 复用策略 ====================

  async executeWithReuse(gene, capsule, insights) {
    this.onLog({ type: 'thinking', text: '复用策略：直接按历史路径执行' });

    const stepsLog = [];
    const path = capsule.path || [];

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const stepStart = Date.now();

      this.onLog({ type: 'thinking', text: `步骤 ${i + 1}: ${step.description}` });

      try {
        // 直接执行步骤
        await this.executeStep(step);

        // 截图验证
        const screenshot = await this.takeScreenshot(`step_${i + 1}`);

        stepsLog.push({
          ...step,
          status: 'success',
          screenshotPath: screenshot,
          durationMs: Date.now() - stepStart,
        });

        this.onLog({ type: 'success', text: `✓ 步骤 ${i + 1} 完成` });
      } catch (error) {
        this.onLog({ type: 'error', text: `✗ 步骤 ${i + 1} 失败: ${error.message}` });

        // 复用失败，降级为适配策略
        this.onLog({ type: 'system', text: '复用失败，降级为适配策略' });
        return this.executeWithAdapt(gene, capsule, await this.getEnvironmentFingerprint(), insights);
      }
    }

    // 验证验收条件
    const verified = await this.verifyAcceptance(gene.acceptance);
    const status = verified ? 'success' : 'failed';

    return { status, stepsLog };
  }

  // ==================== 适配策略 ====================

  async executeWithAdapt(gene, capsule, currentFingerprint, insights) {
    this.onLog({ type: 'thinking', text: '适配策略：参考历史路径，灵活调整' });

    const stepsLog = [];
    const path = capsule.path || [];

    // 构建提示词，包含历史路径和当前页面信息
    const accessibilityTree = await this.getAccessibilityTree();
    const prompt = this.buildAdaptPrompt(gene, path, accessibilityTree, insights);

    try {
      // 调用 LLM 生成适配后的步骤
      const adaptedSteps = await this.getAdaptedSteps(prompt);

      for (let i = 0; i < adaptedSteps.length; i++) {
        const step = adaptedSteps[i];
        const stepStart = Date.now();

        this.onLog({ type: 'thinking', text: `步骤 ${i + 1}: ${step.description}` });

        try {
          await this.executeStep(step);

          const screenshot = await this.takeScreenshot(`step_${i + 1}`);

          stepsLog.push({
            ...step,
            status: 'success',
            screenshotPath: screenshot,
            durationMs: Date.now() - stepStart,
          });

          this.onLog({ type: 'success', text: `✓ 步骤 ${i + 1} 完成` });
        } catch (error) {
          stepsLog.push({
            ...step,
            status: 'failed',
            error: error.message,
            durationMs: Date.now() - stepStart,
          });

          this.onLog({ type: 'error', text: `✗ 步骤 ${i + 1} 失败: ${error.message}` });

          // 尝试恢复
          const recovered = await this.tryRecover(step, error, insights);
          if (!recovered) {
            return { status: 'failed', stepsLog };
          }
        }
      }
    } catch (error) {
      this.onLog({ type: 'error', text: `适配失败: ${error.message}` });
      return { status: 'failed', stepsLog };
    }

    const verified = await this.verifyAcceptance(gene.acceptance);
    return { status: verified ? 'success' : 'failed', stepsLog };
  }

  // ==================== 探索策略 ====================

  async executeWithExplore(gene, currentFingerprint, insights) {
    this.onLog({ type: 'thinking', text: '探索策略：从头理解页面，生成执行计划' });

    const stepsLog = [];
    const accessibilityTree = await this.getAccessibilityTree();

    // 截图当前页面
    const initialScreenshot = await this.takeScreenshot('initial');

    // 构建探索提示词
    const prompt = this.buildExplorePrompt(gene, accessibilityTree, currentFingerprint, insights);

    try {
      // 调用 LLM 生成执行步骤
      const steps = await this.getExplorationSteps(prompt);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStart = Date.now();

        this.onLog({ type: 'thinking', text: `步骤 ${i + 1}: ${step.description}` });

        try {
          await this.executeStep(step);

          const screenshot = await this.takeScreenshot(`step_${i + 1}`);

          stepsLog.push({
            ...step,
            status: 'success',
            screenshotPath: screenshot,
            durationMs: Date.now() - stepStart,
          });

          this.onLog({ type: 'success', text: `✓ 步骤 ${i + 1} 完成` });
        } catch (error) {
          stepsLog.push({
            ...step,
            status: 'failed',
            error: error.message,
            durationMs: Date.now() - stepStart,
          });

          this.onLog({ type: 'error', text: `✗ 步骤 ${i + 1} 失败: ${error.message}` });

          // 尝试恢复
          const recovered = await this.tryRecover(step, error, insights);
          if (!recovered) {
            return { status: 'failed', stepsLog };
          }
        }
      }
    } catch (error) {
      this.onLog({ type: 'error', text: `探索失败: ${error.message}` });
      return { status: 'failed', stepsLog };
    }

    const verified = await this.verifyAcceptance(gene.acceptance);
    return { status: verified ? 'success' : 'failed', stepsLog };
  }

  // ==================== 步骤执行 ====================

  async executeStep(step) {
    const action = step.action || 'interact';
    const target = step.target || step.description;
    const value = step.value;

    this.onLog({ type: 'info', text: `执行操作: ${action} ${target || ''}` });

    switch (action) {
      case 'navigate':
        await this.page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(2000); // 等待页面完全加载
        break;

      case 'click':
        await this.clickElement(target);
        break;

      case 'type':
      case 'fill':
        await this.fillInput(target, value);
        break;

      case 'submit':
        await this.page.keyboard.press('Enter');
        break;

      case 'select':
        await this.page.selectOption(step.selector, value);
        break;

      case 'wait':
        await this.page.waitForTimeout(step.duration || 2000);
        break;

      case 'press':
        await this.page.keyboard.press(value || 'Enter');
        break;

      case 'scroll':
        await this.page.evaluate((direction) => {
          window.scrollBy(0, direction === 'down' ? 300 : -300);
        }, value || 'down');
        break;

      case 'interact':
      default:
        // 尝试推断操作
        await this.inferredInteraction(target);
        break;
    }
  }

  async clickElement(target) {
    this.onLog({ type: 'info', text: `点击元素: ${target}` });
    
    const selectors = [
      // Accessibility Tree 定位
      () => this.page.getByRole('button', { name: new RegExp(target, 'i') }).first().click({ timeout: 3000 }),
      () => this.page.getByRole('link', { name: new RegExp(target, 'i') }).first().click({ timeout: 3000 }),
      () => this.page.getByText(target, { exact: false }).first().click({ timeout: 3000 }),
      // CSS 选择器
      () => this.page.locator(`button:has-text("${target}")`).first().click({ timeout: 3000 }),
      () => this.page.locator(`a:has-text("${target}")`).first().click({ timeout: 3000 }),
      () => this.page.locator(`[aria-label*="${target}" i]`).first().click({ timeout: 3000 }),
      // 通用文本定位
      () => this.page.locator(`text=${target}`).first().click({ timeout: 3000 }),
    ];

    for (const selector of selectors) {
      try {
        await selector();
        return;
      } catch {
        continue;
      }
    }
    
    throw new Error(`找不到元素: ${target}`);
  }

  async fillInput(target, value) {
    this.onLog({ type: 'info', text: `输入内容: ${value}` });
    
    const selectors = [
      // Accessibility Tree 定位
      () => this.page.getByRole('textbox', { name: new RegExp(target || 'input', 'i') }).first(),
      () => this.page.getByPlaceholder(new RegExp(target || 'input', 'i')).first(),
      // ChatGPT 特殊处理
      () => this.page.locator('#prompt-textarea').first(),
      () => this.page.locator('textarea[placeholder]').first(),
      // CSS 选择器
      () => this.page.locator('input[type="text"]:visible').first(),
      () => this.page.locator('textarea:visible').first(),
      () => this.page.locator('[contenteditable="true"]').first(),
    ];

    for (const selector of selectors) {
      try {
        const input = selector();
        await input.click({ timeout: 2000 });
        await input.fill(value);
        return;
      } catch {
        continue;
      }
    }
    
    // 最后降级：键盘输入
    await this.page.keyboard.type(value, { delay: 50 });
  }

  async inferredInteraction(target) {
    // 推断交互方式
    const lowerTarget = target.toLowerCase();

    if (/^(输入|填写|填入)/.test(lowerTarget)) {
      const content = target.replace(/^(输入|填写|填入)\s*/, '').trim();
      await this.fillInput('', content);
    } else if (/^(点击|按|选择)/.test(lowerTarget)) {
      const element = target.replace(/^(点击|按|选择)\s*/, '').trim();
      await this.clickElement(element);
    } else {
      // 默认尝试点击
      await this.clickElement(target);
    }
  }

  // ==================== 验证和恢复 ====================

  async verifyAcceptance(acceptance) {
    if (!acceptance || acceptance.length === 0) return true;

    this.onLog({ type: 'thinking', text: '验证验收条件...' });

    const pageContent = await this.page.content();
    const pageText = await this.page.innerText('body');

    for (const condition of acceptance) {
      // 简单的文本匹配验证
      if (pageText.includes(condition)) {
        this.onLog({ type: 'success', text: `✓ 验收通过: ${condition}` });
      } else {
        this.onLog({ type: 'error', text: `✗ 验收失败: ${condition}` });
        return false;
      }
    }

    return true;
  }

  async tryRecover(failedStep, error, insights) {
    this.onLog({ type: 'thinking', text: '尝试恢复...' });

    // 查找相关的 Insights
    const relevantInsights = insights.filter(i =>
      i.type === 'alternative_path' || i.type === 'selector_change'
    );

    if (relevantInsights.length > 0) {
      // 使用历史经验尝试恢复
      for (const insight of relevantInsights) {
        try {
          this.onLog({ type: 'system', text: `尝试经验: ${insight.content}` });
          // 这里可以实现更复杂的恢复逻辑
          return true;
        } catch {
          continue;
        }
      }
    }

    // 截图记录失败状态
    await this.takeScreenshot('failed_state');
    return false;
  }

  // ==================== LLM 提示词构建 ====================

  buildExplorePrompt(gene, accessibilityTree, fingerprint, insights) {
    const insightsText = insights.length > 0
      ? `\n\n历史经验（参考但不必须）：\n${insights.map(i => `- ${i.content}`).join('\n')}`
      : '';

    return `你是一个自动化测试执行器。请根据以下信息生成执行步骤。

## 测试意图
${gene.intent}

## 验收条件
${gene.acceptance.map(a => `- ${a}`).join('\n')}

## 当前页面
URL: ${fingerprint.url}
标题: ${fingerprint.title}

## 页面结构（Accessibility Tree）
${JSON.stringify(accessibilityTree, null, 2).substring(0, 3000)}
${insightsText}

## 执行步骤生成规则
1. 如果意图是"打开某个网站并执行操作"，先 navigate 到网站，然后 wait 等待加载，再执行后续操作
2. 如果需要输入文字，使用 fill 操作，并提供 value 字段
3. 如果需要提交/发送，使用 submit 或 press 操作
4. 每个步骤都要有清晰的 description

请生成执行步骤，格式为 JSON 数组：
[
  {"action": "navigate", "url": "https://example.com", "description": "打开网站"},
  {"action": "wait", "duration": 3000, "description": "等待页面加载"},
  {"action": "fill", "target": "输入框", "value": "要输入的内容", "description": "输入文字"},
  {"action": "submit", "description": "提交表单"}
]

只输出 JSON 数组，不要其他内容。`;
  }

  buildAdaptPrompt(gene, historicalPath, accessibilityTree, insights) {
    return `你是一个自动化测试执行器。请根据历史路径和当前页面，生成适配后的执行步骤。

## 测试意图
${gene.intent}

## 历史执行路径
${JSON.stringify(historicalPath, null, 2)}

## 当前页面结构
${JSON.stringify(accessibilityTree, null, 2).substring(0, 3000)}

## 历史经验
${insights.map(i => `- ${i.content}`).join('\n')}

请参考历史路径，但根据当前页面结构进行适配。输出格式为 JSON 数组。`;
  }

  async getExplorationSteps(prompt) {
    const result = await callLLM(prompt, '');
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.onLog({ type: 'stderr', text: '解析步骤失败' });
    }
    return [];
  }

  async getAdaptedSteps(prompt) {
    return this.getExplorationSteps(prompt);
  }

  // ==================== 批量执行 ====================

  /**
   * 批量执行多个 Gene
   */
  async executeBatch(genes, options = {}) {
    const results = [];
    const { stopOnFailure = false } = options;

    await this.launch();

    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];
      this.onLog({ type: 'system', text: `\n${'═'.repeat(50)}` });
      this.onLog({ type: 'system', text: `Gene ${i + 1}/${genes.length}` });
      this.onLog({ type: 'system', text: `${'═'.repeat(50)}` });

      try {
        // 导航到目标 URL（如果有）
        if (gene.targetUrl) {
          await this.page.goto(gene.targetUrl, { waitUntil: 'domcontentloaded' });
        }

        const result = await this.executeGene(gene, options);
        results.push(result);

        if (result.status === 'failed' && stopOnFailure) {
          this.onLog({ type: 'system', text: '配置了失败停止，终止执行' });
          break;
        }
      } catch (error) {
        results.push({
          geneId: gene.id,
          status: 'failed',
          error: error.message,
        });
      }
    }

    await this.close();
    return results;
  }
}

module.exports = { GEPExecutor };
