// input: GitLab 连接配置
// output: 本地持久化的 GitLab 配置
// position: GitLab Issue 集成配置层

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../../data/gitlab-config.json');

const defaultConfig = {
  enabled: false,
  baseUrl: 'https://gitlab.com',
  projectId: '',
  token: '',
  labels: 'bug,Prism',
  assigneeIds: '',
  reportBaseUrl: '',
};

function normalizeConfig(input = {}) {
  const baseUrl = String(input.baseUrl || defaultConfig.baseUrl).trim().replace(/\/+$/, '');
  const projectId = String(input.projectId || '').trim().replace(/^\/+|\/+$/g, '');
  let reportBaseUrl = String(input.reportBaseUrl || '').trim().replace(/\/+$/, '');
  if (reportBaseUrl && !/^https?:\/\//i.test(reportBaseUrl)) {
    reportBaseUrl = `http://${reportBaseUrl}`;
  }
  return {
    enabled: Boolean(input.enabled),
    baseUrl,
    projectId,
    token: String(input.token || '').trim(),
    labels: String(input.labels || '').trim(),
    assigneeIds: String(input.assigneeIds || '').trim(),
    reportBaseUrl,
  };
}

function loadGitLabConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return normalizeConfig({ ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) });
    }
  } catch (error) {
    console.error('[GitLab] 读取配置失败:', error.message);
  }
  return { ...defaultConfig };
}

function saveGitLabConfig(config = {}) {
  const previous = loadGitLabConfig();
  const next = normalizeConfig({
    ...previous,
    ...config,
    token: config.token === '' || config.token === undefined ? previous.token : config.token,
  });
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 });
  return next;
}

function redactGitLabConfig(config = loadGitLabConfig()) {
  return {
    ...config,
    token: config.token ? '********' : '',
    hasToken: Boolean(config.token),
  };
}

module.exports = {
  loadGitLabConfig,
  saveGitLabConfig,
  redactGitLabConfig,
};
