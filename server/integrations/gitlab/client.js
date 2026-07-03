// input: GitLab 配置、Issue 草稿
// output: GitLab API 调用结果
// position: GitLab REST API 客户端

const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');

function getProjectRef(projectId) {
  return encodeURIComponent(String(projectId || '').trim().replace(/^\/+|\/+$/g, ''));
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseNumberList(value) {
  return parseList(value)
    .map(item => Number(item))
    .filter(Number.isFinite);
}

async function gitlabRequest(config, pathname, options = {}) {
  if (!config.baseUrl || !config.projectId || !config.token) {
    throw new Error('GitLab 配置不完整，请先填写 Base URL、Project ID/Path 和 Token');
  }

  const url = `${config.baseUrl.replace(/\/+$/, '')}${pathname}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': config.token,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    body = { message: text };
  }

  if (!response.ok) {
    const message = body?.message || body?.error || text || `GitLab 请求失败 (${response.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }

  return body;
}

async function testConnection(config) {
  const project = await gitlabRequest(config, `/api/v4/projects/${getProjectRef(config.projectId)}`);
  return {
    id: project.id,
    name: project.name,
    path_with_namespace: project.path_with_namespace,
    web_url: project.web_url,
  };
}

async function createIssue(config, draft) {
  const payload = {
    title: draft.title,
    description: draft.description,
  };
  const labels = parseList(draft.labels || config.labels);
  const assigneeIds = parseNumberList(draft.assigneeIds || config.assigneeIds);
  if (labels.length) payload.labels = labels.join(',');
  if (assigneeIds.length) payload.assignee_ids = assigneeIds;

  return gitlabRequest(config, `/api/v4/projects/${getProjectRef(config.projectId)}/issues`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function uploadProjectFile(config, filePath, filename) {
  if (!config.baseUrl || !config.projectId || !config.token) {
    throw new Error('GitLab 配置不完整，请先填写 Base URL、Project ID/Path 和 Token');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`附件不存在：${filePath}`);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), filename);

  const url = `${config.baseUrl.replace(/\/+$/, '')}/api/v4/projects/${getProjectRef(config.projectId)}/uploads`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': config.token,
      ...form.getHeaders(),
    },
    body: form,
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    body = { message: text };
  }

  if (!response.ok) {
    const message = body?.message || body?.error || text || `GitLab 上传附件失败 (${response.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }

  return body;
}

module.exports = {
  createIssue,
  parseList,
  testConnection,
  uploadProjectFile,
};
