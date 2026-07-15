// input: Web 配置文件路径、环境变量
// output: 当前激活的 LLM 提供商配置和 GitLab 发布配置
// position: 服务器端 Web-only 配置中心

const fs = require('fs');
const path = require('path');

const DEFAULT_GITLAB_CONFIG = {
  baseUrl: 'http://gitlab.data-match.net:8929',
  projectPath: 'supply-chain/dm-supply-next',
  projectUrl: '',
  branch: 'main',
  token: '',
  scriptPackagePath: 'tests/scout/scripts/scout-script-package.json',
  suitePath: 'tests/scout/suites/smoke.json'
};

const defaultConfig = {
  provider: 'openai',
  activeModelId: 'model-openai-default',
  gitlab: DEFAULT_GITLAB_CONFIG,
  models: [
    {
      id: 'model-openai-default',
      name: 'OpenAI GPT-4',
      provider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      requestUrl: '',
      model: 'gpt-4'
    }
  ],
  providers: {
    openai: {
      name: 'OpenAI',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4'
    },
    anthropic: {
      name: 'Anthropic',
      apiKey: '',
      model: 'claude-3-sonnet-20240229'
    },
    azure: {
      name: 'Azure OpenAI',
      apiKey: '',
      endpoint: '',
      deploymentName: ''
    },
    custom: {
      name: '自定义',
      apiKey: '',
      baseUrl: '',
      model: ''
    }
  }
};

function mergeConfig(defaultObj, userObj) {
  const result = { ...defaultObj };
  for (const key in userObj) {
    const value = userObj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeConfig(defaultObj[key] || {}, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function createModelId(provider = 'custom') {
  return `model-${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function providerToModel(provider, config = {}) {
  const name = config.name || {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    azure: 'Azure OpenAI',
    custom: '自定义模型'
  }[provider] || '自定义模型';

  return {
    id: config.id || createModelId(provider),
    name,
    provider,
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || config.endpoint || '',
    requestUrl: config.requestUrl || '',
    endpoint: config.endpoint || '',
    deploymentName: config.deploymentName || '',
    model: config.model || config.deploymentName || ''
  };
}

function normalizeModels(config) {
  const models = Array.isArray(config.models)
    ? config.models
      .filter(Boolean)
      .map((model, index) => ({
        id: model.id || createModelId(model.provider || config.provider || `custom-${index}`),
        name: model.name || model.label || model.model || model.provider || `模型 ${index + 1}`,
        provider: model.provider || config.provider || 'custom',
        apiKey: model.apiKey || '',
        baseUrl: model.baseUrl || model.endpoint || '',
        requestUrl: model.requestUrl || '',
        endpoint: model.endpoint || '',
        deploymentName: model.deploymentName || '',
        model: model.model || model.deploymentName || '',
        createdAt: model.createdAt,
        updatedAt: model.updatedAt
      }))
    : [];

  if (models.length === 0 && config.providers) {
    Object.entries(config.providers).forEach(([provider, providerConfig]) => {
      if (providerConfig && (providerConfig.apiKey || providerConfig.baseUrl || providerConfig.endpoint || provider === config.provider)) {
        models.push(providerToModel(provider, providerConfig));
      }
    });
  }

  if (models.length === 0) {
    models.push({ ...defaultConfig.models[0] });
  }

  let activeModelId = config.activeModelId;
  if (!activeModelId && config.provider) {
    const matched = models.find(model => model.provider === config.provider);
    activeModelId = matched?.id;
  }
  if (!activeModelId || !models.some(model => model.id === activeModelId)) {
    activeModelId = models[0]?.id || '';
  }

  return { models, activeModelId };
}

function normalizeConfig(config = {}) {
  const merged = mergeConfig(defaultConfig, config || {});
  const modelSource = Array.isArray(config.models) && config.models.length > 0
    ? merged
    : { ...config, provider: config.provider, providers: config.providers };
  const normalized = normalizeModels(modelSource);
  merged.models = normalized.models;
  merged.activeModelId = normalized.activeModelId;
  const activeModel = merged.models.find(model => model.id === merged.activeModelId) || merged.models[0];
  if (activeModel) {
    merged.provider = activeModel.provider || merged.provider || 'custom';
    merged.providers = merged.providers || {};
    merged.providers[activeModel.provider] = {
      ...(merged.providers[activeModel.provider] || {}),
      name: activeModel.name,
      apiKey: activeModel.apiKey || '',
      baseUrl: activeModel.baseUrl || '',
      requestUrl: activeModel.requestUrl || '',
      endpoint: activeModel.endpoint || activeModel.baseUrl || '',
      deploymentName: activeModel.deploymentName || '',
      model: activeModel.model || ''
    };
  }
  return merged;
}

function getWebConfigPath() {
  return process.env.SCOUT_CONFIG_PATH
    ? path.resolve(process.env.SCOUT_CONFIG_PATH)
    : path.join(__dirname, '../data/config.json');
}

function loadJsonConfig(configPath, label) {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error(`读取${label}配置失败:`, e);
  }
  return null;
}

function loadWebConfig() {
  return loadJsonConfig(getWebConfigPath(), ' Web');
}

function saveWebConfig(config) {
  const configPath = getWebConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const merged = normalizeConfig(config || {});
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  });
  return merged;
}

function loadConfig() {
  return normalizeConfig(loadWebConfig() || {});
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function getGitLabBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function getGitLabProjectPath(projectUrl) {
  const raw = String(projectUrl || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  } catch {
    return '';
  }
}

function getGitLabConfig() {
  const savedGitLab = loadConfig().gitlab || {};
  const projectUrl = firstNonEmpty(process.env.GITLAB_PROJECT_URL, savedGitLab.projectUrl);
  const baseUrl = getGitLabBaseUrl(firstNonEmpty(
    process.env.GITLAB_BASE_URL,
    projectUrl,
    savedGitLab.baseUrl,
    DEFAULT_GITLAB_CONFIG.baseUrl
  ));
  const projectPath = firstNonEmpty(
    process.env.GITLAB_PROJECT_PATH,
    getGitLabProjectPath(projectUrl),
    savedGitLab.projectPath,
    DEFAULT_GITLAB_CONFIG.projectPath
  );
  const token = firstNonEmpty(process.env.GITLAB_TOKEN, savedGitLab.token);

  return {
    baseUrl,
    projectPath,
    projectUrl,
    branch: firstNonEmpty(process.env.GITLAB_BRANCH, savedGitLab.branch, DEFAULT_GITLAB_CONFIG.branch),
    token,
    hasToken: Boolean(token),
    scriptPackagePath: firstNonEmpty(
      process.env.GITLAB_SCRIPT_PACKAGE_PATH,
      savedGitLab.scriptPackagePath,
      DEFAULT_GITLAB_CONFIG.scriptPackagePath
    ),
    suitePath: firstNonEmpty(
      process.env.GITLAB_SUITE_PATH,
      savedGitLab.suitePath,
      DEFAULT_GITLAB_CONFIG.suitePath
    )
  };
}

// 获取当前激活的 LLM 配置
function getLLMConfig() {
  const savedConfig = loadConfig();
  const activeModel = savedConfig.models?.find(model => model.id === savedConfig.activeModelId);
  if (activeModel?.apiKey) {
    return {
      provider: activeModel.provider || 'custom',
      apiKey: activeModel.apiKey,
      baseUrl: activeModel.baseUrl || activeModel.endpoint,
      requestUrl: activeModel.requestUrl,
      endpoint: activeModel.endpoint,
      model: activeModel.model || activeModel.deploymentName,
      deploymentName: activeModel.deploymentName,
      name: activeModel.name,
      id: activeModel.id
    };
  }
  
  if (savedConfig && savedConfig.provider) {
    const provider = savedConfig.provider;
    const providerConfig = savedConfig.providers[provider] || {};
    
    // 检查是否有 API Key
    if (providerConfig.apiKey) {
      return {
        provider,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl || providerConfig.endpoint,
        model: providerConfig.model,
        deploymentName: providerConfig.deploymentName
      };
    }
  }
  
  // 回退到环境变量
  const provider = process.env.LLM_PROVIDER || 'openai';
  
  switch (provider) {
    case 'openai':
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4'
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229'
      };
    case 'azure':
      return {
        provider: 'azure',
        apiKey: process.env.AZURE_API_KEY,
        baseUrl: process.env.AZURE_ENDPOINT,
        deploymentName: process.env.AZURE_DEPLOYMENT_NAME
      };
    case 'custom':
      return {
        provider: 'custom',
        apiKey: process.env.CUSTOM_API_KEY,
        baseUrl: process.env.CUSTOM_BASE_URL,
        model: process.env.CUSTOM_MODEL
      };
    default:
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4'
      };
  }
}

module.exports = {
  DEFAULT_GITLAB_CONFIG,
  defaultConfig,
  getGitLabConfig,
  getLLMConfig,
  loadConfig,
  loadWebConfig,
  saveWebConfig,
  getWebConfigPath
};
