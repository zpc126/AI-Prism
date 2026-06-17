// input: Android ADB device and scrcpy server binary
// output: Browser-consumable H.264 frame stream over WebSocket
// position: Low-latency in-browser Android mirror bridge

const { spawn, spawnSync, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');
const { getDeviceStatus } = require('./adb-device');

const DEVICE_SERVER_PATH = '/data/local/tmp/prism-scrcpy-server.jar';
const DEVICE_NAME_SIZE = 64;
const CODEC_SIZE = 4;
const SCRCPY_4_HEADER_SIZE = DEVICE_NAME_SIZE + CODEC_SIZE + 4 + 4 + 4;
const PACKET_HEADER_SIZE = 12;
const FLAG_CONFIG = 0x80000000;
const FLAG_KEY_FRAME = 0x40000000;

let session = null;
let wss = null;
let lastLog = '';

function appendLog(chunk) {
  lastLog = `${lastLog}${chunk.toString()}`.slice(-5000);
}

function resolveCommand(name) {
  const lookup = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return String(lookup.stdout || '').trim();
}

function resolveAdbPath() {
  return process.env.ADB_PATH || process.env.ADB || resolveCommand('adb') || 'adb';
}

function resolveScrcpyServerPath() {
  if (process.env.SCRCPY_SERVER_PATH && fs.existsSync(process.env.SCRCPY_SERVER_PATH)) {
    return process.env.SCRCPY_SERVER_PATH;
  }

  const result = spawnSync('sh', [
    '-lc',
    [
      'find /opt/homebrew/Cellar/scrcpy /usr/local/Cellar/scrcpy -path "*/share/scrcpy/scrcpy-server" -type f 2>/dev/null',
      'sort -V',
      'tail -n 1',
    ].join(' | '),
  ], { encoding: 'utf8' });
  const found = String(result.stdout || '').trim();
  if (found && fs.existsSync(found)) return found;

  throw new Error('未找到 scrcpy-server，请先安装 scrcpy：brew install scrcpy');
}

function execAdb(args, timeout = 12000) {
  return new Promise((resolve, reject) => {
    execFile(resolveAdbPath(), args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function connectTcp(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

function allocatePort() {
  const base = 27400;
  return base + Math.floor(Math.random() * 500);
}

class BrowserScrcpySession {
  constructor(device) {
    this.device = device;
    const scidBytes = crypto.randomBytes(4);
    scidBytes[0] &= 0x7f;
    this.scid = scidBytes.toString('hex');
    this.socketName = `scrcpy_${this.scid}`;
    this.port = allocatePort();
    this.clients = new Set();
    this.serverProcess = null;
    this.videoSocket = null;
    this.controlSocket = null;
    this.pending = Buffer.alloc(0);
    this.pendingConfig = null;
    this.headerConsumed = false;
    this.info = null;
    this.startedAt = new Date().toISOString();
  }

  async start() {
    const serverPath = resolveScrcpyServerPath();
    await execAdb(['-s', this.device.serial, 'push', serverPath, DEVICE_SERVER_PATH]);

    const args = [
      '-s', this.device.serial,
      'shell',
      `CLASSPATH=${DEVICE_SERVER_PATH} app_process / com.genymobile.scrcpy.Server`,
      '4.0',
      `scid=${this.scid}`,
      'tunnel_forward=true',
      'video=true',
      'control=true',
      'audio=false',
      'cleanup=false',
      'video_codec=h264',
      'video_bit_rate=4000000',
      'max_fps=30',
      'max_size=720',
      'send_device_meta=true',
      'send_frame_meta=true',
      'send_dummy_byte=false',
    ];

    this.serverProcess = spawn(resolveAdbPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.serverProcess.stdout.on('data', appendLog);
    this.serverProcess.stderr.on('data', appendLog);
    this.serverProcess.once('exit', (code, signal) => {
      appendLog(`\n[browser-scrcpy exited code=${code ?? ''} signal=${signal ?? ''}]`);
      this.closeSockets();
      if (session === this) session = null;
    });

    await new Promise(resolve => setTimeout(resolve, 1200));
    await execAdb(['-s', this.device.serial, 'forward', `tcp:${this.port}`, `localabstract:${this.socketName}`]);
    this.videoSocket = await connectTcp(this.port);
    this.controlSocket = await connectTcp(this.port);
    this.videoSocket.on('data', chunk => this.onVideoData(chunk));
    this.videoSocket.on('close', () => this.stop());
    this.videoSocket.on('error', error => {
      appendLog(`\n[browser-scrcpy video error] ${error.message}`);
      this.stop();
    });
  }

  addClient(ws) {
    this.clients.add(ws);
    if (this.info) this.sendInfo(ws);
    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        setTimeout(() => {
          if (this.clients.size === 0) this.stop();
        }, 800);
      }
    });
  }

  sendInfo(ws) {
    if (!this.info || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'info', ...this.info, device: this.device, startedAt: this.startedAt }));
  }

  broadcastJson(payload) {
    const data = JSON.stringify(payload);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  broadcastFrame(frame) {
    const header = Buffer.from([frame.keyframe ? 1 : 0]);
    const payload = Buffer.concat([header, frame.payload]);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) {
        ws.send(payload, { binary: true });
      }
    }
  }

  onVideoData(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    if (!this.headerConsumed) {
      if (this.pending.length < SCRCPY_4_HEADER_SIZE) return;
      const header = this.pending.subarray(0, SCRCPY_4_HEADER_SIZE);
      this.pending = this.pending.subarray(SCRCPY_4_HEADER_SIZE);
      this.headerConsumed = true;
      this.info = this.parseHeader(header);
      this.broadcastJson({ type: 'info', ...this.info, device: this.device, startedAt: this.startedAt });
    }
    this.drainPackets();
  }

  parseHeader(buf) {
    const deviceName = buf.subarray(0, DEVICE_NAME_SIZE).toString('utf8').replace(/\0.*/, '');
    const codec = buf.subarray(DEVICE_NAME_SIZE, DEVICE_NAME_SIZE + CODEC_SIZE).toString('ascii');
    return {
      deviceName,
      codec,
      width: buf.readUInt32BE(72),
      height: buf.readUInt32BE(76),
    };
  }

  drainPackets() {
    while (this.pending.length >= PACKET_HEADER_SIZE) {
      const flagsHi = this.pending.readUInt32BE(0);
      const length = this.pending.readUInt32BE(8);
      if (this.pending.length < PACKET_HEADER_SIZE + length) return;

      const payload = Buffer.from(this.pending.subarray(PACKET_HEADER_SIZE, PACKET_HEADER_SIZE + length));
      this.pending = this.pending.subarray(PACKET_HEADER_SIZE + length);

      if ((flagsHi & FLAG_CONFIG) !== 0) {
        this.pendingConfig = this.pendingConfig ? Buffer.concat([this.pendingConfig, payload]) : payload;
        continue;
      }

      const keyframe = (flagsHi & FLAG_KEY_FRAME) !== 0;
      let frame = payload;
      if (this.pendingConfig) {
        frame = Buffer.concat([this.pendingConfig, payload]);
        this.pendingConfig = null;
      }
      this.broadcastFrame({ payload: frame, keyframe });
    }
  }

  closeSockets() {
    this.videoSocket?.destroy();
    this.controlSocket?.destroy();
    this.videoSocket = null;
    this.controlSocket = null;
  }

  stop() {
    this.closeSockets();
    this.serverProcess?.kill('SIGTERM');
    this.serverProcess = null;
    execAdb(['-s', this.device.serial, 'forward', '--remove', `tcp:${this.port}`]).catch(() => {});
    this.broadcastJson({ type: 'end' });
    if (session === this) session = null;
  }
}

async function getOrCreateSession() {
  if (session) return session;

  const status = getDeviceStatus();
  if (!status.connected || !status.active?.serial) {
    throw new Error('未连接 Android 真机，请先通过 USB 或无线 ADB 连接');
  }

  session = new BrowserScrcpySession(status.active);
  try {
    await session.start();
    return session;
  } catch (error) {
    session?.stop();
    session = null;
    throw error;
  }
}

function initBrowserScrcpyWs(server) {
  if (wss) return wss;
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (!request.url || !request.url.startsWith('/ws/device-mirror')) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
  wss.on('connection', async (ws) => {
    try {
      ws.send(JSON.stringify({ type: 'status', message: '正在启动浏览器内 scrcpy 视频流...' }));
      const activeSession = await getOrCreateSession();
      activeSession.addClient(ws);
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', error: error.message }));
      ws.close();
    }
  });
  return wss;
}

function stopBrowserScrcpyMirror() {
  session?.stop();
  session = null;
  return getBrowserScrcpyStatus();
}

function getBrowserScrcpyStatus() {
  return {
    running: Boolean(session),
    clients: session?.clients.size || 0,
    startedAt: session?.startedAt || null,
    info: session?.info || null,
    lastLog,
  };
}

module.exports = {
  initBrowserScrcpyWs,
  getBrowserScrcpyStatus,
  stopBrowserScrcpyMirror,
};
