// input: 探索执行器的 URL、安全动作、可选时长与结构化结果解析函数
// output: 不依赖浏览器和模型的限次/持续模式核心规则回归验证
// position: Web AI 探索执行器单元测试

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTargetUrl,
  isRiskyTarget,
  normalizeOptionalDuration,
  parseExplorationResult,
} = require('./runner');

test('normalizeTargetUrl only accepts web protocols', () => {
  assert.equal(normalizeTargetUrl('https://example.com/admin#users'), 'https://example.com/admin');
  assert.throws(() => normalizeTargetUrl('file:///tmp/demo.html'), /http 或 https/);
});

test('read-only policy recognizes risky controls', () => {
  assert.equal(isRiskyTarget('删除订单'), true);
  assert.equal(isRiskyTarget('保存并提交'), true);
  assert.equal(isRiskyTarget('查看详情'), false);
});

test('optional duration accepts blank unlimited mode and clamps long runs', () => {
  assert.equal(normalizeOptionalDuration(''), null);
  assert.equal(normalizeOptionalDuration(0), null);
  assert.equal(normalizeOptionalDuration(30), 30);
  assert.equal(normalizeOptionalDuration(2000), 1440);
});

test('parseExplorationResult repairs and normalizes marked JSON', () => {
  const parsed = parseExplorationResult(`过程完成\n###EXPLORATION_RESULT###\n{
    summary: '完成核心导航探索',
    coverage: [{ area: '订单', status: 'passed', notes: '列表可打开' }],
    findings: [{ title: '筛选无反馈', severity: 'p2', steps: ['打开订单', '点击筛选'] }],
    reusableFlows: []
  }`);
  assert.equal(parsed.summary, '完成核心导航探索');
  assert.equal(parsed.findings[0].severity, 'P2');
  assert.deepEqual(parsed.findings[0].reproductionSteps, ['打开订单', '点击筛选']);
});
