// input: Prism Agent API
// output: 对话界面，支持规划、工具使用、推理
// position: Prism Agent 对话组件

const API_BASE = '/api/pi';

// 废话过滤 - PI Agent 的默认描述
const FILLER_PATTERNS = [
  /我将执行.*命令/,
  /我将读取.*文件/,
  /我将进行.*操作/,
  /我将.*浏览器/,
  /接下来我会/,
  /让我.*执行/,
  /让我.*读取/,
  /让我.*查看/,
  /正在执行.*操作/,
  /执行.*命令.*\.\.\./,
  /读取.*文件.*\.\.\./,
  /命令执行完成/,
  /文件.*已读取/,
  /操作.*完成/,
];

const isFiller = (text) => {
  return FILLER_PATTERNS.some(p => p.test(text.trim()));
};

class PIChat {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.messages = [];
    this.isStreaming = false;
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="pi-chat">
        <div class="pi-chat-header">
          <h3>Prism Agent</h3>
          <span class="pi-status">就绪</span>
        </div>
        <div class="pi-messages" id="pi-messages"></div>
        <div class="pi-input-area">
          <textarea id="pi-input" placeholder="描述你想测试什么..." rows="3"></textarea>
          <div class="pi-actions">
            <button id="pi-btn-analyze" class="pi-btn">分析需求</button>
            <button id="pi-btn-generate" class="pi-btn">生成用例</button>
            <button id="pi-btn-send" class="pi-btn primary">发送</button>
          </div>
        </div>
      </div>
    `;

    this.messagesEl = document.getElementById('pi-messages');
    this.inputEl = document.getElementById('pi-input');
    
    document.getElementById('pi-btn-send').addEventListener('click', () => this.send());
    document.getElementById('pi-btn-analyze').addEventListener('click', () => this.analyze());
    document.getElementById('pi-btn-generate').addEventListener('click', () => this.generate());
    
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
  }

  addMessage(role, content) {
    const messageEl = document.createElement('div');
    messageEl.className = `pi-message ${role}`;
    messageEl.innerHTML = `
      <div class="pi-message-role">${role === 'user' ? '你' : 'Prism'}</div>
      <div class="pi-message-content">${content}</div>
    `;
    this.messagesEl.appendChild(messageEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return messageEl;
  }

  updateLastMessage(content) {
    const lastMessage = this.messagesEl.lastElementChild;
    if (lastMessage) {
      const contentEl = lastMessage.querySelector('.pi-message-content');
      contentEl.innerHTML = content;
    }
  }

  setStatus(status) {
    const statusEl = this.container.querySelector('.pi-status');
    statusEl.textContent = status;
  }

  async send() {
    const message = this.inputEl.value.trim();
    if (!message || this.isStreaming) return;

    this.addMessage('user', message);
    this.inputEl.value = '';
    this.isStreaming = true;
    this.setStatus('思考中...');

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      await this.handleSSE(response);
    } catch (error) {
      this.addMessage('error', `错误: ${error.message}`);
    } finally {
      this.isStreaming = false;
      this.setStatus('就绪');
    }
  }

  async analyze() {
    const requirement = this.inputEl.value.trim();
    if (!requirement || this.isStreaming) return;

    this.addMessage('user', `[分析需求] ${requirement}`);
    this.inputEl.value = '';
    this.isStreaming = true;
    this.setStatus('分析中...');

    try {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement }),
      });

      await this.handleSSE(response);
    } catch (error) {
      this.addMessage('error', `错误: ${error.message}`);
    } finally {
      this.isStreaming = false;
      this.setStatus('就绪');
    }
  }

  async generate() {
    const requirement = this.inputEl.value.trim();
    if (!requirement || this.isStreaming) return;

    this.addMessage('user', `[生成用例] ${requirement}`);
    this.inputEl.value = '';
    this.isStreaming = true;
    this.setStatus('生成中...');

    try {
      const response = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement }),
      });

      await this.handleSSE(response);
    } catch (error) {
      this.addMessage('error', `错误: ${error.message}`);
    } finally {
      this.isStreaming = false;
      this.setStatus('就绪');
    }
  }

  async handleSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let currentMessage = null;
    let fullText = '';  // 累积所有文本
    let renderTimer = null;

    // 渲染函数 - 渲染完整文本
    const renderText = () => {
      if (!currentMessage || !fullText) return;
      
      // 过滤废话
      const lines = fullText.split('\n').filter(line => !isFiller(line));
      const cleanText = lines.join('\n').trim();
      
      if (cleanText) {
        const contentEl = currentMessage.querySelector('.pi-message-content');
        contentEl.innerHTML = this.renderMarkdown(cleanText);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
      renderTimer = null;
    };

    // 节流渲染 - 每50ms最多渲染一次
    const scheduleRender = () => {
      if (!renderTimer) {
        renderTimer = setTimeout(renderText, 50);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        
        if (data === '[DONE]') {
          // 渲染剩余内容
          if (renderTimer) clearTimeout(renderTimer);
          renderText();
          this.setStatus('就绪');
          return;
        }

        try {
          const event = JSON.parse(data);
          
          if (event.type === 'text') {
            if (!currentMessage) {
              currentMessage = this.addMessage('assistant', '');
            }
            const delta = event.delta || '';
            
            // 累积文本
            fullText += delta;
            scheduleRender();
          } else {
            this.handleEvent(event, currentMessage);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
    
    // 渲染剩余内容
    if (renderTimer) clearTimeout(renderTimer);
    renderText();
  }

  handleEvent(event, currentMessage) {
    switch (event.type) {
      case 'tool_start':
        // 显示有意义的步骤，而不是 "执行工具: xxx"
        this.showToolStep(event.name);
        break;
      case 'tool_end':
        this.setStatus('思考中...');
        break;
      case 'complete':
        this.setStatus('就绪');
        break;
    }
  }

  // 根据工具名显示有意义的步骤描述
  showToolStep(toolName) {
    const toolSteps = {
      'bash': { action: '执行', desc: '运行命令' },
      'read': { action: '查看', desc: '读取文件内容' },
      'edit': { action: '编辑', desc: '修改文件' },
      'write': { action: '写入', desc: '创建/更新文件' },
      'browser': { action: '浏览器', desc: '操作页面' },
      'database': { action: '查询', desc: '数据库操作' },
      'api': { action: '请求', desc: '调用接口' },
    };
    
    const step = toolSteps[toolName] || { action: '执行', desc: toolName };
    this.addStep(step.action, step.desc);
    this.setStatus(`${this.getActionEmoji(step.action)} ${step.desc}`);
  }

  // 简单 markdown 渲染
  renderMarkdown(text) {
    return text
      // 标题
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      // 加粗
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 列表项
      .replace(/^\d+\. (.+)$/gm, '<div class="md-list-item">$1</div>')
      .replace(/^- (.+)$/gm, '<div class="md-list-item">• $1</div>')
      // 换行
      .replace(/\n/g, '<br>');
  }

  addStep(action, description) {
    const stepEl = document.createElement('div');
    
    // 根据动作类型添加样式类
    let stepClass = 'pi-step';
    const warnActions = ['问题', '注意', 'warning', 'error'];
    const successActions = ['完成', '正常', '不错', 'success'];
    
    if (warnActions.includes(action)) {
      stepClass += ' step-warn';
    } else if (successActions.includes(action)) {
      stepClass += ' step-success';
    }
    
    stepEl.className = stepClass;
    stepEl.innerHTML = `
      <span class="pi-step-action">${this.getActionEmoji(action)} ${action}</span>
      <span class="pi-step-desc">${description}</span>
    `;
    this.messagesEl.appendChild(stepEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  getActionEmoji(action) {
    const map = {
      // 操作类
      '打开': '🌐', 'navigate': '🌐',
      '点击': '👆', 'click': '👆',
      '输入': '⌨️', 'fill': '⌨️',
      '查看': '👁️', '截图': '📸', 'screenshot': '📸',
      '查询': '🔍', '等待': '⏳',
      '验证': '✓', '检查': '✓',
      '滚动': '↕️', 'scroll': '↕️',
      '执行': '▶️',
      '编辑': '✏️',
      '写入': '📝',
      '浏览器': '🌐',
      '请求': '📡',
      // 状态类
      '完成': '✅',
      '正常': '✅',
      '不错': '👍',
      // 发现类
      '发现': '💡',
      '问题': '⚠️',
      '注意': '🔔',
    };
    return map[action] || '▶';
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.piChat = new PIChat('pi-chat-container');
});
