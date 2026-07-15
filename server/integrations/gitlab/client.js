// input: GitLab 配置、Issue 草稿、项目成员与里程碑查询条件
// output: GitLab API 调用结果、Issue 创建结果、项目成员与里程碑列表
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
    .filter(number => Number.isInteger(number) && number > 0);
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

async function listProjectMembers(config, query = '') {
  const params = new URLSearchParams({ per_page: '100' });
  const keyword = String(query || '').trim();
  if (keyword) params.set('query', keyword);
  const members = await gitlabRequest(config, `/api/v4/projects/${getProjectRef(config.projectId)}/members/all?${params.toString()}`);
  return (Array.isArray(members) ? members : []).map(member => ({
    id: member.id,
    username: member.username,
    name: member.name,
    state: member.state,
    avatar_url: member.avatar_url,
    web_url: member.web_url,
    access_level: member.access_level,
  }));
}

async function listProjectMilestones(config, state = 'active') {
  const params = new URLSearchParams({ per_page: '100' });
  if (state) params.set('state', state);
  const milestones = await gitlabRequest(config, `/api/v4/projects/${getProjectRef(config.projectId)}/milestones?${params.toString()}`);
  return (Array.isArray(milestones) ? milestones : []).map(milestone => ({
    id: milestone.id,
    iid: milestone.iid,
    title: milestone.title,
    description: milestone.description,
    state: milestone.state,
    start_date: milestone.start_date,
    due_date: milestone.due_date,
    web_url: milestone.web_url,
  }));
}

async function resolveAssigneeIds(config, draft) {
  const ids = parseNumberList(draft.assigneeIds || config.assigneeIds);
  const usernames = parseList(draft.assigneeUsernames);
  for (const username of usernames) {
    const members = await listProjectMembers(config, username);
    const matched = members.find(member => String(member.username || '').toLowerCase() === username.toLowerCase())
      || members.find(member => String(member.name || '').toLowerCase() === username.toLowerCase())
      || members[0];
    if (matched?.id) ids.push(Number(matched.id));
  }
  return Array.from(new Set(ids)).filter(Number.isFinite);
}

async function createIssue(config, draft) {
  const payload = {
    title: draft.title,
    description: draft.description,
  };
  const labels = parseList(draft.labels || config.labels);
  const assigneeIds = await resolveAssigneeIds(config, draft);
  const milestoneId = Number(draft.milestoneId);
  if (labels.length) payload.labels = labels.join(',');
  if (assigneeIds.length) payload.assignee_ids = assigneeIds;
  if (Number.isInteger(milestoneId) && milestoneId > 0) payload.milestone_id = milestoneId;

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
  listProjectMembers,
  listProjectMilestones,
  parseList,
  testConnection,
  uploadProjectFile,
};
