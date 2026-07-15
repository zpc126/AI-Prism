// input: 限次/持续 Web 探索、停止、历史查询与新旧截图目录读取请求
// output: SSE 探索事件、持久化运行策略与可正常预览的受限证据文件
// position: AI 探索测试 HTTP API，管理任务生命周期并兼容证据存储路径

const express = require('express');
const path = require('path');
const fs = require('fs');
const { ExplorationRunner, normalizeTargetUrl } = require('./runner');
const { createRun, completeRun, failRun, getRun, listRuns } = require('./store');

const router = express.Router();
const screenshotDirs = [
  path.join(__dirname, '../data/screenshots'),
  path.join(__dirname, '../../data/screenshots'),
];
let activeTask = null;

function sendSse(res, event) {
  if (!res.writableEnded && !res.destroyed) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

router.get('/runs', (req, res) => {
  res.json({ success: true, runs: listRuns(req.query.limit) });
});

router.get('/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ success: false, error: '探索记录不存在' });
  return res.json({ success: true, run });
});

router.get('/evidence/:filename', (req, res) => {
  const filename = String(req.params.filename || '');
  if (!filename || path.basename(filename) !== filename || !/^[\w\-.\u4e00-\u9fa5]+$/.test(filename)) {
    return res.status(400).json({ success: false, error: '证据文件名无效' });
  }
  const filepath = screenshotDirs
    .map(directory => path.join(directory, filename))
    .find(candidate => fs.existsSync(candidate));
  if (!filepath) return res.status(404).json({ success: false, error: '证据文件不存在' });
  return res.sendFile(filepath);
});

router.post('/run', async (req, res) => {
  if (activeTask) {
    return res.status(409).json({ success: false, error: '已有探索任务正在执行，请先停止或等待完成' });
  }

  let targetUrl;
  try {
    targetUrl = normalizeTargetUrl(req.body?.targetUrl);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || '探索地址无效' });
  }

  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  if ((username && !password) || (!username && password)) {
    return res.status(400).json({ success: false, error: '账号和密码需要同时填写' });
  }

  const input = {
    targetUrl,
    scope: String(req.body?.scope || '').trim(),
    readOnly: req.body?.readOnly !== false,
    maxActions: Math.min(Math.max(Number(req.body?.maxActions) || 24, 8), 50),
    continuous: req.body?.continuous === true,
    maxDurationMinutes: Number(req.body?.maxDurationMinutes) > 0
      ? Math.min(Math.max(Number(req.body.maxDurationMinutes), 1), 1440)
      : null,
  };
  const created = createRun(input);
  let clientClosed = false;
  let settled = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  sendSse(res, { type: 'started', run: created });

  const runner = new ExplorationRunner({
    ...input,
    id: created.id,
    username,
    password,
    onEvent: event => sendSse(res, event),
  });
  activeTask = { id: created.id, runner };

  res.on('close', () => {
    clientClosed = true;
    if (!settled && activeTask?.id === created.id) runner.stop().catch(() => {});
  });

  try {
    const result = await runner.run();
    settled = true;
    const completed = completeRun(created.id, result);
    sendSse(res, { type: 'complete', run: completed });
    sendSse(res, { type: 'done' });
  } catch (error) {
    settled = true;
    const stopped = error?.code === 'EXPLORATION_STOPPED' || runner.stopped;
    const failed = failRun(created.id, error, {
      stopped,
      actions: runner.actions,
      screenshots: runner.screenshots,
      logs: runner.logs,
    });
    sendSse(res, { type: stopped ? 'stopped' : 'error', error: failed.errorMessage, run: failed });
  } finally {
    if (activeTask?.id === created.id) activeTask = null;
    await runner.dispose();
    if (!clientClosed && !res.writableEnded) res.end();
  }
});

router.post('/runs/:id/stop', async (req, res) => {
  if (!activeTask || activeTask.id !== req.params.id) {
    return res.status(404).json({ success: false, error: '当前没有对应的运行中任务' });
  }
  await activeTask.runner.stop();
  return res.json({ success: true });
});

module.exports = router;
