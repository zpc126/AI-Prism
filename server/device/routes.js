// input: ADB 状态与无线连接请求
// output: Android 真机连接 API
// position: 手机自动化设备管理路由

const express = require('express');
const { getDeviceStatus, connectDevice, pairDevice, screenshotBufferAsync, compressedScreenshotBuffer } = require('./adb-device');
const { getScrcpyStatus, startScrcpyMirror, stopScrcpyMirror } = require('./scrcpy-mirror');

const router = express.Router();

router.get('/adb', (_req, res) => {
  res.json({ success: true, status: getDeviceStatus() });
});

router.post('/adb/connect', (req, res) => {
  try {
    res.json({ success: true, status: connectDevice(req.body.address) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, status: getDeviceStatus() });
  }
});

router.post('/adb/pair', (req, res) => {
  try {
    res.json({ success: true, result: pairDevice(req.body.address, req.body.code) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/adb/screenshot', async (_req, res) => {
  try {
    const startedAt = Date.now();
    const raw = _req.query.raw === '1';
    if (raw) {
      const image = await screenshotBufferAsync();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Prism-Mirror-Mode', 'raw-png');
      res.setHeader('X-Prism-Mirror-Cost', String(Date.now() - startedAt));
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.end(image);
      return;
    }
    const image = await compressedScreenshotBuffer({
      maxWidth: _req.query.width || 420,
      quality: _req.query.quality || 72,
    });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Prism-Mirror-Mode', 'compressed-jpeg');
    res.setHeader('X-Prism-Mirror-Cost', String(Date.now() - startedAt));
    res.setHeader('X-Prism-Mirror-Original-Bytes', String(image.originalBytes));
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(image.buffer);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, status: getDeviceStatus() });
  }
});

router.get('/scrcpy/status', (_req, res) => {
  res.json({ success: true, status: getScrcpyStatus() });
});

router.post('/scrcpy/start', (req, res) => {
  try {
    res.json({ success: true, status: startScrcpyMirror(req.body || {}) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, status: getScrcpyStatus() });
  }
});

router.post('/scrcpy/stop', (_req, res) => {
  res.json({ success: true, status: stopScrcpyMirror() });
});

module.exports = router;
