// input: HTTP 请求
// output: GEP API 响应
// position: GEP API 路由

const express = require('express');
const router = express.Router();
const { createGene, getAllGenes, getGeneById, updateGene, deleteGene, extractGeneFromTestCase } = require('./gene');
const { getCapsulesByGene, getBestCapsule } = require('./capsule');
const { getRelevantInsights, getInsightStats } = require('./insights');
const { GEPExecutor } = require('./gep-executor');

// ==================== Gene 管理 ====================

/**
 * 创建 Gene
 */
router.post('/genes', (req, res) => {
  try {
    const gene = createGene(req.body);
    res.json({ success: true, gene });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 从测试用例批量创建 Gene
 */
router.post('/genes/extract', (req, res) => {
  try {
    const { cases } = req.body;
    if (!cases || !Array.isArray(cases)) {
      return res.status(400).json({ error: '请提供测试用例数组' });
    }

    const genes = [];
    for (const testCase of cases) {
      const geneData = extractGeneFromTestCase(testCase);
      const gene = createGene(geneData);
      genes.push(gene);
    }

    res.json({ success: true, genes, count: genes.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取所有 Gene
 */
router.get('/genes', (req, res) => {
  try {
    const { module: moduleFilter, limit = 100 } = req.query;
    const genes = getAllGenes({ module: moduleFilter, limit: parseInt(limit) });
    res.json({ success: true, genes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取单个 Gene
 */
router.get('/genes/:id', (req, res) => {
  try {
    const gene = getGeneById(req.params.id);
    if (!gene) {
      return res.status(404).json({ error: 'Gene 不存在' });
    }
    res.json({ success: true, gene });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新 Gene
 */
router.put('/genes/:id', (req, res) => {
  try {
    const gene = updateGene(req.params.id, req.body);
    res.json({ success: true, gene });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除 Gene
 */
router.delete('/genes/:id', (req, res) => {
  try {
    const result = deleteGene(req.params.id);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Capsule 查询 ====================

/**
 * 获取 Gene 的所有 Capsule
 */
router.get('/genes/:id/capsules', (req, res) => {
  try {
    const capsules = getCapsulesByGene(req.params.id);
    res.json({ success: true, capsules });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取 Gene 的最佳 Capsule
 */
router.get('/genes/:id/best-capsule', (req, res) => {
  try {
    const capsule = getBestCapsule(req.params.id);
    res.json({ success: true, capsule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Insights 查询 ====================

/**
 * 获取相关 Insights
 */
router.post('/insights/relevant', (req, res) => {
  try {
    const { geneId, pageContext } = req.body;
    const insights = getRelevantInsights(geneId, pageContext);
    res.json({ success: true, insights });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取 Insights 统计
 */
router.get('/insights/stats', (req, res) => {
  try {
    const stats = getInsightStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== 执行 ====================

/**
 * 执行单个 Gene（SSE 流式）
 */
router.post('/execute/:geneId', async (req, res) => {
  const { geneId } = req.params;
  const { targetUrl } = req.body;

  const gene = getGeneById(geneId);
  if (!gene) {
    return res.status(404).json({ error: 'Gene 不存在' });
  }

  // 设置 SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const executor = new GEPExecutor({
    onLog: (log) => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    },
  });

  try {
    if (targetUrl) {
      gene.targetUrl = targetUrl;
    }

    const result = await executor.executeGene(gene);
    res.write(`event: complete\ndata: ${JSON.stringify({ success: true, result })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.end();
});

/**
 * 批量执行（SSE 流式）
 */
router.post('/execute-batch', async (req, res) => {
  const { geneIds, options = {} } = req.body;

  if (!geneIds || !Array.isArray(geneIds)) {
    return res.status(400).json({ error: '请提供 Gene ID 数组' });
  }

  const genes = geneIds.map(id => getGeneById(id)).filter(Boolean);
  if (genes.length === 0) {
    return res.status(404).json({ error: '未找到有效的 Gene' });
  }

  // 设置 SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const executor = new GEPExecutor({
    onLog: (log) => {
      res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
    },
  });

  try {
    const results = await executor.executeBatch(genes, options);
    res.write(`event: complete\ndata: ${JSON.stringify({ success: true, results })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.end();
});

/**
 * 从测试用例执行（一键转换 + 执行）
 */
router.post('/execute-cases', async (req, res) => {
  const { cases, options = {} } = req.body;

  if (!cases || !Array.isArray(cases)) {
    return res.status(400).json({ error: '请提供测试用例数组' });
  }

  // 设置 SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    // 1. 提取 Gene
    res.write(`event: log\ndata: ${JSON.stringify({ type: 'system', text: '正在提取测试意图...' })}\n\n`);

    const genes = [];
    for (const testCase of cases) {
      const geneData = extractGeneFromTestCase(testCase);
      const gene = createGene(geneData);
      genes.push(gene);
    }

    res.write(`event: log\ndata: ${JSON.stringify({ type: 'system', text: `已提取 ${genes.length} 个 Gene` })}\n\n`);

    // 2. 执行
    const executor = new GEPExecutor({
      onLog: (log) => {
        res.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`);
      },
    });

    const results = await executor.executeBatch(genes, options);
    res.write(`event: complete\ndata: ${JSON.stringify({ success: true, results, genes })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.end();
});

module.exports = router;
