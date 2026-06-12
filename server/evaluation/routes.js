// input: express.Router
// output: 评估 API 接口
// position: server/evaluation/routes.js

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const storage = require('./storage');
const runner = require('./runner');

// ========== 评估集 CRUD ==========

// 列表
router.get('/datasets', (req, res) => {
  try {
    const datasets = storage.listDatasets();
    res.json({ success: true, datasets });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 详情
router.get('/datasets/:id', (req, res) => {
  try {
    const dataset = storage.getDataset(req.params.id);
    if (!dataset) return res.status(404).json({ success: false, error: '不存在' });
    res.json({ success: true, dataset });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 创建
router.post('/datasets', (req, res) => {
  try {
    const { name, description, cases } = req.body;
    if (!name || !cases || !Array.isArray(cases)) {
      return res.status(400).json({ success: false, error: '缺少 name 或 cases' });
    }
    const id = 'ds_' + crypto.randomBytes(6).toString('hex');
    const dataset = storage.createDataset({ id, name, description, cases });
    res.json({ success: true, dataset });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 更新
router.put('/datasets/:id', (req, res) => {
  try {
    const dataset = storage.updateDataset(req.params.id, req.body);
    res.json({ success: true, dataset });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除
router.delete('/datasets/:id', (req, res) => {
  try {
    storage.deleteDataset(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== 评估运行 ==========

// 发起评估
router.post('/runs', (req, res) => {
  try {
    const { dataset_id } = req.body;
    if (!dataset_id) return res.status(400).json({ success: false, error: '缺少 dataset_id' });

    if (runner.isRunning()) {
      return res.status(409).json({ success: false, error: '已有评估在运行中' });
    }

    const id = 'run_' + crypto.randomBytes(6).toString('hex');
    const run = storage.createRun({ id, dataset_id });

    // 异步执行
    runner.runEvaluation(id, dataset_id).catch(console.error);

    res.json({ success: true, run });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 查询运行状态
router.get('/runs/:id', (req, res) => {
  try {
    const run = storage.getRun(req.params.id);
    if (!run) return res.status(404).json({ success: false, error: '不存在' });
    res.json({ success: true, run });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 运行列表
router.get('/runs', (req, res) => {
  try {
    const runs = storage.listRuns(req.query.dataset_id);
    res.json({ success: true, runs });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
