# Scout 接入 PI 成为超级智能体

## 问题

Scout 现在把 LLM 当成"文本生成器"用，只能：
- 生成文本（测试用例）
- 不能用工具
- 不能自主规划
- 不能推理

## 解决方案

接入 PI SDK，让 PI 成为 Scout 的大脑。

## 架构对比

### 之前（直接调用 LLM API）

```
Scout 前端 → Express → OpenAI API → 返回文本
                                    ↓
                              只能生成文本
                              不能用工具
                              不能规划
```

### 之后（接入 PI SDK）

```
Scout 前端 → Express → PI SDK → PI Agent
                                ↓
                           规划能力 ✓
                           工具能力 ✓
                           推理能力 ✓
                           学习能力 ✓
```

## 实现步骤

### 1. 安装 PI SDK

```bash
npm install @mariozechner/pi-coding-agent
```

### 2. 创建 PI Agent 服务

`server/pi/pi-agent.js` - 核心服务

### 3. 创建 API 路由

`server/pi/routes.js` - HTTP API 接口

### 4. 注册 QA 专用工具

让 PI 可以使用：
- 浏览器工具（操作网页）
- 数据库工具（查询数据）
- API 工具（测试接口）

### 5. 创建 QA Skill

`server/pi/qa-skill.md` - 让 PI 理解 QA 测试

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/pi/analyze` | POST | 分析需求，制定测试策略 |
| `/api/pi/generate` | POST | 生成测试用例 |
| `/api/pi/execute` | POST | 执行测试 |
| `/api/pi/chat` | POST | 对话式交互 |
| `/api/pi/status` | GET | 获取 Scout Agent 状态 |

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

1. 集成 Scout 的浏览器工具到 PI Agent
2. 连接数据库工具
3. 实现自动测试流程
4. 添加学习和记忆功能

## 文件清单

```
server/pi/
├── README.md        # 说明文档
├── pi-agent.js      # PI Agent 核心服务
├── routes.js        # HTTP API 路由
└── qa-skill.md      # QA 专用 Skill

src/
├── pi-chat.js       # PI 对话组件
├── pi-demo.html     # 演示页面
└── styles/
    └── pi-chat.css  # 对话界面样式
```
