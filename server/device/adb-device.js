// input: ADB 地址、手机 UI 操作参数
// output: Android 真机连接状态、点击输入滑动截图和界面快照
// position: Web 与 Android 真机跨端自动化的 ADB 适配层

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function resolveAdbPath() {
  const configured = process.env.ADB_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  const lookup = spawnSync('sh', ['-lc', 'command -v adb'], { encoding: 'utf8' });
  const discovered = String(lookup.stdout || '').trim();
  if (discovered) return discovered;
  const localCandidate = path.join(os.homedir(), 'Downloads', '未命名文件夹', 'platform-tools', 'adb');
  if (fs.existsSync(localCandidate)) return localCandidate;
  throw new Error('未找到 ADB，请安装 Android platform-tools 或配置 ADB_PATH');
}

function runAdb(args, options = {}) {
  const result = spawnSync(resolveAdbPath(), args, {
    encoding: options.binary ? null : 'utf8',
    timeout: options.timeout || 15000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `ADB 命令失败：${args.join(' ')}`);
  }
  return options.binary ? result.stdout : String(result.stdout || '').trim();
}

function listDevices() {
  const output = runAdb(['devices', '-l']);
  return output.split('\n').slice(1).map(line => line.trim()).filter(Boolean).map(line => {
    const [serial, state, ...details] = line.split(/\s+/);
    const model = details.find(item => item.startsWith('model:'))?.slice(6) || '';
    return { serial, state, model, connected: state === 'device' };
  });
}

function getDeviceStatus() {
  try {
    const devices = listDevices();
    const active = devices.find(device => device.connected) || null;
    return {
      available: true,
      connected: Boolean(active),
      active,
      devices,
      adbPath: resolveAdbPath(),
    };
  } catch (error) {
    return { available: false, connected: false, active: null, devices: [], error: error.message };
  }
}

function connectDevice(address) {
  const target = String(address || '').trim();
  if (!/^[\w.-]+:\d+$/.test(target)) {
    throw new Error('请输入正确的无线 ADB 地址，例如 192.168.1.20:5555');
  }
  const message = runAdb(['connect', target], { timeout: 20000 });
  const status = getDeviceStatus();
  if (!status.connected) throw new Error(message || 'ADB 连接失败');
  return { ...status, message };
}

function pairDevice(address, code) {
  const target = String(address || '').trim();
  const pairingCode = String(code || '').trim();
  if (!/^[\w.-]+:\d+$/.test(target)) {
    throw new Error('请输入手机无线调试页面显示的配对地址');
  }
  if (!/^\d{6}$/.test(pairingCode)) {
    throw new Error('请输入 6 位无线调试配对码');
  }
  const message = runAdb(['pair', target, pairingCode], { timeout: 20000 });
  if (!/success|paired/i.test(message)) throw new Error(message || 'ADB 配对失败');
  return { success: true, message };
}

function getActiveSerial() {
  const status = getDeviceStatus();
  if (!status.connected) {
    throw new Error('未连接 Android 真机，请通过 USB 数据线或无线 ADB 连接');
  }
  return status.active.serial;
}

function adbForDevice(args, options = {}) {
  return runAdb(['-s', getActiveSerial(), ...args], options);
}

function decodeXml(value = '') {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getUiNodes() {
  const remotePath = '/sdcard/prism-window.xml';
  adbForDevice(['shell', 'uiautomator', 'dump', remotePath], { timeout: 12000 });
  const xml = adbForDevice(['exec-out', 'cat', remotePath], { timeout: 12000 });
  return [...xml.matchAll(/<node\s+([^>]+?)(?:\/?)>/g)].map(match => {
    const attrs = {};
    for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs[attr[1]] = decodeXml(attr[2]);
    }
    const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    return {
      text: attrs.text || '',
      description: attrs['content-desc'] || '',
      resourceId: attrs['resource-id'] || '',
      className: attrs.class || '',
      clickable: attrs.clickable === 'true',
      editable: attrs.class?.includes('EditText'),
      bounds: bounds ? bounds.slice(1).map(Number) : null,
    };
  });
}

function findNode(target, { editable = false } = {}) {
  const keyword = String(target || '').trim().toLowerCase();
  const nodes = getUiNodes().filter(node => node.bounds && (!editable || node.editable));
  const matched = nodes.find(node =>
    [node.text, node.description, node.resourceId].some(value =>
      String(value || '').toLowerCase().includes(keyword)
    )
  );
  if (matched) return matched;
  if (editable) return nodes.find(node => node.editable) || null;
  return null;
}

function tapNode(node) {
  if (!node?.bounds) throw new Error('手机元素没有可点击区域');
  const [left, top, right, bottom] = node.bounds;
  adbForDevice(['shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))]);
}

function click(target) {
  const node = findNode(target);
  if (!node) throw new Error(`手机页面找不到元素：${target}`);
  tapNode(node);
  return { success: true, action: 'click', target, device: 'mobile', deviceLabel: 'Android 真机' };
}

function fill(target, value) {
  const node = findNode(target, { editable: true });
  if (!node) throw new Error(`手机页面找不到输入框：${target}`);
  tapNode(node);
  adbForDevice(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
  const text = String(value);
  if (/[^\x20-\x7E]/.test(text)) {
    const packages = adbForDevice(['shell', 'pm', 'list', 'packages', 'com.android.adbkeyboard']);
    if (!packages.includes('com.android.adbkeyboard')) {
      throw new Error('手机输入包含中文，请先在设备安装并启用 ADB Keyboard');
    }
    adbForDevice(['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', text]);
  } else {
    adbForDevice(['shell', 'input', 'text', text.replace(/ /g, '%s')]);
  }
  return { success: true, action: 'fill', target, value, device: 'mobile', deviceLabel: 'Android 真机' };
}

function navigate(target) {
  const value = String(target || '').trim();
  if (!value) throw new Error('手机端打开操作缺少目标');
  if (/^https?:\/\//i.test(value)) {
    adbForDevice(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', value]);
  } else if (/^[\w.]+\/[\w.$]+$/.test(value)) {
    adbForDevice(['shell', 'am', 'start', '-n', value]);
  } else {
    throw new Error('手机端打开请填写 URL 或 Android 包名/Activity');
  }
  return { success: true, action: 'navigate', target: value, device: 'mobile', deviceLabel: 'Android 真机' };
}

function getSnapshot() {
  const nodes = getUiNodes();
  const visible = nodes.filter(node => node.text || node.description);
  return {
    success: true,
    action: 'get_snapshot',
    device: 'mobile',
    deviceLabel: 'Android 真机',
    snapshot: {
      visibleText: visible.slice(0, 50).map(node => node.text || node.description),
      buttons: visible.filter(node => node.clickable).slice(0, 30).map(node => ({ text: node.text || node.description })),
      inputs: nodes.filter(node => node.editable).map(node => ({ placeholder: node.text || node.description || node.resourceId })),
    },
    summary: `Android 真机界面：${visible.length} 个可见文本，${nodes.filter(node => node.editable).length} 个输入框`,
  };
}

function screenshot(label = 'mobile') {
  const dir = path.join(__dirname, '../../data/screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${label}_${Date.now()}.png`);
  fs.writeFileSync(filepath, adbForDevice(['exec-out', 'screencap', '-p'], { binary: true, timeout: 15000 }));
  return { success: true, action: 'screenshot', filepath, filename: path.basename(filepath), device: 'mobile', deviceLabel: 'Android 真机' };
}

function screenshotBuffer() {
  return adbForDevice(['exec-out', 'screencap', '-p'], { binary: true, timeout: 15000 });
}

function runAdbAsync(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveAdbPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    const errorChunks = [];
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ADB 截图超时'));
    }, options.timeout || 8000);

    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => errorChunks.push(chunk));
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(Buffer.concat(errorChunks).toString('utf8').trim() || `ADB 命令失败：${args.join(' ')}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function screenshotBufferAsync() {
  return runAdbAsync(['-s', getActiveSerial(), 'shell', 'screencap', '-p'], { timeout: 5000 });
}

async function compressedScreenshotBuffer({ maxWidth = 420, quality = 72 } = {}) {
  const png = await screenshotBufferAsync();
  const image = await loadImage(png);
  const scale = Math.min(1, Number(maxWidth) / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  const buffer = await canvas.encode('jpeg', Math.max(30, Math.min(90, Number(quality) || 72)));
  return { buffer, width, height, originalBytes: png.length };
}

function scroll(direction = 'down', amount = 500) {
  const size = adbForDevice(['shell', 'wm', 'size']);
  const match = size.match(/(\d+)x(\d+)/);
  const width = match ? Number(match[1]) : 390;
  const height = match ? Number(match[2]) : 844;
  const x = Math.round(width / 2);
  const down = direction !== 'up';
  const startY = Math.round(height * (down ? 0.75 : 0.25));
  const endY = Math.round(height * (down ? 0.25 : 0.75));
  adbForDevice(['shell', 'input', 'swipe', String(x), String(startY), String(x), String(endY), String(Math.max(200, amount))]);
  return { success: true, action: 'scroll', direction, device: 'mobile', deviceLabel: 'Android 真机' };
}

function waitForElement(target, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const node = findNode(target);
    if (node) return { success: true, action: 'wait', target, device: 'mobile', deviceLabel: 'Android 真机' };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`等待手机元素超时：${target}`);
}

module.exports = {
  getDeviceStatus,
  connectDevice,
  pairDevice,
  click,
  fill,
  navigate,
  getSnapshot,
  screenshot,
  screenshotBuffer,
  screenshotBufferAsync,
  compressedScreenshotBuffer,
  scroll,
  waitForElement,
};
