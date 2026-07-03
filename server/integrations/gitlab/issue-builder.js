// input: 自动化测试报告、失败用例结果
// output: 可编辑的 GitLab Issue 草稿
// position: 把 Prism 报告转换成 Bug 描述

const crypto = require('crypto');

function clip(value, max = 1200) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatSteps(result) {
  const detailSteps = Array.isArray(result.case_detail?.steps) ? result.case_detail.steps : [];
  const executedSteps = Array.isArray(result.steps) ? result.steps : [];
  const source = detailSteps.length
    ? detailSteps.map((step, index) => ({ index: index + 1, description: step }))
    : executedSteps.map(step => ({ index: step.step_index, description: step.description, status: step.status, error: step.error_message }));

  if (!source.length) return '暂无步骤';
  return source.map(step => {
    const suffix = step.status ? `（${step.status}${step.error ? `：${step.error}` : ''}）` : '';
    return `${step.index}. ${step.description}${suffix}`;
  }).join('\n');
}

function buildFingerprint(report, result) {
  const raw = [
    report.id,
    result.case_id,
    result.case_title,
    result.category,
    result.error_message,
  ].filter(Boolean).join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

function formatAttachmentSection(attachments = []) {
  if (!attachments.length) return '- 提交 Issue 时会自动上传报告中的截图/视频';
  return attachments.map((attachment, index) => {
    const label = attachment.label || `附件 ${index + 1}`;
    return `- ${label}：${attachment.markdown || attachment.url || attachment.filename || '-'}`;
  }).join('\n');
}

function buildReportUrl(report, config = {}) {
  const path = `/reports.html?id=${encodeURIComponent(report.id)}`;
  const baseUrl = String(config.reportBaseUrl || '').trim().replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}${path}` : path;
}

function buildIssueDraft(report, result, config = {}, attachments = []) {
  const detail = result.case_detail || {};
  const fingerprint = buildFingerprint(report, result);
  const statusLabel = {
    passed: '通过',
    failed: '失败',
    stopped: '停止',
    running: '运行中',
    pending: '待执行',
  }[result.status] || result.status || '未知';
  const title = `[Prism-BUG][${statusLabel}][${result.category || '自动化'}] ${result.case_title || '自动化测试结果'}`;
  const reportUrl = buildReportUrl(report, config);
  const labels = config.labels || 'bug,Prism';
  const description = [
    '## 概述',
    clip(result.error_message || `自动化用例执行状态：${statusLabel}。请结合 Prism 报告中的步骤、截图或视频定位。`),
    '',
    '## 用例信息',
    `- 报告：${report.title || report.id}`,
    `- 用例：${result.case_title || '-'}`,
    `- 模块：${result.category || '-'}`,
    `- 优先级：${result.priority || '-'}`,
    `- 执行状态：${statusLabel}`,
    `- 用例 ID：${detail.id || result.case_id || '-'}`,
    `- Prism 报告：[${reportUrl}](${reportUrl})`,
    `- 指纹：${fingerprint}`,
    '',
    '## 前置条件',
    clip(detail.precondition || detail.preconditions || '未提供'),
    '',
    '## 操作步骤',
    formatSteps(result),
    '',
    '## 预期结果',
    clip(detail.expected || '未提供'),
    '',
    '## 实际结果',
    clip(result.error_message || `用例执行${statusLabel}`),
    '',
    '## 附件',
    formatAttachmentSection(attachments),
    '',
    '## 执行环境',
    `- 执行时间：${result.started_at || report.started_at || '-'}`,
    `- 耗时：${result.duration_ms || 0}ms`,
  ].join('\n');

  return {
    title,
    description,
    labels,
    assigneeIds: config.assigneeIds || '',
    fingerprint,
  };
}

module.exports = {
  buildIssueDraft,
};
