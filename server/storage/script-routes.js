// input: 脚本库 HTTP 请求
// output: 脚本 CRUD 和单脚本执行 SSE
// position: 自动化脚本库 API

const express = require('express');
const router = express.Router();
const {
  listScripts,
  getScriptById,
  updateScript,
  deleteScript,
} = require('./automation-scripts');
const {
  setCurrentExecutor,
  clearCurrentExecutor,
} = require('../executor/execution-state');

router.get('/', (req, res) => {
  try {
    res.json({
      success: true,
      scripts: listScripts({ search: req.query.search || '' }),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', (req, res) => {
  const script = getScriptById(req.params.id);
  if (!script) return res.status(404).json({ success: false, error: '脚本不存在' });
  res.json({ success: true, script });
});

router.put('/:id', (req, res) => {
  try {
    const script = updateScript(req.params.id, req.body);
    if (!script) return res.status(404).json({ success: false, error: '脚本不存在' });
    res.json({ success: true, script });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  res.json({ success: deleteScript(req.params.id) });
});

router.post('/:id/execute', async (req, res) => {
  const script = getScriptById(req.params.id);
  if (!script) return res.status(404).json({ success: false, error: '脚本不存在' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const { BatchExecutor } = require('../executor/batch-executor');
  const executor = new BatchExecutor();
  setCurrentExecutor(executor);
  let responseFinished = false;
  res.on('close', () => {
    if (!responseFinished) {
      clearCurrentExecutor(executor);
      executor.stop().catch(error => {
        console.error('[脚本库] 连接关闭后停止任务失败:', error.message);
      });
    }
  });
  const testCase = {
    ...script.sourceCase,
    id: script.sourceCase.id || script.id,
    title: script.name,
    productName: script.product_name,
    moduleName: script.module_name,
    category: script.module_name,
    expected: script.expected,
  };

  try {
    const result = await executor.execute([testCase], {
      title: `${script.name} - 脚本执行报告`,
      preferredScriptId: script.id,
      scriptOnly: true,
    }, log => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    });
    res.write(`event: complete\ndata: ${JSON.stringify({ success: !result.stopped && result.failed === 0, ...result })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    responseFinished = true;
    clearCurrentExecutor(executor);
  }
  res.end();
});

module.exports = router;
