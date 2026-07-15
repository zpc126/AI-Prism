// input: 脚本库 HTTP 请求、GitLab 发布配置
// output: 脚本 CRUD、脚本包导出、GitLab 提交和单脚本执行 SSE
// position: 自动化脚本库 API

const express = require('express');
const router = express.Router();
const {
  listScripts,
  getScriptById,
  updateScript,
  deleteScript,
  buildScriptExportPackage,
} = require('./automation-scripts');
const {
  setCurrentExecutor,
  clearCurrentExecutor,
} = require('../executor/execution-state');
const {
  DEFAULT_GITLAB_CONFIG,
  getGitLabConfig,
} = require('../config');

const DEFAULT_GITLAB_BASE_URL = DEFAULT_GITLAB_CONFIG.baseUrl;
const DEFAULT_GITLAB_PROJECT_PATH = DEFAULT_GITLAB_CONFIG.projectPath;
const DEFAULT_GITLAB_BRANCH = DEFAULT_GITLAB_CONFIG.branch;
const DEFAULT_SCRIPT_PACKAGE_PATH = DEFAULT_GITLAB_CONFIG.scriptPackagePath;
const DEFAULT_SUITE_PATH = DEFAULT_GITLAB_CONFIG.suitePath;

function getFetch() {
  return typeof fetch !== 'undefined' ? fetch : require('node-fetch');
}

function normalizeGitLabBaseUrl(value) {
  const raw = String(value || DEFAULT_GITLAB_BASE_URL).trim().replace(/\/+$/, '');
  const url = new URL(raw);
  return `${url.protocol}//${url.host}`;
}

function normalizeRepoPath(value, fallback) {
  const normalized = String(value || fallback || '').trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error('GitLab 文件路径无效');
  return normalized;
}

function inferProjectPath({ projectPath, projectUrl, fallback }) {
  if (projectPath) return String(projectPath).trim().replace(/^\/+/, '').replace(/\.git$/, '');
  if (!projectUrl) return fallback || DEFAULT_GITLAB_PROJECT_PATH;
  const parsed = new URL(projectUrl);
  return parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
}

function toSuiteScriptPath(filePath) {
  const normalized = normalizeRepoPath(filePath, DEFAULT_SCRIPT_PACKAGE_PATH);
  return normalized.startsWith('tests/scout/')
    ? normalized.slice('tests/scout/'.length)
    : normalized;
}

function decodeGitLabFileContent(file) {
  if (!file?.content) return '';
  return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}

async function gitlabRequest({ baseUrl, projectPath, token, method = 'GET', path, body }) {
  const fetchFn = getFetch();
  const response = await fetchFn(
    `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': token,
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const message = data?.message
      ? (typeof data.message === 'string' ? data.message : JSON.stringify(data.message))
      : `GitLab API ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getGitLabFile({ baseUrl, projectPath, token, filePath, branch }) {
  try {
    return await gitlabRequest({
      baseUrl,
      projectPath,
      token,
      path: `/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`,
    });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function buildPublishActions({ baseUrl, projectPath, token, branch, filePath, suitePath, updateSuite, packagePayload }) {
  const actions = [];
  const existingPackage = await getGitLabFile({ baseUrl, projectPath, token, filePath, branch });
  actions.push({
    action: existingPackage ? 'update' : 'create',
    file_path: filePath,
    content: JSON.stringify(packagePayload, null, 2),
  });

  if (!updateSuite) return actions;

  const suiteScriptPath = toSuiteScriptPath(filePath);
  const existingSuite = await getGitLabFile({ baseUrl, projectPath, token, filePath: suitePath, branch });
  let suite = {
    name: 'smoke',
    env: 'staging',
    scripts: [],
    failFast: false,
  };
  if (existingSuite) {
    try {
      suite = JSON.parse(decodeGitLabFileContent(existingSuite));
    } catch {
      throw new Error(`${suitePath} 不是可解析的 JSON，已停止自动更新 suite`);
    }
  }
  suite.scripts = Array.isArray(suite.scripts) ? suite.scripts : [];
  if (!suite.scripts.includes(suiteScriptPath)) suite.scripts.push(suiteScriptPath);
  if (suite.allowEmpty && suite.scripts.length > 0) delete suite.allowEmpty;

  actions.push({
    action: existingSuite ? 'update' : 'create',
    file_path: suitePath,
    content: `${JSON.stringify(suite, null, 2)}\n`,
  });
  return actions;
}

router.get('/', (req, res) => {
  try {
    res.json({
      success: true,
      scripts: listScripts({ search: req.query.search || '' }),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/export', (req, res) => {
  try {
    const includeAll = String(req.query.includeAll || '').toLowerCase() === 'true';
    const payload = buildScriptExportPackage({ includeAll });
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="scout-script-package-${suffix}.json"`);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/gitlab-config', (req, res) => {
  try {
    const config = getGitLabConfig();
    res.json({
      success: true,
      config: {
        baseUrl: config.baseUrl,
        projectPath: config.projectPath,
        projectUrl: config.projectUrl,
        branch: config.branch,
        hasToken: config.hasToken,
        scriptPackagePath: config.scriptPackagePath,
        suitePath: config.suitePath,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/publish-gitlab', async (req, res) => {
  try {
    const gitLabConfig = getGitLabConfig();
    const {
      gitlabBaseUrl,
      projectUrl,
      projectPath,
      branch,
      filePath: rawFilePath,
      suitePath: rawSuitePath,
      commitMessage,
      token: requestToken,
      includeAll = false,
      updateSuite = true,
    } = req.body || {};
    const token = String(requestToken || gitLabConfig.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: '缺少 GitLab Token' });

    const packagePayload = buildScriptExportPackage({ includeAll: Boolean(includeAll) });
    if (!packagePayload.scripts.length) {
      return res.status(400).json({ success: false, error: '暂无可提交的稳定脚本' });
    }

    const baseUrl = normalizeGitLabBaseUrl(gitlabBaseUrl || projectUrl || gitLabConfig.baseUrl);
    const targetProjectPath = inferProjectPath({
      projectPath,
      projectUrl,
      fallback: gitLabConfig.projectPath,
    });
    const filePath = normalizeRepoPath(
      rawFilePath || gitLabConfig.scriptPackagePath,
      DEFAULT_SCRIPT_PACKAGE_PATH
    );
    const suitePath = normalizeRepoPath(rawSuitePath || gitLabConfig.suitePath, DEFAULT_SUITE_PATH);
    const targetBranch = String(branch || gitLabConfig.branch || DEFAULT_GITLAB_BRANCH).trim();
    const actions = await buildPublishActions({
      baseUrl,
      projectPath: targetProjectPath,
      token,
      branch: targetBranch,
      filePath,
      suitePath,
      updateSuite: updateSuite !== false,
      packagePayload,
    });

    const commit = await gitlabRequest({
      baseUrl,
      projectPath: targetProjectPath,
      token,
      method: 'POST',
      path: '/repository/commits',
      body: {
        branch: targetBranch,
        commit_message: commitMessage || `chore: update Scout automation scripts (${packagePayload.scripts.length})`,
        actions,
      },
    });

    res.json({
      success: true,
      scriptCount: packagePayload.scripts.length,
      projectPath: targetProjectPath,
      branch: targetBranch,
      filePath,
      suitePath: updateSuite !== false ? suitePath : '',
      commit: {
        id: commit.id,
        shortId: commit.short_id,
        title: commit.title,
        webUrl: commit.web_url,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

router.get('/:id', (req, res) => {
  const script = getScriptById(req.params.id);
  if (!script) return res.status(404).json({ success: false, error: '脚本不存在' });
  res.json({ success: true, script });
});

router.put('/:id', (req, res) => {
  try {
    const script = updateScript(req.params.id, req.body);
    if (!script) return res.status(404).json({ success: false, error: '脚本不存在' });
    res.json({ success: true, script });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  res.json({ success: deleteScript(req.params.id) });
});

router.post('/:id/execute', async (req, res) => {
  const script = getScriptById(req.params.id);
  if (!script) return res.status(404).json({ success: false, error: '脚本不存在' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const { BatchExecutor } = require('../executor/batch-executor');
  const executor = new BatchExecutor();
  setCurrentExecutor(executor);
  let responseFinished = false;
  res.on('close', () => {
    if (!responseFinished) {
      clearCurrentExecutor(executor);
      executor.stop().catch(error => {
        console.error('[脚本库] 连接关闭后停止任务失败:', error.message);
      });
    }
  });
  const testCase = {
    ...script.sourceCase,
    id: script.sourceCase.id || script.id,
    title: script.name,
    productName: script.product_name,
    moduleName: script.module_name,
    category: script.module_name,
    expected: script.expected,
  };

  try {
    const result = await executor.execute([testCase], {
      title: `${script.name} - 脚本执行报告`,
      preferredScriptId: script.id,
      scriptOnly: true,
    }, log => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    });
    res.write(`event: complete\ndata: ${JSON.stringify({ success: !result.stopped && result.failed === 0, ...result })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    responseFinished = true;
    clearCurrentExecutor(executor);
  }
  res.end();
});

module.exports = router;
