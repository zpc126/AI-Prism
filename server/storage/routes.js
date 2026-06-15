// input: HTTP 请求
// output: 会话 API 响应
// position: 会话 API 路由

const express = require('express');
const router = express.Router();
const { createSession, getSessionById, getAllSessions, updateSession, deleteSession, getSessionStats } = require('./sessions');
const { syncSessionCasesToKnowledge, deleteSessionKnowledge } = require('./case-learning');

setImmediate(() => {
  try {
    const sessions = getAllSessions({ limit: 10000, offset: 0 });
    const learned = sessions.reduce(
      (total, session) => total + syncSessionCasesToKnowledge(session).learned,
      0
    );
    console.log(`[自动学习] 已同步 ${sessions.length} 个历史会话、${learned} 条测试用例`);
  } catch (error) {
    console.error('[自动学习] 历史用例补学失败:', error.message);
  }
});

/**
 * 创建会话
 */
router.post('/', (req, res) => {
  try {
    const data = req.body;
    
    if (!data.id) {
      data.id = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    const session = createSession(data);
    const learning = syncSessionCasesToKnowledge(session);
    res.json({ success: true, session, learning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取所有会话
 */
router.get('/', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const sessions = getAllSessions({ limit: parseInt(limit), offset: parseInt(offset) });
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 单独保存对话，不触发历史用例知识重新学习
 */
router.put('/:id/chat-history', (req, res) => {
  try {
    const { id } = req.params;
    const chatHistory = Array.isArray(req.body.chatHistory) ? req.body.chatHistory : [];
    const session = updateSession(id, { chatHistory });
    if (!session) return res.status(404).json({ error: '会话不存在' });
    res.json({ success: true, chatHistory: session.chatHistory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取单个会话
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const session = getSessionById(id);
    
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新会话
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const session = updateSession(id, updates);
    const learning = syncSessionCasesToKnowledge(session);
    res.json({ success: true, session, learning });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除会话
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteSession(id);
    const deletedKnowledge = deleteSessionKnowledge(id);
    res.json({ success: true, result, deletedKnowledge });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取统计
 */
router.get('/stats/summary', (req, res) => {
  try {
    const stats = getSessionStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
