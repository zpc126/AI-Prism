// input: 测试用例或自然语言指令
// output: 流式执行结果（通过回调）
// position: Pi 执行引擎适配器，支持流式输出

const { spawn } = require('child_process');
const path = require('path');

class PiRunner {
  constructor() {
    this.piPath = process.env.PI_PATH || 'pi';
    this.chromeProfile = this.getChromeProfile();
  }

  // 获取用户 Chrome profile 路径（继承登录态）
  getChromeProfile() {
    const os = require('os');
    const platform = process.platform;
    if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default');
    } else if (platform === 'win32') {
      return path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data/Default');
    }
    return path.join(os.homedir(), '.config/google-chrome/Default');
  }

  // 流式执行命令，通过 onLog 回调推送日志
  async executeStream(command, onLog) {
    const prompt = this.buildPrompt({
      title: '用户指令',
      steps: command.split(/[，,。.；;]/).filter(Boolean),
      expected: '操作成功完成'
    });

    onLog({ type: 'system', text: `启动 Pi 引擎...` });
    onLog({ type: 'system', text: `Chrome profile: ${this.chromeProfile}` });
    onLog({ type: 'divider', text: '' });

    return new Promise((resolve, reject) => {
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const args = ['--non-interactive', '--message', escapedPrompt];

      onLog({ type: 'thinking', text: `发送指令到 Pi Agent...` });
      onLog({ type: 'command', text: `${this.piPath} ${args.join(' ')}` });
      onLog({ type: 'divider', text: '' });

      const child = spawn(this.piPath, args, {
        env: {
          ...process.env,
          CHROME_USER_DATA: this.chromeProfile,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // 按行输出到终端
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          onLog({ type: 'stdout', text: line });
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          onLog({ type: 'stderr', text: line });
        }
      });

      child.on('close', (code) => {
        onLog({ type: 'divider', text: '' });
        if (code === 0) {
          onLog({ type: 'success', text: `执行完成` });
        } else {
          onLog({ type: 'error', text: `进程退出，代码 ${code}` });
        }
        resolve({ code, stdout, stderr });
      });

      child.on('error', (error) => {
        onLog({ type: 'error', text: `启动失败: ${error.message}` });
        reject(error);
      });
    });
  }

  // 构建提示词
  buildPrompt(testCase) {
    return `请执行以下测试用例：

标题：${testCase.title}
前置条件：${testCase.preconditions || '无'}
测试步骤：
${testCase.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}
预期结果：${testCase.expected}

请使用浏览器自动化工具执行上述步骤，并验证结果是否符合预期。
如果测试通过，输出 "TEST PASSED"；如果失败，输出 "TEST FAILED" 并说明原因。`;
  }
}

module.exports = { PiRunner };
