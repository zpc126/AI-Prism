// input: 设置模态框 DOM、同源配置 API
// output: 多模型配置的读写、选择、测试和 UI 交互
// position: Web 设置界面逻辑，管理任意数量的模型配置

class SettingsManager {
  constructor() {
    this.modal = document.getElementById('settings-modal');
    this.currentConfig = null;
    this.selectedModelId = '';

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.btnOpen = document.getElementById('btn-settings');
    this.btnClose = document.getElementById('btn-settings-close');
    this.btnCancel = document.getElementById('btn-settings-cancel');
    this.btnSave = document.getElementById('btn-settings-save');
    this.btnTest = document.getElementById('btn-test-connection');
    this.btnAddModel = document.getElementById('btn-add-model');
    this.btnDeleteModel = document.getElementById('btn-delete-model');
    this.btnGitLabOpen = document.getElementById('btn-gitlab-settings');
    this.btnGitLabClose = document.getElementById('btn-gitlab-close');
    this.btnGitLabSave = document.getElementById('btn-gitlab-save');
    this.btnGitLabTest = document.getElementById('btn-gitlab-test');
    this.gitLabModal = document.getElementById('gitlab-settings-modal');

    this.modelList = document.getElementById('settings-model-list');
    this.activeHint = document.getElementById('settings-active-hint');
    this.inputName = document.getElementById('settings-model-name');
    this.inputProvider = document.getElementById('settings-provider');
    this.inputApiKey = document.getElementById('settings-api-key');
    this.inputBaseUrl = document.getElementById('settings-base-url');
    this.inputRequestUrl = document.getElementById('settings-request-url');
    this.inputAzureEndpoint = document.getElementById('settings-azure-endpoint');
    this.inputAzureDeployment = document.getElementById('settings-azure-deployment');
    this.inputModel = document.getElementById('settings-model');

    this.groupBaseUrl = document.getElementById('settings-base-url-group');
    this.groupRequestUrl = document.getElementById('settings-request-url-group');
    this.groupAzureEndpoint = document.getElementById('settings-azure-endpoint-group');
    this.groupAzureDeployment = document.getElementById('settings-azure-deployment-group');
    this.groupModel = document.getElementById('settings-model-group');
    this.requestUrlPreview = document.getElementById('settings-request-url-preview');

    this.testResult = document.getElementById('test-connection-result');
    this.gitLabResult = document.getElementById('gitlab-settings-result');
    this.gitLabBaseUrl = document.getElementById('gitlab-base-url');
    this.gitLabProjectId = document.getElementById('gitlab-project-id');
    this.gitLabReportBaseUrl = document.getElementById('gitlab-report-base-url');
    this.gitLabToken = document.getElementById('gitlab-token');
    this.gitLabLabels = document.getElementById('gitlab-labels');
    this.gitLabAssigneeIds = document.getElementById('gitlab-assignee-ids');
  }

  bindEvents() {
    this.btnOpen?.addEventListener('click', () => this.open());
    this.btnClose?.addEventListener('click', () => this.close());
    this.btnCancel?.addEventListener('click', () => this.close());
    this.btnSave?.addEventListener('click', () => this.save());
    this.btnTest?.addEventListener('click', () => this.testConnection());
    this.btnAddModel?.addEventListener('click', () => this.addModel());
    this.btnDeleteModel?.addEventListener('click', () => this.deleteSelectedModel());
    this.btnGitLabOpen?.addEventListener('click', () => this.openGitLabSettings());
    this.btnGitLabClose?.addEventListener('click', () => this.closeGitLabSettings());
    this.btnGitLabSave?.addEventListener('click', () => this.saveGitLabSettings());
    this.btnGitLabTest?.addEventListener('click', () => this.testGitLabSettings());

    this.inputProvider?.addEventListener('change', () => {
      this.updateFieldVisibility(this.inputProvider.value);
      this.saveFormToConfig();
      this.renderModelList();
    });

    [this.inputName, this.inputModel, this.inputBaseUrl, this.inputRequestUrl, this.inputAzureEndpoint, this.inputAzureDeployment]
      .forEach(input => input?.addEventListener('blur', () => {
        this.saveFormToConfig();
        this.renderModelList();
        this.updateRequestUrlPreview();
      }));

    this.inputBaseUrl?.addEventListener('input', () => this.updateRequestUrlPreview());
    this.inputRequestUrl?.addEventListener('input', () => this.updateRequestUrlPreview());

    this.modal?.addEventListener('click', (event) => {
      if (event.target === this.modal || event.target === this.modal.querySelector('.bg-black\\/50')) {
        this.close();
      }
    });

    this.gitLabModal?.addEventListener('click', (event) => {
      if (event.target === this.gitLabModal || event.target === this.gitLabModal.querySelector('.bg-black\\/50')) {
        this.closeGitLabSettings();
      }
    });
  }

  async open() {
    try {
      const response = await fetch('/api/config');
      const result = await response.json();
      this.currentConfig = this.normalizeConfig(result.success ? result.config : this.getDefaultConfig());
      this.selectedModelId = this.currentConfig.activeModelId || this.currentConfig.models[0]?.id || '';
      this.renderModelList();
      this.fillForm();
      this.modal.classList.remove('hidden');
    } catch (error) {
      console.error('加载配置失败:', error);
      this.showErrorDialog(error.message || '加载配置失败');
    }
  }

  close() {
    this.modal.classList.add('hidden');
    this.testResult.classList.add('hidden');
  }

  normalizeConfig(config) {
    const normalized = {
      ...this.getDefaultConfig(),
      ...(config || {}),
      providers: {
        ...this.getDefaultConfig().providers,
        ...((config && config.providers) || {})
      }
    };

    let models = Array.isArray(config?.models)
      ? config.models.filter(Boolean).map(model => this.normalizeModel(model))
      : [];

    if (models.length === 0 && config?.providers) {
      models = Object.entries(config.providers)
        .filter(([provider, value]) => value && (value.apiKey || value.baseUrl || value.endpoint || provider === config.provider))
        .map(([provider, value]) => this.normalizeModel({
          ...value,
          provider,
          name: value.name || this.providerLabel(provider)
        }));
    }

    if (models.length === 0) {
      models = [this.createModel('openai')];
    }

    normalized.models = models;
    if (!normalized.activeModelId || !models.some(model => model.id === normalized.activeModelId)) {
      const byProvider = models.find(model => model.provider === normalized.provider);
      normalized.activeModelId = byProvider?.id || models[0].id;
    }
    normalized.provider = models.find(model => model.id === normalized.activeModelId)?.provider || normalized.provider || 'openai';
    return normalized;
  }

  normalizeModel(model = {}) {
    const provider = model.provider || 'custom';
    return {
      id: model.id || this.createModelId(provider),
      name: model.name || model.label || model.model || this.providerLabel(provider),
      provider,
      apiKey: model.apiKey || '',
      baseUrl: model.baseUrl || model.endpoint || '',
      requestUrl: model.requestUrl || '',
      endpoint: model.endpoint || '',
      deploymentName: model.deploymentName || '',
      model: model.model || model.deploymentName || '',
      createdAt: model.createdAt || new Date().toISOString(),
      updatedAt: model.updatedAt || new Date().toISOString()
    };
  }

  createModel(provider = 'custom') {
    const defaults = {
      openai: { name: 'OpenAI GPT-4', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4' },
      anthropic: { name: 'Claude', model: 'claude-3-sonnet-20240229' },
      azure: { name: 'Azure OpenAI', endpoint: '', deploymentName: '' },
      custom: { name: '自定义模型', baseUrl: '', model: '' }
    };
    return this.normalizeModel({
      id: this.createModelId(provider),
      provider,
      ...(defaults[provider] || defaults.custom)
    });
  }

  createModelId(provider) {
    return `model-${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  providerLabel(provider) {
    return {
      openai: 'OpenAI 兼容',
      anthropic: 'Anthropic',
      azure: 'Azure OpenAI',
      custom: '自定义'
    }[provider] || provider || '自定义';
  }

  getSelectedModel() {
    return this.currentConfig?.models?.find(model => model.id === this.selectedModelId) || null;
  }

  renderModelList() {
    if (!this.modelList || !this.currentConfig) return;
    const models = this.currentConfig.models || [];
    if (models.length === 0) {
      this.modelList.innerHTML = '<div class="text-xs text-zinc-400 px-3 py-4 text-center bg-zinc-50 rounded-lg">暂无模型</div>';
      return;
    }

    this.modelList.innerHTML = models.map(model => {
      const selected = model.id === this.selectedModelId;
      const active = model.id === this.currentConfig.activeModelId;
      const modelName = this.escapeHtml(model.name || model.model || '未命名模型');
      const modelId = this.escapeHtml(model.model || model.deploymentName || '未填写模型名');
      return `
        <button type="button" data-model-id="${this.escapeHtml(model.id)}"
          class="settings-model-item w-full text-left px-3 py-2.5 rounded-xl border transition-all ${selected ? 'border-zinc-800 bg-zinc-50' : 'border-zinc-100 hover:border-zinc-300'}">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-zinc-800 truncate">${modelName}</span>
            ${active ? '<span class="shrink-0 text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded">当前</span>' : ''}
          </div>
          <div class="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span>${this.escapeHtml(this.providerLabel(model.provider))}</span>
            <span>·</span>
            <span class="truncate">${modelId}</span>
          </div>
        </button>
      `;
    }).join('');

    this.modelList.querySelectorAll('.settings-model-item').forEach(item => {
      item.addEventListener('click', () => this.selectModel(item.dataset.modelId));
    });
  }

  fillForm() {
    const model = this.getSelectedModel();
    if (!model) return;
    this.inputName.value = model.name || '';
    this.inputProvider.value = model.provider || 'custom';
    this.inputApiKey.value = model.apiKey || '';
    this.inputBaseUrl.value = model.baseUrl || '';
    this.inputRequestUrl.value = model.requestUrl || '';
    this.inputAzureEndpoint.value = model.endpoint || model.baseUrl || '';
    this.inputAzureDeployment.value = model.deploymentName || '';
    this.inputModel.value = model.model || '';
    this.currentConfig.activeModelId = model.id;
    this.currentConfig.provider = model.provider || 'custom';
    this.updateFieldVisibility(model.provider);
    this.updateActiveHint(model);
    this.updateRequestUrlPreview();
    this.testResult.classList.add('hidden');
  }

  updateActiveHint(model) {
    if (!this.activeHint) return;
    this.activeHint.textContent = `当前使用：${model.name || '未命名模型'} / ${model.model || model.deploymentName || '未填写模型名'}`;
  }

  updateRequestUrlPreview() {
    if (!this.requestUrlPreview) return;
    const provider = this.inputProvider?.value || 'custom';
    if (provider === 'azure') {
      this.requestUrlPreview.textContent = '';
      return;
    }
    const manualUrl = this.inputRequestUrl?.value.trim();
    const requestUrl = manualUrl || (
      provider === 'anthropic'
        ? this.buildAnthropicMessagesUrl(this.inputBaseUrl?.value.trim())
        : this.buildChatCompletionsUrl(this.inputBaseUrl?.value.trim())
    );
    this.requestUrlPreview.textContent = requestUrl
      ? `实际请求：${requestUrl}${manualUrl ? '（手动指定）' : '（自动推导）'}`
      : '实际请求：请填写 Base URL 或请求 URL';
  }

  buildChatCompletionsUrl(baseUrl) {
    const normalized = (baseUrl || '').replace(/\/+$/, '');
    if (!normalized) return '';
    if (/\/chat\/completions$/i.test(normalized)) return normalized;
    return `${normalized}/chat/completions`;
  }

  buildAnthropicMessagesUrl(baseUrl) {
    const normalized = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    if (/\/messages$/i.test(normalized)) return normalized;
    if (/\/v1$/i.test(normalized)) return `${normalized}/messages`;
    return `${normalized}/v1/messages`;
  }

  updateFieldVisibility(provider) {
    this.groupBaseUrl.classList.remove('hidden');
    this.groupRequestUrl.classList.remove('hidden');
    this.groupAzureEndpoint.classList.add('hidden');
    this.groupAzureDeployment.classList.add('hidden');
    this.groupModel.classList.remove('hidden');

    if (provider === 'azure') {
      this.groupBaseUrl.classList.add('hidden');
      this.groupRequestUrl.classList.add('hidden');
      this.groupAzureEndpoint.classList.remove('hidden');
      this.groupAzureDeployment.classList.remove('hidden');
    }
  }

  selectModel(modelId) {
    if (!modelId || modelId === this.selectedModelId) return;
    this.saveFormToConfig();
    this.selectedModelId = modelId;
    this.currentConfig.activeModelId = modelId;
    const model = this.getSelectedModel();
    this.currentConfig.provider = model?.provider || this.currentConfig.provider;
    this.renderModelList();
    this.fillForm();
  }

  addModel() {
    if (!this.currentConfig) return;
    this.saveFormToConfig();
    const model = this.createModel('custom');
    model.name = `自定义模型 ${this.currentConfig.models.length + 1}`;
    this.currentConfig.models.push(model);
    this.selectedModelId = model.id;
    this.currentConfig.activeModelId = model.id;
    this.currentConfig.provider = model.provider;
    this.renderModelList();
    this.fillForm();
  }

  async deleteSelectedModel() {
    if (!this.currentConfig || this.currentConfig.models.length <= 1) {
      this.showErrorDialog('至少保留一个模型配置');
      return;
    }
    const model = this.getSelectedModel();
    if (!model) return;
    const ok = await this.showConfirmDialog({
      title: '删除模型配置',
      message: `确定删除「${model.name || model.model || '未命名模型'}」吗？删除后不会影响其它模型配置。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;

    const index = this.currentConfig.models.findIndex(item => item.id === model.id);
    this.currentConfig.models.splice(index, 1);
    const nextModel = this.currentConfig.models[Math.max(0, index - 1)] || this.currentConfig.models[0];
    this.selectedModelId = nextModel.id;
    this.currentConfig.activeModelId = nextModel.id;
    this.currentConfig.provider = nextModel.provider || 'custom';
    this.renderModelList();
    this.fillForm();
  }

  saveFormToConfig() {
    const model = this.getSelectedModel();
    if (!model) return;
    model.name = this.inputName.value.trim() || this.inputModel.value.trim() || this.providerLabel(this.inputProvider.value);
    model.provider = this.inputProvider.value || 'custom';
    model.apiKey = this.inputApiKey.value.trim();
    model.baseUrl = this.inputBaseUrl.value.trim();
    model.requestUrl = this.inputRequestUrl.value.trim();
    model.endpoint = this.inputAzureEndpoint.value.trim();
    model.deploymentName = this.inputAzureDeployment.value.trim();
    model.model = this.inputModel.value.trim();
    model.updatedAt = new Date().toISOString();
    this.currentConfig.activeModelId = model.id;
    this.currentConfig.provider = model.provider;
  }

  syncLegacyProviders() {
    this.currentConfig.providers = this.currentConfig.providers || {};
    for (const model of this.currentConfig.models) {
      if (model.id !== this.currentConfig.activeModelId) continue;
      this.currentConfig.providers[model.provider] = {
        ...(this.currentConfig.providers[model.provider] || {}),
        name: model.name,
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        requestUrl: model.requestUrl,
        endpoint: model.endpoint || model.baseUrl,
        deploymentName: model.deploymentName,
        model: model.model
      };
    }
  }

  async save() {
    this.saveFormToConfig();
    this.syncLegacyProviders();

    try {
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.currentConfig)
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '保存失败');
      this.currentConfig = this.normalizeConfig(result.config);
      this.selectedModelId = this.currentConfig.activeModelId;
      this.close();
    } catch (error) {
      console.error('保存配置失败:', error);
      this.showErrorDialog(error.message || '保存失败');
    }
  }

  async testConnection() {
    this.saveFormToConfig();
    const model = this.getSelectedModel();
    if (!model?.apiKey) {
      this.showErrorDialog('请输入 API Key');
      return;
    }

    this.btnTest.disabled = true;
    this.btnTest.textContent = '测试中...';
    this.testResult.classList.add('hidden');

    try {
      const response = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model)
      });
      const result = await response.json();
      if (result.success) {
        this.showTestResult('连接成功', 'success');
      } else {
        this.showErrorDialog(result.error || '连接失败');
      }
    } catch (error) {
      this.showErrorDialog('无法连接到服务器');
    } finally {
      this.btnTest.disabled = false;
      this.btnTest.textContent = '测试当前模型';
    }
  }

  showTestResult(message, type) {
    if (type === 'error') {
      this.showErrorDialog(message);
      return;
    }
    this.testResult.textContent = message;
    this.testResult.classList.remove('hidden', 'text-green-600', 'text-red-600');
    this.testResult.classList.add(type === 'success' ? 'text-green-600' : 'text-red-600');
  }

  async openGitLabSettings() {
    try {
      const response = await fetch('/api/gitlab/config');
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '加载 GitLab 配置失败');
      const config = result.config || {};
      this.gitLabBaseUrl.value = config.baseUrl || 'https://gitlab.com';
      this.gitLabProjectId.value = config.projectId || '';
      this.gitLabReportBaseUrl.value = config.reportBaseUrl || '';
      this.gitLabToken.value = '';
      this.gitLabToken.placeholder = config.hasToken ? '已保存，留空表示不修改' : '需要 api 权限';
      this.gitLabLabels.value = config.labels || 'bug,Prism';
      this.gitLabAssigneeIds.value = config.assigneeIds || '';
      this.gitLabResult?.classList.add('hidden');
      this.gitLabModal?.classList.remove('hidden');
    } catch (error) {
      this.showErrorDialog(error.message || '加载 GitLab 配置失败');
    }
  }

  closeGitLabSettings() {
    this.gitLabModal?.classList.add('hidden');
    this.gitLabResult?.classList.add('hidden');
  }

  readGitLabSettingsForm() {
    return {
      enabled: true,
      baseUrl: this.gitLabBaseUrl?.value.trim() || 'https://gitlab.com',
      projectId: this.gitLabProjectId?.value.trim() || '',
      reportBaseUrl: this.gitLabReportBaseUrl?.value.trim() || '',
      token: this.gitLabToken?.value.trim() || '',
      labels: this.gitLabLabels?.value.trim() || 'bug,Prism',
      assigneeIds: this.gitLabAssigneeIds?.value.trim() || '',
    };
  }

  async saveGitLabSettings() {
    try {
      const response = await fetch('/api/gitlab/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.readGitLabSettingsForm())
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '保存 GitLab 配置失败');
      this.showGitLabResult('GitLab 配置已保存', 'success');
      setTimeout(() => this.closeGitLabSettings(), 500);
    } catch (error) {
      this.showGitLabResult(error.message || '保存 GitLab 配置失败', 'error');
    }
  }

  async testGitLabSettings() {
    this.btnGitLabTest.disabled = true;
    this.btnGitLabTest.textContent = '测试中...';
    try {
      const response = await fetch('/api/gitlab/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.readGitLabSettingsForm())
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'GitLab 连接失败');
      const projectName = result.project?.path_with_namespace || result.project?.name || '项目';
      this.showGitLabResult(`连接成功：${projectName}`, 'success');
    } catch (error) {
      this.showGitLabResult(error.message || 'GitLab 连接失败', 'error');
    } finally {
      this.btnGitLabTest.disabled = false;
      this.btnGitLabTest.textContent = '测试连接';
    }
  }

  showGitLabResult(message, type) {
    if (!this.gitLabResult) return;
    this.gitLabResult.textContent = message;
    this.gitLabResult.classList.remove('hidden', 'text-green-600', 'text-red-600');
    this.gitLabResult.classList.add(type === 'success' ? 'text-green-600' : 'text-red-600');
  }

  showErrorDialog(message) {
    this.testResult.classList.add('hidden');
    const existing = document.getElementById('settings-toast-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'settings-toast-dialog';
    dialog.className = 'fixed inset-0 z-[320] flex items-center justify-center px-4';
    dialog.style.zIndex = '9999';
    dialog.innerHTML = `
      <div class="absolute inset-0 bg-black/30 backdrop-blur-sm"></div>
      <div class="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-red-100 overflow-hidden">
        <div class="p-5">
          <div class="flex items-start gap-3">
            <div class="shrink-0 w-9 h-9 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-zinc-900">操作失败</h3>
              <p class="mt-1 text-sm text-zinc-600 leading-relaxed break-words">${this.escapeHtml(message || '操作失败')}</p>
            </div>
          </div>
          <div class="mt-5 flex justify-end">
            <button id="settings-toast-ok" class="px-4 py-2 text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-colors">
              知道了
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);
    const close = () => dialog.remove();
    dialog.querySelector('#settings-toast-ok')?.addEventListener('click', close);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target === dialog.firstElementChild) close();
    });
  }

  showConfirmDialog({ title = '确认操作', message = '', confirmText = '确认', cancelText = '取消', danger = false } = {}) {
    return new Promise((resolve) => {
      const existing = document.getElementById('settings-confirm-dialog');
      if (existing) existing.remove();

      const dialog = document.createElement('div');
      dialog.id = 'settings-confirm-dialog';
      dialog.className = 'fixed inset-0 z-[320] flex items-center justify-center px-4';
      dialog.style.zIndex = '9999';
      dialog.innerHTML = `
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm"></div>
        <div class="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-zinc-100 overflow-hidden">
          <div class="p-5">
            <div class="flex items-start gap-3">
              <div class="shrink-0 w-9 h-9 rounded-full ${danger ? 'bg-red-50 text-red-500' : 'bg-zinc-100 text-zinc-700'} flex items-center justify-center">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-zinc-900">${this.escapeHtml(title)}</h3>
                <p class="mt-1 text-sm text-zinc-600 leading-relaxed break-words">${this.escapeHtml(message)}</p>
              </div>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button id="settings-confirm-cancel" class="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors">
                ${this.escapeHtml(cancelText)}
              </button>
              <button id="settings-confirm-ok" class="px-4 py-2 text-sm font-medium text-white ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-zinc-900 hover:bg-zinc-800'} rounded-lg transition-colors">
                ${this.escapeHtml(confirmText)}
              </button>
            </div>
          </div>
        </div>
      `;

      const close = (value) => {
        dialog.remove();
        resolve(value);
      };

      document.body.appendChild(dialog);
      dialog.querySelector('#settings-confirm-cancel')?.addEventListener('click', () => close(false));
      dialog.querySelector('#settings-confirm-ok')?.addEventListener('click', () => close(true));
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target === dialog.firstElementChild) close(false);
      });
    });
  }

  getDefaultConfig() {
    return {
      provider: 'openai',
      activeModelId: 'model-openai-default',
      models: [
        {
          id: 'model-openai-default',
          name: 'OpenAI GPT-4',
          provider: 'openai',
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          requestUrl: '',
          endpoint: '',
          deploymentName: '',
          model: 'gpt-4'
        }
      ],
      providers: {
        openai: { name: 'OpenAI', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4' },
        anthropic: { name: 'Anthropic', apiKey: '', model: 'claude-3-sonnet-20240229' },
        azure: { name: 'Azure OpenAI', apiKey: '', endpoint: '', deploymentName: '' },
        custom: { name: '自定义', apiKey: '', baseUrl: '', model: '' }
      }
    };
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.settingsManager = new SettingsManager();
});
