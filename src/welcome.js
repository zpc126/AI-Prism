// input: 首次使用引导
// output: 引导用户配置 API Key
// position: 新用户引导流程

class WelcomeGuide {
  constructor() {
    this.modal = document.getElementById('welcome-modal');
    this.currentStep = 0;
    this.steps = [
      {
        title: '欢迎使用 Prism',
        content: `
          <div class="text-center py-4">
            <span class="prism-avatar prism-avatar-lg" aria-hidden="true"></span>
            <p class="text-zinc-500 text-sm leading-relaxed">AI 驱动的测试助手<br>让 Prism 帮你完成测试工作</p>
          </div>
        `
      },
      {
        title: '配置模型',
        content: `
          <div class="space-y-4">
            <p class="text-sm text-zinc-600 leading-relaxed">Prism 需要连接 AI 模型才能工作。</p>
            <div class="bg-zinc-50 rounded-lg p-4">
              <p class="text-xs text-zinc-400 mb-3">支持的提供商</p>
              <div class="grid grid-cols-2 gap-y-2 gap-x-4">
                <div class="flex items-center gap-2 text-sm text-zinc-700">
                  <span class="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                  <span>OpenAI</span>
                </div>
                <div class="flex items-center gap-2 text-sm text-zinc-700">
                  <span class="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                  <span>Anthropic</span>
                </div>
                <div class="flex items-center gap-2 text-sm text-zinc-700">
                  <span class="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                  <span>DeepSeek</span>
                </div>
                <div class="flex items-center gap-2 text-sm text-zinc-700">
                  <span class="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                  <span>其他兼容服务</span>
                </div>
              </div>
            </div>
            <p class="text-xs text-zinc-400">点击下方按钮配置 API Key</p>
          </div>
        `
      },
      {
        title: '开始使用',
        content: `
          <div class="space-y-3">
            <div class="flex items-center gap-3 py-2">
              <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-zinc-800">生成测试用例</p>
                <p class="text-xs text-zinc-400">输入需求，自动生成结构化用例</p>
              </div>
            </div>
            <div class="flex items-center gap-3 py-2">
              <div class="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-zinc-800">自动执行测试</p>
                <p class="text-xs text-zinc-400">Prism 接管浏览器，自动操作</p>
              </div>
            </div>
            <div class="flex items-center gap-3 py-2">
              <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-zinc-800">生成测试报告</p>
                <p class="text-xs text-zinc-400">自动汇总测试结果</p>
              </div>
            </div>
          </div>
        `
      }
    ];
  }

  init() {
    const hasSeenWelcome = localStorage.getItem('scout_welcome_seen');
    if (!hasSeenWelcome) {
      this.show();
    }
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('welcome-next')?.addEventListener('click', () => this.next());
    document.getElementById('welcome-skip')?.addEventListener('click', () => this.skip());
    document.getElementById('welcome-settings')?.addEventListener('click', () => this.openSettings());
  }

  show() {
    this.currentStep = 0;
    this.render();
    this.modal?.classList.remove('hidden');
  }

  hide() {
    this.modal?.classList.add('hidden');
    localStorage.setItem('scout_welcome_seen', 'true');
  }

  render() {
    const step = this.steps[this.currentStep];
    const content = document.getElementById('welcome-content');
    const title = document.getElementById('welcome-title');
    const dots = document.getElementById('welcome-dots');
    const nextBtn = document.getElementById('welcome-next');
    const settingsBtn = document.getElementById('welcome-settings');
    const skipBtn = document.getElementById('welcome-skip');

    if (title) title.textContent = step.title;
    if (content) content.innerHTML = step.content;

    if (dots) {
      dots.innerHTML = this.steps.map((_, i) => `
        <div class="w-1.5 h-1.5 rounded-full transition-colors ${i === this.currentStep ? 'bg-zinc-800' : 'bg-zinc-300'}"></div>
      `).join('');
    }

    if (this.currentStep === this.steps.length - 1) {
      if (nextBtn) nextBtn.classList.add('hidden');
      if (settingsBtn) settingsBtn.classList.remove('hidden');
      if (skipBtn) skipBtn.textContent = '开始使用';
    } else {
      if (nextBtn) nextBtn.classList.remove('hidden');
      if (settingsBtn) settingsBtn.classList.add('hidden');
      if (skipBtn) skipBtn.textContent = '跳过';
    }
  }

  next() {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      this.render();
    }
  }

  skip() {
    this.hide();
  }

  openSettings() {
    this.hide();
    window.settingsManager?.open();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.welcomeGuide = new WelcomeGuide();
  window.welcomeGuide.init();
});
