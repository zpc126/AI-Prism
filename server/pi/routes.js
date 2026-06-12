// input: Express router, PIAgent
// output: PI Agent API 路由
// position: PI Agent 的 HTTP API 接口

const express = require('express');
const router = express.Router();
const { PIAgent } = require('./pi-agent');

// 全局 PI Agent 实例
let piAgent = null;

// 初始化 PI Agent
async function getAgent() {
  if (!piAgent) {
    piAgent = new PIAgent({
      onEvent: (type, data) => {
        console.log(`[PI] ${type}:`, data);
      },
    });
    await piAgent.init();
  }
  return piAgent;
}

// POST /api/pi/analyze - 分析需求
router.post('/analyze', async (req, res) => {
  try {
    const { requirement } = req.body;
    if (!requirement) {
      return res.status(400).json({ error: '缺少需求内容' });
    }

    const agent = await getAgent();

    // 设置 SSE 响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 重写 onEvent 以发送 SSE
    agent.onEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    await agent.analyzeRequirement(requirement);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[PI] 分析失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pi/generate - 生成测试用例
router.post('/generate', async (req, res) => {
  try {
    const { requirement } = req.body;
    if (!requirement) {
      return res.status(400).json({ error: '缺少需求内容' });
    }

    const agent = await getAgent();

    // 设置 SSE 响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 重写 onEvent 以发送 SSE
    agent.onEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    await agent.generateTestCases(requirement);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[PI] 生成失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pi/execute - 执行测试
router.post('/execute', async (req, res) => {
  try {
    const { testCase } = req.body;
    if (!testCase) {
      return res.status(400).json({ error: '缺少测试用例' });
    }

    const agent = await getAgent();

    // 设置 SSE 响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 重写 onEvent 以发送 SSE
    agent.onEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    await agent.executeTest(testCase);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[PI] 执行失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pi/chat - 对话式交互
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: '缺少消息内容' });
    }

    console.log('[PI] 收到消息:', message);
    const agent = await getAgent();

    // 设置 SSE 响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 重写 onEvent 以发送 SSE
    agent.onEvent = (type, data) => {
      console.log('[PI] 事件:', type, data);
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    console.log('[PI] 开始处理消息...');
    await agent.prompt(message);
    console.log('[PI] 消息处理完成');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[PI] 对话失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/pi/status - 获取 PI Agent 状态
router.get('/status', async (req, res) => {
  try {
    const agent = await getAgent();
    res.json({
      status: 'ready',
      sessionId: agent.session?.sessionId,
      hasSession: !!agent.session,
    });
  } catch (error) {
    res.json({
      status: 'error',
      error: error.message,
    });
  }
});

// POST /api/pi/reset - 重置 PI Agent
router.post('/reset', async (req, res) => {
  try {
    if (piAgent) {
      await piAgent.dispose();
      piAgent = null;
    }
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
