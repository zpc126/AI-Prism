// input: 设置模态框 DOM、同源配置 API
// output: 配置的读写和 UI 交互
// position: Web 设置界面逻辑，管理 API Key 和模型配置

class SettingsManager {
  constructor() {
    this.modal = document.getElementById('settings-modal');
    this.currentConfig = null;
    this.selectedProvider = 'openai';
    
    this.initElements();
    this.bindEvents();
  }
  
  initElements() {
    // 按钮
    this.btnOpen = document.getElementById('btn-settings');
    this.btnClose = document.getElementById('btn-settings-close');
    this.btnCancel = document.getElementById('btn-settings-cancel');
    this.btnSave = document.getElementById('btn-settings-save');
    this.btnTest = document.getElementById('btn-test-connection');
    
    // 输入框
    this.inputApiKey = document.getElementById('settings-api-key');
    this.inputBaseUrl = document.getElementById('settings-base-url');
    this.inputAzureEndpoint = document.getElementById('settings-azure-endpoint');
    this.inputAzureDeployment = document.getElementById('settings-azure-deployment');
    this.inputModel = document.getElementById('settings-model');
    
    // 分组
    this.groupBaseUrl = document.getElementById('settings-base-url-group');
    this.groupAzureEndpoint = document.getElementById('settings-azure-endpoint-group');
    this.groupAzureDeployment = document.getElementById('settings-azure-deployment-group');
    this.groupModel = document.getElementById('settings-model-group');
    
    // 提供商按钮
    this.providerBtns = document.querySelectorAll('.provider-btn');
    
    // 测试结果
    this.testResult = document.getElementById('test-connection-result');
  }
  
  bindEvents() {
    // 打开设置
    this.btnOpen?.addEventListener('click', () => this.open());
    
    // 关闭设置
    this.btnClose?.addEventListener('click', () => this.close());
    this.btnCancel?.addEventListener('click', () => this.close());
    
    // 点击背景关闭
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target === this.modal.querySelector('.bg-black\\/50')) {
        this.close();
      }
    });
    
    // 保存
    this.btnSave?.addEventListener('click', () => this.save());
    
    // 测试连接
    this.btnTest?.addEventListener('click', () => this.testConnection());
    
    // 提供商切换
    this.providerBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectProvider(btn.dataset.provider);
      });
    });
  }
  
  async open() {
    try {
      const response = await fetch('/api/config');
      const result = await response.json();
      this.currentConfig = result.success ? result.config : this.getDefaultConfig();
      
      this.selectedProvider = this.currentConfig.provider || 'openai';
      
      // 填充表单
      this.fillForm();
      
      // 显示模态框
      this.modal.classList.remove('hidden');
    } catch (e) {
      console.error('加载配置失败:', e);
    }
  }
  
  close() {
    this.modal.classList.add('hidden');
    this.testResult.classList.add('hidden');
  }
  
  fillForm() {
    const provider = this.selectedProvider;
    const config = this.currentConfig.providers[provider] || {};
    
    // 选中提供商按钮
    this.providerBtns.forEach(btn => {
      if (btn.dataset.provider === provider) {
        btn.classList.add('border-zinc-800', 'bg-zinc-50');
        btn.classList.remove('border-zinc-200');
      } else {
        btn.classList.remove('border-zinc-800', 'bg-zinc-50');
        btn.classList.add('border-zinc-200');
      }
    });
    
    // 填充输入框
    this.inputApiKey.value = config.apiKey || '';
    this.inputBaseUrl.value = config.baseUrl || '';
    this.inputAzureEndpoint.value = config.endpoint || '';
    this.inputAzureDeployment.value = config.deploymentName || '';
    this.inputModel.value = config.model || '';
    
    // 显示/隐藏相关字段
    this.updateFieldVisibility(provider);
  }
  
  updateFieldVisibility(provider) {
    // 重置所有
    this.groupBaseUrl.classList.remove('hidden');
    this.groupAzureEndpoint.classList.add('hidden');
    this.groupAzureDeployment.classList.add('hidden');
    this.groupModel.classList.remove('hidden');
    
    switch (provider) {
      case 'openai':
        this.groupBaseUrl.querySelector('label').textContent = 'Base URL';
        break;
      case 'anthropic':
        this.groupBaseUrl.classList.add('hidden');
        break;
      case 'azure':
        this.groupBaseUrl.classList.add('hidden');
        this.groupAzureEndpoint.classList.remove('hidden');
        this.groupAzureDeployment.classList.remove('hidden');
        break;
      case 'custom':
        this.groupBaseUrl.querySelector('label').textContent = 'Base URL';
        break;
    }
  }
  
  selectProvider(provider) {
    // 先保存当前表单到配置
    this.saveFormToConfig();
    
    this.selectedProvider = provider;
    this.fillForm();
  }
  
  saveFormToConfig() {
    if (!this.currentConfig) return;
    
    const provider = this.selectedProvider;
    if (!this.currentConfig.providers[provider]) {
      this.currentConfig.providers[provider] = {};
    }
    
    const config = this.currentConfig.providers[provider];
    config.apiKey = this.inputApiKey.value.trim();
    
    switch (provider) {
      case 'openai':
      case 'custom':
        config.baseUrl = this.inputBaseUrl.value.trim();
        config.model = this.inputModel.value.trim();
        break;
      case 'azure':
        config.endpoint = this.inputAzureEndpoint.value.trim();
        config.deploymentName = this.inputAzureDeployment.value.trim();
        break;
      case 'anthropic':
        config.model = this.inputModel.value.trim();
        break;
    }
  }
  
  async save() {
    // 保存当前表单
    this.saveFormToConfig();
    
    // 更新当前提供商
    this.currentConfig.provider = this.selectedProvider;
    
    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.currentConfig)
      });
      const result = await response.json();
      if (result.success) {
        this.currentConfig = result.config;
        this.close();
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (e) {
      console.error('保存配置失败:', e);
      this.showTestResult(e.message || '保存失败', 'error');
    }
  }
  
  async testConnection() {
    const provider = this.selectedProvider;
    const apiKey = this.inputApiKey.value.trim();
    
    if (!apiKey) {
      this.showTestResult('请输入 API Key', 'error');
      return;
    }
    
    this.btnTest.disabled = true;
    this.btnTest.textContent = '测试中...';
    this.testResult.classList.add('hidden');
    
    try {
      // 构建测试配置
      const testConfig = {
        provider,
        apiKey,
        baseUrl: this.inputBaseUrl.value.trim(),
        endpoint: this.inputAzureEndpoint.value.trim(),
        deploymentName: this.inputAzureDeployment.value.trim(),
        model: this.inputModel.value.trim()
      };
      
      const response = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig)
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.showTestResult('连接成功', 'success');
      } else {
        this.showTestResult(result.error || '连接失败', 'error');
      }
    } catch (e) {
      this.showTestResult('无法连接到服务器', 'error');
    } finally {
      this.btnTest.disabled = false;
      this.btnTest.textContent = '测试连接';
    }
  }
  
  showTestResult(message, type) {
    this.testResult.textContent = message;
    this.testResult.classList.remove('hidden', 'text-green-600', 'text-red-600');
    this.testResult.classList.add(type === 'success' ? 'text-green-600' : 'text-red-600');
  }
  
  getDefaultConfig() {
    return {
      provider: 'openai',
      providers: {
        openai: { name: 'OpenAI', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4' },
        anthropic: { name: 'Anthropic', apiKey: '', model: 'claude-3-sonnet-20240229' },
        azure: { name: 'Azure OpenAI', apiKey: '', endpoint: '', deploymentName: '' },
        custom: { name: '自定义', apiKey: '', baseUrl: '', model: '' }
      }
    };
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.settingsManager = new SettingsManager();
});
