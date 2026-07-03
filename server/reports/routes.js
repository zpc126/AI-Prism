// input: HTTP 请求、报告详情数据
// output: 测试报告 API 响应和含用例详情的 HTML
// position: 报告 API 路由，负责报告列表、详情和截图预览

const express = require('express');
const router = express.Router();
const path = require('path');
const {
  getAllReports,
  getReportDetail,
  deleteReport,
  REPORTS_DIR,
} = require('./report-store');

/**
 * 获取所有报告
 */
router.get('/', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const reports = getAllReports(parseInt(limit));
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取报告详情
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const report = getReportDetail(id);
    
    if (!report) {
      return res.status(404).json({ error: '报告不存在' });
    }
    
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取报告的 HTML 视图
 */
router.get('/:id/html', (req, res) => {
  try {
    const { id } = req.params;
    const report = getReportDetail(id);
    
    if (!report) {
      return res.status(404).send('报告不存在');
    }
    
    const html = generateReportHtml(report);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

/**
 * 删除报告
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteReport(id);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 静态文件服务 - 截图
 */
router.get('/:id/screenshots/:filename', (req, res) => {
  const { id, filename } = req.params;
  const filePath = path.join(REPORTS_DIR, id, filename);
  res.sendFile(filePath);
});

router.get('/:id/videos/:filename', (req, res) => {
  const { id, filename } = req.params;
  const filePath = path.join(REPORTS_DIR, id, filename);
  res.sendFile(filePath);
});

/**
 * 生成报告 HTML
 */
function generateReportHtml(report) {
  const statusIcon = (status) => {
    switch (status) {
      case 'passed': return '<span class="status-pass">✓</span>';
      case 'failed': return '<span class="status-fail">✗</span>';
      case 'running': return '<span class="status-run">●</span>';
      default: return '<span class="status-pending">○</span>';
    }
  };
  
  const statusClass = (status) => {
    switch (status) {
      case 'passed': return 'result-passed';
      case 'failed': return 'result-failed';
      case 'running': return 'result-running';
      default: return 'result-pending';
    }
  };
  
  const durationStr = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };
  
  const dateStr = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  
  const passRate = report.total_cases > 0 
    ? Math.round((report.passed_cases / report.total_cases) * 100) 
    : 0;

  const renderCaseDetail = (result) => {
    const detail = result.case_detail || {};
    const fallbackSteps = (result.steps || []).map(step => step.description).filter(Boolean);
    const steps = Array.isArray(detail.steps) && detail.steps.length ? detail.steps : fallbackSteps;
    const fields = [
      detail.id || result.case_id ? ['用例 ID', detail.id || result.case_id] : null,
      ['用例标题', detail.title || result.case_title],
      result.category ? ['所属模块', result.category] : null,
      result.priority ? ['优先级', result.priority] : null,
      ['执行结果', result.status === 'passed' ? '通过' : result.status === 'failed' ? '失败' : result.status],
      detail.reason ? ['设计理由', detail.reason] : null,
      detail.source ? ['需求来源', detail.source] : null,
      detail.expected ? ['预期结果', detail.expected] : null,
      result.error_message ? ['失败原因', result.error_message] : null,
    ].filter(Boolean);

    if (!steps.length && !fields.length) return '';

    const fieldRows = fields.map(([label, value]) => `
      <div class="case-field">
        <div class="case-field-label">${escapeHtml(label)}</div>
        <div class="case-field-value">${escapeHtml(value)}</div>
      </div>
    `).join('');

    const stepList = steps.length ? `
      <div class="case-field case-steps-field">
        <div class="case-field-label">测试步骤</div>
        <ol class="case-steps">
          ${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
        </ol>
      </div>
    ` : '';

    return `
      <details class="case-detail" open>
        <summary>测试用例详情</summary>
        <div class="case-detail-body">
          ${fieldRows}
          ${stepList}
        </div>
      </details>
    `;
  };
  
	  const resultRows = (report.results || []).map((r, i) => {
		    const videoHtml = r.status === 'failed' && r.video_path
		      ? `<div class="failure-video">
		          <div class="failure-video-title">失败过程回放</div>
		          <video controls preload="metadata" src="/api/reports/${report.id}/videos/${path.basename(r.video_path)}"></video>
		        </div>`
		      : '';
		    const issueHtml = r.gitlab_issue?.issue_url
		      ? `<a class="issue-link" href="${escapeHtml(r.gitlab_issue.issue_url)}" target="_blank" rel="noreferrer">GitLab Issue #${escapeHtml(r.gitlab_issue.issue_iid || '')}</a>`
		      : '';
		    const stepRows = (r.steps || []).map(s => {
      const screenshotHtml = s.screenshot_path 
        ? `<div class="step-screenshot"><img src="/api/reports/${report.id}/screenshots/${path.basename(s.screenshot_path)}" alt="截图" title="点击查看截图" loading="lazy" /></div>`
        : '';
      
      return `
        <div class="step-row ${s.status === 'failed' ? 'step-failed' : ''}">
          <div class="step-indicator">${statusIcon(s.status)}</div>
          <div class="step-content">
            <div class="step-desc">${escapeHtml(s.description)}</div>
            ${s.error_message ? `<div class="step-error">${escapeHtml(s.error_message)}</div>` : ''}
            ${screenshotHtml}
          </div>
          <div class="step-duration">${durationStr(s.duration_ms)}</div>
        </div>
      `;
    }).join('');
    
    return `
      <div class="result-card ${statusClass(r.status)}">
        <div class="result-header">
          <div class="result-status">${statusIcon(r.status)}</div>
          <div class="result-info">
            <div class="result-title">${escapeHtml(r.case_title)}</div>
            <div class="result-meta">
	              ${r.category ? `<span class="tag">${escapeHtml(r.category)}</span>` : ''}
	              ${r.priority ? `<span class="tag priority-${r.priority}">${escapeHtml(r.priority)}</span>` : ''}
	              <span class="duration">${durationStr(r.duration_ms)}</span>
	              ${issueHtml}
	            </div>
          </div>
        </div>
	        ${renderCaseDetail(r)}
	        ${r.error_message ? `<div class="result-error">${escapeHtml(r.error_message)}</div>` : ''}
	        ${videoHtml}
	        ${stepRows ? `<div class="result-steps">${stepRows}</div>` : ''}
	      </div>
    `;
  }).join('');
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(report.title)} - Prism 测试报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #fafafa;
      color: #1a1a1a;
      line-height: 1.6;
    }
    
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 40px 24px;
    }
    
    /* Header */
    .report-header {
      margin-bottom: 40px;
    }
    
    .report-title {
      font-size: 28px;
      font-weight: 600;
      color: #111;
      margin-bottom: 8px;
    }
    
    .report-time {
      font-size: 14px;
      color: #888;
    }
    
    /* Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 40px;
    }
    
    .stat-card {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      border: 1px solid #eee;
    }
    
    .stat-label {
      font-size: 13px;
      color: #888;
      margin-bottom: 4px;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: 600;
      color: #111;
    }
    
    .stat-value.pass { color: #22c55e; }
    .stat-value.fail { color: #ef4444; }
    
    .pass-rate-bar {
      height: 4px;
      background: #eee;
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
    }
    
    .pass-rate-fill {
      height: 100%;
      background: #22c55e;
      border-radius: 2px;
      transition: width 0.3s;
    }
    
    /* Results */
    .results-section {
      margin-bottom: 24px;
    }
    
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #111;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
    
    .result-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #eee;
      margin-bottom: 12px;
      overflow: hidden;
    }
    
    .result-card.result-failed {
      border-color: #fecaca;
    }
    
    .result-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
    }
    
    .result-status {
      font-size: 18px;
      flex-shrink: 0;
    }
    
    .status-pass { color: #22c55e; }
    .status-fail { color: #ef4444; }
    .status-run { color: #3b82f6; animation: pulse 1.5s infinite; }
    .status-pending { color: #d1d5db; }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .result-info { flex: 1; }
    
    .result-title {
      font-size: 15px;
      font-weight: 500;
      color: #111;
    }
    
    .result-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    
	    .tag {
	      font-size: 12px;
	      padding: 2px 8px;
	      border-radius: 4px;
	      background: #f3f4f6;
	      color: #6b7280;
	    }
	    
	    .issue-link {
	      font-size: 12px;
	      padding: 2px 8px;
	      border-radius: 4px;
	      background: #eef2ff;
	      color: #4f46e5;
	      text-decoration: none;
	    }
    
    .priority-P0 { background: #fef2f2; color: #dc2626; }
    .priority-P1 { background: #fff7ed; color: #ea580c; }
    .priority-P2 { background: #eff6ff; color: #2563eb; }
    
    .duration {
      font-size: 12px;
      color: #9ca3af;
    }
    
    .case-detail {
      margin: 0 20px 16px 50px;
      padding: 12px 14px;
      border: 1px solid #f3f4f6;
      border-radius: 10px;
      background: #fafafa;
    }

    .case-detail summary {
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: #52525b;
      user-select: none;
    }

    .case-detail-body {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .case-field {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 12px;
      font-size: 13px;
    }

    .case-field-label {
      color: #a1a1aa;
    }

    .case-field-value,
    .case-steps {
      color: #3f3f46;
    }

    .case-steps {
      margin-left: 18px;
    }

    .case-steps li + li {
      margin-top: 4px;
    }
    
    .result-error {
      padding: 12px 20px;
      background: #fef2f2;
      color: #dc2626;
      font-size: 13px;
      border-top: 1px solid #fecaca;
    }
    
    /* Steps */
    .result-steps {
      border-top: 1px solid #f3f4f6;
    }
    
    .step-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 20px;
      border-bottom: 1px solid #f9fafb;
    }
    
    .step-row:last-child {
      border-bottom: none;
    }
    
    .step-row.step-failed {
      background: #fef2f2;
    }
    
    .step-indicator {
      font-size: 14px;
      flex-shrink: 0;
      padding-top: 2px;
    }
    
    .step-content {
      flex: 1;
      min-width: 0;
    }
    
    .step-desc {
      font-size: 14px;
      color: #374151;
    }
    
    .step-error {
      font-size: 13px;
      color: #dc2626;
      margin-top: 4px;
    }
    
    .step-screenshot {
      margin-top: 8px;
    }
    
    .step-screenshot img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      cursor: pointer;
      transition: transform 0.2s;
    }
    
	    .step-screenshot img:hover {
	      transform: scale(1.02);
	    }

	    .failure-video {
	      margin: 14px 0 16px 32px;
	      padding: 12px;
	      border: 1px solid #fee2e2;
	      border-radius: 12px;
	      background: #fff7f7;
	    }

	    .failure-video-title {
	      margin-bottom: 8px;
	      color: #991b1b;
	      font-size: 13px;
	      font-weight: 600;
	    }

	    .failure-video video {
	      display: block;
	      width: 100%;
	      max-height: 520px;
	      border-radius: 10px;
	      background: #111827;
	    }
	    
	    .step-duration {
      font-size: 12px;
      color: #9ca3af;
      flex-shrink: 0;
      padding-top: 2px;
    }
    
    /* Footer */
    .report-footer {
      text-align: center;
      padding: 40px 0 20px;
      color: #9ca3af;
      font-size: 13px;
    }
    
    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    
    .lightbox.active {
      display: flex;
    }
    
    .lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="report-header">
      <h1 class="report-title">${escapeHtml(report.title)}</h1>
      <p class="report-time">${dateStr(report.started_at)} · 耗时 ${durationStr(report.duration_ms)}</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">总用例</div>
        <div class="stat-value">${report.total_cases}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">通过</div>
        <div class="stat-value pass">${report.passed_cases}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">失败</div>
        <div class="stat-value fail">${report.failed_cases}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">通过率</div>
        <div class="stat-value">${passRate}%</div>
        <div class="pass-rate-bar">
          <div class="pass-rate-fill" style="width: ${passRate}%"></div>
        </div>
      </div>
    </div>
    
    <div class="results-section">
      <h2 class="section-title">执行详情</h2>
      ${resultRows || '<p style="color: #9ca3af; text-align: center; padding: 40px;">暂无执行结果</p>'}
    </div>
    
    <div class="report-footer">
      <p>Generated by Prism · AI 驱动的 QA 分身</p>
    </div>
  </div>
  
  <div class="lightbox" id="lightbox" onclick="this.classList.remove('active')">
    <img id="lightbox-img" src="" alt="截图预览">
  </div>
  
  <script>
    document.querySelectorAll('.step-screenshot img').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('lightbox-img').src = img.src;
        document.getElementById('lightbox').classList.add('active');
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
