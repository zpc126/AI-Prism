<!-- input: 模型配置、系统提示词、工具集合和 PI SDK -->
<!-- output: 普通用例执行与专项探索可复用的 Agent 会话 -->
<!-- position: server/pi 模块说明 -->

# PI Agent 集成

Prism 接入 PI SDK，获得超级智能体能力。

## 架构

```
Prism 前端 → Express API → PI SDK → PI Agent
                                    ↓
                               规划能力
                               工具能力
                               推理能力
                               学习能力
```

## 文件说明

| 文件 | 功能 |
|------|------|
| `pi-agent.js` | Prism PI Agent 核心服务，支持调用方传入专项系统提示词和受限工具集合 |
| `routes.js` | HTTP API 路由 |
| `qa-skill.md` | QA 专用 Skill |

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/pi/analyze` | POST | 分析需求，制定测试策略 |
| `/api/pi/generate` | POST | 生成测试用例 |
| `/api/pi/execute` | POST | 执行测试 |
| `/api/pi/chat` | POST | 对话式交互 |
| `/api/pi/status` | GET | 获取 Prism Agent 状态 |
| `/api/pi/reset` | POST | 重置 Prism Agent |

## 使用示例

### 分析需求

```javascript
const response = await fetch('/api/pi/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    requirement: '用户登录功能，支持手机号+验证码登录'
  })
});

// SSE 响应
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // 处理事件
}
```

### 对话式交互

```javascript
const response = await fetch('/api/pi/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '帮我测试这个登录页面，先看看有什么问题'
  })
});
```

## PI Agent 的能力

### 1. 规划能力

PI Agent 可以：
- 分析需求，识别测试点
- 制定测试策略和执行顺序
- 动态调整计划

### 2. 工具能力

PI Agent 可以使用：
- **浏览器工具** - 操作网页、截图
- **数据库工具** - 查询验证数据
- **API 工具** - 测试接口

### 3. 推理能力

PI Agent 可以：
- 分析失败原因
- 尝试多种恢复策略
- 从错误中学习

### 4. 学习能力

PI Agent 可以：
- 记忆测试经验
- 优化测试策略
- 越跑越快越稳

## 下一步

1. 集成 Prism 的浏览器工具到 PI Agent
2. 连接数据库工具
3. 实现自动测试流程
4. 添加学习和记忆功能
