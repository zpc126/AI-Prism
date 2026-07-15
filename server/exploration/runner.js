// input: Web 后台地址、探索范围、限次/持续策略、可选时长与本地登录凭据
// output: 受动作或时间策略控制的 Agent 探索、可信问题、复用流程与截图证据
// position: Web AI 探索执行器，隔离普通脚本回放并限制跨域和高风险操作

const path = require('path');
const { jsonrepair } = require('jsonrepair');
const { PIAgent } = require('../pi/pi-agent');
const {
  browserTool,
  switchDevice,
  navigate,
  fill,
  click,
  getSnapshot,
  screenshot,
  closeBrowser,
} = require('../pi/tools/browser');

const RESULT_MARKER = '###EXPLORATION_RESULT###';
const RISKY_TARGET_PATTERN = /删除|移除|清空|作废|下线|发布|支付|退款|发货|审核通过|审核拒绝|确认收货|保存|提交|确定|delete|remove|clear|publish|refund|approve|reject|confirm|submit|save/i;

const EXPLORATION_SYSTEM_PROMPT = `你是 Prism 的 Web 后台探索测试工程师，只测试已经打开的目标系统。

你的职责是像资深 QA 一样自主浏览页面、验证交互并记录证据。必须调用 browser 工具观察和操作，不能只给建议。

规则：
1. 只访问任务给出的同源地址，不访问外部站点。
2. 严格遵守只读模式。工具拒绝的动作不要换同义词绕过。
3. 先观察再操作；元素失败时重新获取页面快照，最多换两种定位方式。
4. 只有实际复现且有页面证据的问题才能列为 finding，不把猜测当缺陷。
5. 不读取、输出或猜测登录密码、Token、Cookie 等敏感信息。
6. 结束时按任务指定格式返回结构化结果。`;

function normalizeTargetUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('探索地址只支持 http 或 https');
  }
  url.hash = '';
  return url.toString();
}

function isRiskyTarget(target) {
  return RISKY_TARGET_PATTERN.test(String(target || ''));
}

function normalizeOptionalDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.min(Math.max(number, 1), 1440);
}

function findJsonObject(text, startIndex = 0) {
  const source = String(text || '');
  const start = source.indexOf('{', startIndex);
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

function normalizeExplorationResult(value = {}) {
  const findings = Array.isArray(value.findings) ? value.findings : [];
  const coverage = Array.isArray(value.coverage) ? value.coverage : [];
  const reusableFlows = Array.isArray(value.reusableFlows) ? value.reusableFlows : [];
  return {
    summary: String(value.summary || '').trim(),
    coverage: coverage.map(item => ({
      area: String(item?.area || item?.name || '未命名区域').trim(),
      status: ['passed', 'partial', 'blocked', 'failed'].includes(item?.status) ? item.status : 'partial',
      notes: String(item?.notes || item?.detail || '').trim(),
    })),
    findings: findings.map((item, index) => ({
      id: String(item?.id || `finding-${index + 1}`),
      title: String(item?.title || `探索发现 ${index + 1}`).trim(),
      severity: /^P[0-3]$/.test(String(item?.severity || '').toUpperCase())
        ? String(item.severity).toUpperCase()
        : 'P2',
      currentBehavior: String(item?.currentBehavior || item?.actual || '').trim(),
      expectedBehavior: String(item?.expectedBehavior || item?.expected || '').trim(),
      reproductionSteps: normalizeStringArray(item?.reproductionSteps || item?.steps),
      evidence: normalizeStringArray(item?.evidence),
      confidence: ['high', 'medium', 'low'].includes(item?.confidence) ? item.confidence : 'medium',
    })),
    reusableFlows: reusableFlows.map((item, index) => ({
      name: String(item?.name || `流程 ${index + 1}`).trim(),
      steps: normalizeStringArray(item?.steps),
      expected: String(item?.expected || '').trim(),
    })),
  };
}

function parseExplorationResult(text) {
  const source = String(text || '');
  const markerIndex = source.lastIndexOf(RESULT_MARKER);
  const jsonText = findJsonObject(source, markerIndex >= 0 ? markerIndex + RESULT_MARKER.length : 0);
  if (!jsonText) return null;
  try {
    return normalizeExplorationResult(JSON.parse(jsonrepair(jsonText)));
  } catch {
    return null;
  }
}

class ExplorationRunner {
  constructor(options = {}) {
    this.id = options.id;
    this.targetUrl = normalizeTargetUrl(options.targetUrl);
    this.targetOrigin = new URL(this.targetUrl).origin;
    this.scope = String(options.scope || '').trim();
    this.readOnly = options.readOnly !== false;
    this.continuous = options.continuous === true;
    this.maxActions = Math.min(Math.max(Number(options.maxActions) || 24, 8), 50);
    this.maxDurationMinutes = normalizeOptionalDuration(options.maxDurationMinutes);
    this.username = String(options.username || '');
    this.password = String(options.password || '');
    this.onEvent = options.onEvent || (() => {});
    this.agent = null;
    this.stopped = false;
    this.actionCount = 0;
    this.actions = [];
    this.screenshots = [];
    this.logs = [];
    this.transcript = '';
    this.durationTimer = null;
  }

  emit(type, data = {}) {
    const event = { type, ...data, timestamp: new Date().toISOString() };
    if (['status', 'log', 'action', 'blocked'].includes(type)) {
      this.logs.push(event);
      if (this.logs.length > 300) this.logs.shift();
    }
    this.onEvent(event);
  }

  ensureRunning() {
    if (this.stopped) {
      const error = new Error('探索已停止');
      error.code = 'EXPLORATION_STOPPED';
      throw error;
    }
  }

  registerScreenshot(result) {
    const filepath = result?.details?.filepath || result?.filepath;
    if (!filepath) return;
    const filename = path.basename(filepath);
    if (!this.screenshots.some(item => item.filename === filename)) {
      this.screenshots.push({
        filename,
        label: String(result?.details?.filename || result?.filename || filename),
        url: String(result?.details?.url || result?.url || ''),
      });
    }
  }

  isSameOrigin(value) {
    try {
      return new URL(value, this.targetUrl).origin === this.targetOrigin;
    } catch {
      return false;
    }
  }

  makeBrowserTool() {
    return {
      ...browserTool,
      description: '在当前 Web 后台执行受限探索操作；受同源、只读和动作/时长策略保护',
      execute: async (toolCallId, params = {}) => {
        this.ensureRunning();
        if (!this.continuous && this.actionCount >= this.maxActions) {
          const message = `已达到 ${this.maxActions} 个探索动作上限，请停止操作并输出结果`;
          this.emit('blocked', { message, action: params.action || '' });
          return {
            content: [{ type: 'text', text: message }],
            details: { error: message, limitReached: true },
            isError: true,
          };
        }
        if (params.action === 'switch_device' && /手机|mobile|android|ios/i.test(String(params.target || params.value || ''))) {
          const message = '当前探索任务仅支持 Web 后台';
          this.emit('blocked', { message, action: params.action });
          return { content: [{ type: 'text', text: message }], details: { error: message }, isError: true };
        }
        if (params.action === 'navigate' && !this.isSameOrigin(params.target)) {
          const message = '已阻止跳转到目标系统之外的地址';
          this.emit('blocked', { message, action: params.action, target: params.target || '' });
          return { content: [{ type: 'text', text: message }], details: { error: message }, isError: true };
        }
        if (params.action === 'click') {
          const snapshot = await getSnapshot().catch(() => null);
          const normalizedTarget = String(params.target || '').replace(/\s+/g, '').toLowerCase();
          const matchingLinks = (snapshot?.snapshot?.links || []).filter(link => {
            const normalizedText = String(link.text || '').replace(/\s+/g, '').toLowerCase();
            return normalizedTarget && normalizedText.includes(normalizedTarget);
          });
          if (matchingLinks.some(link => link.href && !this.isSameOrigin(link.href))) {
            const message = `已阻止点击目标系统之外的链接：${params.target}`;
            this.emit('blocked', { message, action: params.action, target: params.target || '' });
            return { content: [{ type: 'text', text: message }], details: { error: message }, isError: true };
          }
        }
        if (this.readOnly && params.action === 'click' && isRiskyTarget(params.target)) {
          const message = `只读模式已阻止高风险操作：${params.target}`;
          this.emit('blocked', { message, action: params.action, target: params.target || '' });
          return { content: [{ type: 'text', text: message }], details: { error: message }, isError: true };
        }

        this.actionCount++;
        const safeAction = {
          index: this.actionCount,
          action: params.action || '',
          target: params.target || '',
          value: params.action === 'fill' ? '***' : (params.value || ''),
        };
        this.emit('action', safeAction);
        const result = await browserTool.execute(toolCallId, params);
        safeAction.success = !result?.isError;
        safeAction.error = result?.details?.error || '';
        this.actions.push(safeAction);
        if (params.action === 'screenshot' && !result?.isError) this.registerScreenshot(result);
        return result;
      },
    };
  }

  async preparePage() {
    this.emit('status', { stage: 'prepare', message: '正在打开目标后台' });
    await switchDevice('web');
    await navigate(this.targetUrl);
    let snapshot = await getSnapshot();
    const inputs = snapshot?.snapshot?.inputs || [];
    const needsLogin = inputs.some(item => String(item.type || '').toLowerCase() === 'password');
    if (!needsLogin || (!this.username && !this.password)) return snapshot;
    if (!this.username || !this.password) {
      throw new Error('目标页面需要登录，请同时填写账号和密码');
    }

    this.emit('status', { stage: 'login', message: '正在完成本地登录前置' });
    await fill('账号', this.username);
    await fill('密码', this.password);
    await click('登录');
    await new Promise(resolve => setTimeout(resolve, 1200));
    snapshot = await getSnapshot();
    if ((snapshot?.snapshot?.inputs || []).some(item => String(item.type || '').toLowerCase() === 'password')) {
      throw new Error('登录后仍停留在登录页，请检查账号密码、验证码或登录限制');
    }
    this.emit('status', { stage: 'login', message: '登录前置完成，凭据未发送给模型' });
    return snapshot;
  }

  handleAgentEvent(type, data) {
    if (type === 'text' && data) {
      this.transcript += data;
      if (this.transcript.length > 160000) this.transcript = this.transcript.slice(-160000);
      this.onEvent({ type: 'agent_text', text: data, timestamp: new Date().toISOString() });
      return;
    }
    if (type === 'tool_end' && data?.result?.details?.error) {
      this.emit('log', { level: 'error', message: data.result.details.error });
    }
  }

  buildPrompt() {
    const readOnlyRule = this.readOnly
      ? '当前为只读探索：不要点击保存、提交、删除、发布、审核、支付等会改变业务数据的控件。可以填写表单来检查前端校验，但不得提交。'
      : '当前允许写操作，但仍禁止删除、支付、退款、发布、发货、审核等不可逆或高影响操作。';
    const actionPolicy = this.continuous
      ? '浏览器动作：持续探索，不限制动作数量；由用户手动停止或时长限制停止。'
      : `最多浏览器动作：${this.maxActions}`;
    const durationPolicy = this.maxDurationMinutes
      ? `最长运行时间：${this.maxDurationMinutes} 分钟`
      : '最长运行时间：不限时';
    return `开始一次 Web 后台探索测试。

目标地址：${this.targetUrl}
探索重点：${this.scope || '核心导航、列表查询、筛选、详情页、表单校验、错误状态和权限反馈'}
${actionPolicy}
${durationPolicy}
${readOnlyRule}

执行要求：
1. 先调用 get_snapshot 识别当前页面、登录态和主导航。
2. 优先覆盖 3 到 6 个核心业务区域；对列表、筛选、分页、详情、空状态和表单校验做实际操作。
3. 遇到可信问题时调用 screenshot，标签使用 issue_1、issue_2 递增。
4. 不要为了凑数量报告问题；无法验证的内容放在 coverage.notes，不列为 finding。
5. 限次模式下动作接近上限时立即停止；持续模式下完成一轮核心区域覆盖后继续寻找未覆盖区域，直到用户或时长策略停止。

最终必须输出以下标记和严格 JSON，标记之前可以简短说明过程，标记之后不要再调用工具：
${RESULT_MARKER}
{
  "summary": "本次探索结论",
  "coverage": [
    { "area": "区域名称", "status": "passed|partial|blocked|failed", "notes": "验证内容与结果" }
  ],
  "findings": [
    {
      "id": "finding-1",
      "title": "问题标题",
      "severity": "P0|P1|P2|P3",
      "currentBehavior": "实际行为",
      "expectedBehavior": "期望行为",
      "reproductionSteps": ["步骤 1", "步骤 2"],
      "evidence": ["截图标签、页面 URL 或错误提示"],
      "confidence": "high|medium|low"
    }
  ],
  "reusableFlows": [
    { "name": "已实际走通的流程", "steps": ["步骤 1", "步骤 2"], "expected": "最终页面状态" }
  ]
}`;
  }

  async run() {
    this.ensureRunning();
    this.startDurationTimer();
    await this.preparePage();
    this.ensureRunning();
    this.emit('status', { stage: 'explore', message: 'Prism Agent 开始探索' });

    this.agent = new PIAgent({
      cwd: process.cwd(),
      systemPrompt: EXPLORATION_SYSTEM_PROMPT,
      tools: ['browser'],
      customTools: [this.makeBrowserTool()],
      onEvent: (type, data) => this.handleAgentEvent(type, data),
    });
    await this.agent.init();
    await this.agent.prompt(this.buildPrompt());
    this.ensureRunning();

    let result = parseExplorationResult(this.transcript);
    if (!result) {
      this.emit('status', { stage: 'summarize', message: '正在整理结构化结果' });
      await this.agent.prompt(`停止所有 browser 工具调用。根据刚才已经完成的探索，只输出 ${RESULT_MARKER} 和约定的 JSON；不要补写没有实际验证的问题。`);
      result = parseExplorationResult(this.transcript);
    }

    const finalShot = await screenshot(`exploration_${this.id}_final`).catch(() => null);
    if (finalShot) this.registerScreenshot(finalShot);
    const normalized = result || {
      summary: '探索已执行，但 Agent 未返回可解析的结构化结果，请查看过程日志和最终截图。',
      coverage: [],
      findings: [],
      reusableFlows: [],
    };
    this.emit('status', { stage: 'complete', message: `探索完成，发现 ${normalized.findings.length} 个问题` });
    this.clearDurationTimer();
    return {
      ...normalized,
      actions: this.actions,
      screenshots: this.screenshots,
      logs: this.logs,
    };
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.clearDurationTimer();
    this.emit('status', { stage: 'stopped', message: '正在停止探索' });
    await this.agent?.dispose().catch(() => {});
    this.agent = null;
    await closeBrowser().catch(() => {});
  }

  async dispose() {
    this.clearDurationTimer();
    await this.agent?.dispose().catch(() => {});
    this.agent = null;
  }

  startDurationTimer() {
    if (!this.maxDurationMinutes || this.durationTimer) return;
    this.durationTimer = setTimeout(() => {
      if (this.stopped) return;
      this.emit('status', {
        stage: 'duration_limit',
        message: `已达到 ${this.maxDurationMinutes} 分钟时长上限，正在停止探索`,
      });
      this.stop().catch(() => {});
    }, this.maxDurationMinutes * 60 * 1000);
    this.durationTimer.unref?.();
  }

  clearDurationTimer() {
    if (!this.durationTimer) return;
    clearTimeout(this.durationTimer);
    this.durationTimer = null;
  }
}

module.exports = {
  ExplorationRunner,
  normalizeTargetUrl,
  isRiskyTarget,
  normalizeOptionalDuration,
  parseExplorationResult,
  normalizeExplorationResult,
};
