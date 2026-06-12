// input: 用户配置数据
// output: 配置的读写操作
// position: 应用配置存储，管理 API Key 和模型设置

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// 配置文件路径
const getConfigPath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'config.json');
};

// 默认配置
const defaultConfig = {
  // 当前使用的提供商
  provider: 'openai',
  
  // 提供商配置
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

// 读取配置
function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(data);
      // 合并默认配置（处理新增字段）
      return mergeConfig(defaultConfig, config);
    }
  } catch (e) {
    console.error('读取配置失败:', e);
  }
  return { ...defaultConfig };
}

// 保存配置
function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('保存配置失败:', e);
    return false;
  }
}

// 深度合并配置
function mergeConfig(defaultObj, userObj) {
  const result = { ...defaultObj };
  for (const key in userObj) {
    if (userObj[key] !== undefined) {
      if (typeof userObj[key] === 'object' && !Array.isArray(userObj[key]) && userObj[key] !== null) {
        result[key] = mergeConfig(defaultObj[key] || {}, userObj[key]);
      } else {
        result[key] = userObj[key];
      }
    }
  }
  return result;
}

// 获取当前激活的提供商配置
function getActiveProviderConfig() {
  const config = loadConfig();
  const provider = config.provider || 'openai';
  const providerConfig = config.providers[provider] || {};
  return {
    provider,
    ...providerConfig
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  getActiveProviderConfig,
  defaultConfig
};
