// input: ADB 状态与无线连接请求
// output: Android 真机连接 API
// position: 手机自动化设备管理路由

const express = require('express');
const { getDeviceStatus, connectDevice, pairDevice, screenshotBuffer } = require('./adb-device');

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

router.get('/adb/screenshot', (_req, res) => {
  try {
    const image = screenshotBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(image);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, status: getDeviceStatus() });
  }
});

module.exports = router;
