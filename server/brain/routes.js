// input: HTTP 请求
// output: 大脑 API 响应
// position: 大脑 API 路由

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { 
  createFragment, 
  getAllFragments, 
  updateFragment, 
  deleteFragment, 
  getTagStats, 
  getStats,
  addFragmentImage,
  getFragmentImages,
  deleteFragmentImage,
  createFragmentWithImage,
  getFragmentWithImages
} = require('./fragments');
const { recall, recallWithAssociations, recordRecallUsage } = require('./recall');
const { recallWithImages, findRelatedFragments, getImageKnowledgeGraph } = require('./image-recall');
const { dream, getDreamLogs } = require('./dream');

// 配置 multer 用于图片上传
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片格式 (PNG, JPG, GIF, WebP)'));
    }
  }
});

/**
 * 创建碎片
 */
router.post('/fragments', (req, res) => {
  try {
    const { content, tags = [], source = 'manual' } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const fragment = createFragment(content, tags, source);
    res.json({ success: true, fragment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 创建带图片的碎片
 */
router.post('/fragments/with-image', upload.single('image'), async (req, res) => {
  try {
    const { content, tags = '[]', source = 'manual', imageDescription = '' } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    let imageBase64 = null;
    if (req.file) {
      imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }
    
    const parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
    const fragment = createFragmentWithImage(content, parsedTags, source, imageBase64, imageDescription);
    res.json({ success: true, fragment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 为已有碎片添加图片
 */
router.post('/fragments/:id/images', upload.single('image'), (req, res) => {
  try {
    const { id } = req.params;
    const { description = '' } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: '请上传图片' });
    }
    
    const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const image = addFragmentImage(parseInt(id), imageBase64, description, req.file.mimetype);
    res.json({ success: true, image });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取碎片的图片
 */
router.get('/fragments/:id/images', (req, res) => {
  try {
    const { id } = req.params;
    const images = getFragmentImages(parseInt(id));
    res.json({ success: true, images });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除碎片图片
 */
router.delete('/fragments/:fragmentId/images/:imageId', (req, res) => {
  try {
    const { imageId } = req.params;
    const result = deleteFragmentImage(parseInt(imageId));
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取带图片的碎片详情
 */
router.get('/fragments/:id/detail', (req, res) => {
  try {
    const { id } = req.params;
    const fragment = getFragmentWithImages(parseInt(id));
    if (!fragment) {
      return res.status(404).json({ error: 'Fragment not found' });
    }
    res.json({ success: true, fragment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 智能拆碎片：用 LLM 从一段话里提取多条认知碎片
 */
router.post('/fragments/extract', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    
    const { callLLM } = require('../ai/generate');
    
    const systemPrompt = `你是一个认知碎片提取器。用户会给你一段话，你需要从中提取出独立的认知碎片（记忆点）。

规则：
- 每个碎片是一个独立的、可被未来消费的知识点
- 碎片要具体、明确，不要笼统概括
- 像人的记忆点一样，每个碎片聚焦一个细节
- 为每个碎片提取 2-3 个标签
- 碎片数量 2-6 个，取决于原文信息密度

输出 JSON 数组，每项格式：
{"content": "碎片内容", "tags": ["标签1", "标签2"]}

只输出 JSON 数组，不要其他内容。`;
    
    const result = await callLLM(systemPrompt, text);
    
    // 解析 JSON
    let fragments = [];
    try {
      // 提取 JSON 数组
      const jsonMatch = result.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (jsonMatch) {
        fragments = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('解析碎片 JSON 失败:', e);
    }
    
    // 保存每个碎片
    const saved = [];
    for (const f of fragments) {
      if (f.content && f.content.trim()) {
        const fragment = createFragment(f.content.trim(), f.tags || [], 'learned');
        saved.push(fragment);
      }
    }
    
    res.json({ success: true, fragments: saved, count: saved.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取所有碎片
 */
router.get('/fragments', (req, res) => {
  try {
    const { limit = 100, offset = 0, source } = req.query;
    const fragments = getAllFragments({ limit: parseInt(limit), offset: parseInt(offset), source });
    res.json({ success: true, fragments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新碎片
 */
router.put('/fragments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const fragment = updateFragment(parseInt(id), updates);
    res.json({ success: true, fragment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除碎片
 */
router.delete('/fragments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteFragment(parseInt(id));
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 检索记忆
 */
router.post('/recall', (req, res) => {
  try {
    const { query, limit = 10, useAssociations = true } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const results = useAssociations 
      ? recallWithAssociations(query, { limit })
      : recall(query, { limit });
    
    // 记录使用
    recordRecallUsage(results.map(r => r.id));
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 触发做梦
 */
router.post('/dream', async (req, res) => {
  try {
    const { callLLM } = require('../ai/generate');
    const llmCall = async (prompt) => {
      return callLLM(
        '你是 Prism 的知识整理助手。请把输入内容压缩为可复用的测试知识、规则、模块关系和风险洞察，输出简洁中文。',
        prompt
      );
    };
    
    const results = await dream(llmCall);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取做梦日志
 */
router.get('/dream-logs', (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const logs = getDreamLogs(parseInt(limit));
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取标签统计
 */
router.get('/tags', (req, res) => {
  try {
    const tags = getTagStats();
    res.json({ success: true, tags });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取统计信息
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 图文混合检索
 */
router.post('/recall-with-images', async (req, res) => {
  try {
    const { query, limit = 10 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    
    const results = await recallWithImages(query, { limit });
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取图文知识图谱
 */
router.get('/knowledge-graph', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const graph = await getImageKnowledgeGraph({ limit: parseInt(limit) });
    res.json({ success: true, graph });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
