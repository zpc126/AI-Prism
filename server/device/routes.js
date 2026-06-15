// input: ADB 状态与无线连接请求
// output: Android 真机连接 API
// position: 手机自动化设备管理路由

const express = require('express');
const { getDeviceStatus, connectDevice, pairDevice } = require('./adb-device');

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

module.exports = router;
