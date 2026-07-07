// input: GitLab 配置、报告失败结果、手工 Bug 草稿、项目成员查询、图片附件与 AI 完善请求
// output: GitLab Issue 配置、草稿、报告 Issue、项目成员、手工 Bug 提交、图片附件上传与 AI 完善 API
// position: GitLab Issue 集成路由

const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { callLLM, callLLMWithImage } = require('../../ai/generate');

const {
  REPORTS_DIR,
  addGitLabIssueLink,
  getGitLabIssueLinkByResult,
  getReportById,
  getReportDetail,
  getTestResult,
} = require('../../reports/report-store');
const { buildIssueDraft } = require('./issue-builder');
const { createIssue, listProjectMembers, testConnection, uploadProjectFile } = require('./client');
const { loadGitLabConfig, redactGitLabConfig, saveGitLabConfig } = require('./config');

function handleError(res, error, status = 500) {
  if (status >= 500) {
    console.error('[GitLab]', error);
  }
  res.status(status).json({ success: false, error: error.message || String(error) });
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host');
  return host ? `${protocol}://${host}`.replace(/\/+$/, '') : '';
}

function getGitLabConfigForReport(req) {
  const config = loadGitLabConfig();
  const requestOrigin = getRequestOrigin(req);
  return {
    ...config,
    reportBaseUrl: config.reportBaseUrl || requestOrigin,
  };
}

function buildAbsoluteReportUrl(req, reportId) {
  const config = getGitLabConfigForReport(req);
  const baseUrl = String(config.reportBaseUrl || '').trim().replace(/\/+$/, '');
  return `${baseUrl}/reports.html?id=${encodeURIComponent(reportId)}`;
}

function getReportAndResult(reportId, resultId) {
  const report = getReportById(reportId);
  if (!report) {
    const error = new Error('报告不存在');
    error.status = 404;
    throw error;
  }

  const result = getTestResult(reportId, Number(resultId));
  if (!result) {
    const error = new Error('测试结果不存在');
    error.status = 404;
    throw error;
  }

  return { report, result };
}

function resolveReportFile(reportId, filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    return filePath;
  }

  const direct = path.join(REPORTS_DIR, reportId, path.basename(filePath));
  return fs.existsSync(direct) ? direct : null;
}

function collectResultAttachments(reportId, result) {
  const attachments = [];
  const seen = new Set();
  const addAttachment = (label, filePath) => {
    const resolved = resolveReportFile(reportId, filePath);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    attachments.push({
      label,
      filePath: resolved,
      filename: path.basename(resolved),
    });
  };

  addAttachment('执行视频', result.video_path);
  (result.steps || []).forEach(step => {
    addAttachment(`步骤 ${step.step_index} 截图`, step.screenshot_path);
  });

  return attachments;
}

async function uploadResultAttachments(config, reportId, result) {
  const files = collectResultAttachments(reportId, result);
  const uploaded = [];
  const failed = [];

  for (const file of files) {
    try {
      const upload = await uploadProjectFile(config, file.filePath, file.filename);
      uploaded.push({
        ...file,
        markdown: upload.markdown,
        url: upload.full_path || upload.url,
        upload,
      });
    } catch (error) {
      failed.push({
        ...file,
        error: error.message || String(error),
      });
    }
  }

  return { uploaded, failed };
}

function appendAttachmentNotes(description, uploaded = [], failed = []) {
  const sections = [];
  if (uploaded.length) {
    sections.push([
      '## GitLab 附件',
      ...uploaded.map((item, index) => `- ${item.label || `附件 ${index + 1}`}：${item.markdown || item.url || item.filename}`),
    ].join('\n'));
  }
  if (failed.length) {
    sections.push([
      '## 附件上传失败',
      ...failed.map(item => `- ${item.label || item.filename}：${item.error}`),
    ].join('\n'));
  }
  if (!sections.length) return description;
  return `${description || ''}\n\n${sections.join('\n\n')}`;
}

function normalizeManualAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .slice(0, 6)
    .map((attachment, index) => {
      const filename = path.basename(String(attachment.filename || `bug-image-${index + 1}.png`)).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
      const dataUrl = String(attachment.base64 || attachment.imageBase64 || '').trim();
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
      if (!match) return null;
      const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      if (!buffer.length || buffer.length > 8 * 1024 * 1024) return null;
      return {
        label: attachment.label || `图片 ${index + 1}`,
        filename,
        mimeType: match[1],
        base64: dataUrl,
        buffer,
      };
    })
    .filter(Boolean);
}

async function uploadManualAttachments(config, attachments = []) {
  const files = normalizeManualAttachments(attachments);
  const uploaded = [];
  const failed = [];
  if (!files.length) return { uploaded, failed };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-bug-'));
  try {
    for (const file of files) {
      const filePath = path.join(tempDir, file.filename);
      try {
        fs.writeFileSync(filePath, file.buffer);
        const upload = await uploadProjectFile(config, filePath, file.filename);
        uploaded.push({
          label: file.label,
          filename: file.filename,
          markdown: upload.markdown,
          url: upload.full_path || upload.url,
          upload,
        });
      } catch (error) {
        failed.push({
          label: file.label,
          filename: file.filename,
          error: error.message || String(error),
        });
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return { uploaded, failed };
}

function parseJsonObject(text = '') {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function enhanceManualBugDraft(input = {}) {
  const attachments = normalizeManualAttachments(input.attachments);
  const systemPrompt = [
    '你是资深 QA，负责把用户很粗略的 Bug 描述整理成可提交 GitLab Issue 的中文 Markdown。',
    '必须严格保留用户模板的标题层级：# Bug、摘要、当前行为、期望行为、复现步骤、影响范围、证据、父 case / epic、验证信号。',
    '不要编造项目名、用户、日志、trace ID、父 case、真实接口响应；不确定的内容写“待确认”。',
    '如果用户提供了图片，请把图片中能确认的界面、报错、字段、按钮、状态写进当前行为、复现步骤或证据里。',
    '复现步骤要尽量可执行；影响范围表格必须保留；输出必须是 JSON，不要输出解释文字。',
    'JSON 结构：{"title":"[Bug] ...","description":"完整 Markdown"}。'
  ].join('\n');
  const userContent = [
    '【用户粗略描述】',
    input.brief || '未提供',
    '',
    '【当前标题】',
    input.title || '',
    '',
    '【当前 Markdown 模板/草稿】',
    input.description || '',
    '',
    attachments.length ? `【图片附件】用户提供了 ${attachments.length} 张图片，请优先根据第一张图片可见内容完善 Bug。` : '【图片附件】未提供',
  ].join('\n');
  const raw = attachments.length
    ? await callLLMWithImage(systemPrompt, userContent, attachments[0].base64, 6000)
    : await callLLM(systemPrompt, userContent);
  const parsed = parseJsonObject(raw);
  return {
    title: String(parsed.title || input.title || '[Bug] 待确认').trim(),
    description: String(parsed.description || input.description || '').trim(),
  };
}

router.get('/config', (req, res) => {
  try {
    res.json({ success: true, config: redactGitLabConfig() });
  } catch (error) {
    handleError(res, error);
  }
});

router.put('/config', (req, res) => {
  try {
    const config = saveGitLabConfig(req.body || {});
    res.json({ success: true, config: redactGitLabConfig(config) });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/test-connection', async (req, res) => {
  try {
    const current = loadGitLabConfig();
    const config = {
      ...current,
      ...(req.body || {}),
      token: req.body?.token && req.body.token !== '********' ? req.body.token : current.token,
    };
    const project = await testConnection(config);
    res.json({ success: true, project });
  } catch (error) {
    handleError(res, error, 400);
  }
});

router.get('/users', async (req, res) => {
  try {
    const config = getGitLabConfigForReport(req);
    if (!config.baseUrl || !config.projectId || !config.token) {
      return res.status(400).json({ success: false, error: 'GitLab 配置不完整，请先到设置中填写' });
    }
    const users = await listProjectMembers(config, req.query.query || '');
    res.json({ success: true, users });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

router.post('/issues', async (req, res) => {
  try {
    const config = getGitLabConfigForReport(req);
    if (!config.baseUrl || !config.projectId || !config.token) {
      return res.status(400).json({ success: false, error: 'GitLab 配置不完整，请先到设置中填写' });
    }

    const draft = {
      title: String(req.body?.title || '').trim(),
      description: String(req.body?.description || '').trim(),
      labels: req.body?.labels || config.labels,
      assigneeIds: req.body?.assigneeIds || config.assigneeIds,
      assigneeUsernames: req.body?.assigneeUsernames || '',
    };

    if (!draft.title) {
      return res.status(400).json({ success: false, error: '请填写 Issue 标题' });
    }
    if (!draft.description) {
      return res.status(400).json({ success: false, error: '请填写 Issue 描述' });
    }

    const attachmentResult = await uploadManualAttachments(config, req.body?.attachments);
    draft.description = appendAttachmentNotes(draft.description, attachmentResult.uploaded, attachmentResult.failed);
    const issue = await createIssue(config, draft);
    res.json({ success: true, issue, attachments: attachmentResult });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

router.post('/issues/enhance', async (req, res) => {
  try {
    const attachments = normalizeManualAttachments(req.body?.attachments);
    const hasTextSignal = Boolean(String(req.body?.brief || req.body?.title || req.body?.description || '').trim());
    if (!hasTextSignal && attachments.length === 0) {
      return res.status(400).json({ success: false, error: '请先填写 Bug 现象或上传图片' });
    }
    const draft = await enhanceManualBugDraft(req.body || {});
    if (!draft.description) {
      return res.status(500).json({ success: false, error: 'AI 未返回有效 Bug 描述' });
    }
    res.json({ success: true, draft });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

router.get('/reports/:reportId/link', (req, res) => {
  try {
    const { reportId } = req.params;
    const report = getReportById(reportId);
    if (!report) {
      return res.status(404).json({ success: false, error: '报告不存在' });
    }
    res.json({ success: true, url: buildAbsoluteReportUrl(req, reportId) });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

router.post('/reports/:reportId/results/:resultId/draft', (req, res) => {
  try {
    const { reportId, resultId } = req.params;
    const { report, result } = getReportAndResult(reportId, resultId);
    const config = getGitLabConfigForReport(req);
    const existingIssue = getGitLabIssueLinkByResult(Number(resultId));
    const draft = buildIssueDraft(report, result, config);
    res.json({ success: true, draft, existingIssue });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

router.post('/reports/:reportId/results/:resultId/issue', async (req, res) => {
  try {
    const { reportId, resultId } = req.params;
    const { report, result } = getReportAndResult(reportId, resultId);
    const config = getGitLabConfigForReport(req);
    const attachmentResult = await uploadResultAttachments(config, reportId, result);
    const draft = {
      ...buildIssueDraft(report, result, config),
      ...(req.body || {}),
    };
    draft.description = appendAttachmentNotes(draft.description, attachmentResult.uploaded, attachmentResult.failed);

    const issue = await createIssue(config, draft);
    const link = addGitLabIssueLink({
      reportId,
      resultId: Number(resultId),
      caseId: result.case_id,
      issueIid: issue.iid,
      issueId: issue.id,
      issueUrl: issue.web_url,
      issueTitle: issue.title,
      fingerprint: draft.fingerprint,
      rawResponse: issue,
    });

    res.json({ success: true, issue, link, attachments: attachmentResult });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

router.post('/reports/:reportId/issues', async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = getReportDetail(reportId);
    if (!report) {
      return res.status(404).json({ success: false, error: '报告不存在' });
    }

    const config = getGitLabConfigForReport(req);
    if (!config.baseUrl || !config.projectId || !config.token) {
      return res.status(400).json({ success: false, error: 'GitLab 配置不完整，请先到设置中填写' });
    }

    const requestedIds = Array.isArray(req.body?.resultIds)
      ? new Set(req.body.resultIds.map(id => Number(id)))
      : null;
    const results = (report.results || [])
      .filter(result => result.status === 'failed')
      .filter(result => !requestedIds || requestedIds.has(Number(result.id)));

    const created = [];
    const skipped = [];
    const failed = [];

    for (const result of results) {
      try {
        const attachmentResult = await uploadResultAttachments(config, reportId, result);
        const draft = buildIssueDraft(report, result, config);
        draft.description = appendAttachmentNotes(draft.description, attachmentResult.uploaded, attachmentResult.failed);
        const issue = await createIssue(config, draft);
        const link = addGitLabIssueLink({
          reportId,
          resultId: Number(result.id),
          caseId: result.case_id,
          issueIid: issue.iid,
          issueId: issue.id,
          issueUrl: issue.web_url,
          issueTitle: issue.title,
          fingerprint: draft.fingerprint,
          rawResponse: issue,
        });
        created.push({ resultId: result.id, issue, link, attachments: attachmentResult });
      } catch (error) {
        failed.push({ resultId: result.id, title: result.case_title, error: error.message || String(error) });
      }
    }

    res.json({
      success: failed.length === 0,
      created,
      skipped,
      failed,
      summary: {
        total: results.length,
        created: created.length,
        skipped: skipped.length,
        failed: failed.length,
      },
    });
  } catch (error) {
    handleError(res, error, error.status || 500);
  }
});

module.exports = router;
