// input: Android ADB device status
// output: scrcpy low-latency mirror process lifecycle
// position: Native scrcpy video mirror bridge for the web control UI

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const { getDeviceStatus } = require('./adb-device');

let scrcpyProcess = null;
let lastLog = '';
let startedAt = null;

function resolveCommand(name) {
  const lookup = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  const command = String(lookup.stdout || '').trim();
  if (command && fs.existsSync(command)) return command;
  return '';
}

function getScrcpyStatus() {
  const scrcpyPath = resolveCommand('scrcpy');
  return {
    available: Boolean(scrcpyPath),
    scrcpyPath,
    running: Boolean(scrcpyProcess && !scrcpyProcess.killed),
    startedAt,
    lastLog,
  };
}

function startScrcpyMirror(options = {}) {
  const scrcpyPath = resolveCommand('scrcpy');
  if (!scrcpyPath) {
    throw new Error('未安装 scrcpy，请先执行 brew install scrcpy');
  }

  const status = getDeviceStatus();
  if (!status.connected || !status.active?.serial) {
    throw new Error('未连接 Android 真机，请先通过 USB 或无线 ADB 连接');
  }

  if (scrcpyProcess && !scrcpyProcess.killed) {
    return { ...getScrcpyStatus(), device: status.active, reused: true };
  }

  lastLog = '';
  startedAt = new Date().toISOString();
  const args = [
    '-s', status.active.serial,
    '--window-title=Prism Android 投屏',
    '--max-size', String(options.maxSize || 1024),
    '--max-fps', String(options.maxFps || 60),
    '--video-bit-rate', options.bitRate || '8M',
    '--video-buffer', '0',
    '--no-audio',
    '--stay-awake',
  ];

  scrcpyProcess = spawn(scrcpyPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ADB: process.env.ADB_PATH || process.env.ADB },
  });

  const appendLog = chunk => {
    lastLog = `${lastLog}${chunk.toString()}`.slice(-4000);
  };
  scrcpyProcess.stdout.on('data', appendLog);
  scrcpyProcess.stderr.on('data', appendLog);
  scrcpyProcess.on('exit', (code, signal) => {
    appendLog(`\n[scrcpy exited code=${code ?? ''} signal=${signal ?? ''}]`);
    scrcpyProcess = null;
  });
  scrcpyProcess.on('error', error => {
    appendLog(`\n[scrcpy error] ${error.message}`);
    scrcpyProcess = null;
  });

  return {
    ...getScrcpyStatus(),
    running: true,
    device: status.active,
    args,
    mode: 'scrcpy-window',
  };
}

function stopScrcpyMirror() {
  if (scrcpyProcess && !scrcpyProcess.killed) {
    scrcpyProcess.kill('SIGTERM');
    scrcpyProcess = null;
  }
  return getScrcpyStatus();
}

module.exports = {
  getScrcpyStatus,
  startScrcpyMirror,
  stopScrcpyMirror,
};
