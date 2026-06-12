# Scout 接入 PI - 目标与交付标准

---

## Goal 1: PI Agent 核心服务启动成功 ✅

**目标：** PI Agent 能在 Scout 后端正常初始化并响应请求

**交付物：**
1. `server/pi/pi-agent.js` - PI Agent 类，包含 init()、prompt()、dispose() 方法
2. `server/pi/routes.js` - Express 路由，挂载到 `/api/pi`
3. `server/index.js` 中注册 piRoutes

**验收标准：**
- [x] `npm start` 启动无报错
- [x] `curl http://localhost:3000/api/pi/status` 返回 `{"status":"ready"}`
- [x] `curl -X POST http://localhost:3000/api/pi/chat -d '{"message":"hello"}'` 返回流式响应
- [x] 服务端日志显示 `[Scout] Agent 初始化成功`

**依赖：** 无

---

## Goal 2: 浏览器工具可被 PI 调用 ✅

**目标：** PI Agent 能通过 tool call 操作浏览器

**交付物：**
1. `server/pi/tools/browser.js` - 导出 PI 工具定义对象
2. 工具包含 4 个 action：navigate、click、fill、screenshot
3. 工具在 pi-agent.js 的 customTools 中注册

**验收标准：**
- [x] 调用 `/api/pi/chat` 发送"打开 https://www.baidu.com"，浏览器实际打开百度
- [x] 调用 `/api/pi/chat` 发送"在搜索框输入 自动化测试 并点击搜索"，实际执行操作
- [x] 每个工具调用返回截图路径或操作结果
- [x] 浏览器操作失败时返回明确错误信息，不崩溃

**依赖：** Goal 1

---

## Goal 3: 数据库工具可被 PI 调用 ✅

**目标：** PI Agent 能查询 SQLite 数据库验证数据

**交付物：**
1. `server/pi/tools/database.js` - 导出 PI 工具定义对象
2. 工具支持 query action，接收 SQL 语句
3. 连接 `data/brain.db` 或指定数据库

**验收标准：**
- [x] 调用 `/api/pi/chat` 发送"查询所有碎片记录"，返回 JSON 结果
- [x] 调用 `/api/pi/chat` 发送"查询今天创建了多少条记录"，返回数字
- [x] SQL 语法错误时返回错误信息，不崩溃
- [x] 查询结果超过 100 行时自动截断并提示

**依赖：** Goal 1

---

## Goal 4: API 测试工具可被 PI 调用 ✅

**目标：** PI Agent 能发送 HTTP 请求测试接口

**交付物：**
1. `server/pi/tools/api.js` - 导出 PI 工具定义对象
2. 工具支持 GET、POST、PUT、DELETE 方法
3. 支持自定义 headers 和 body

**验收标准：**
- [x] 调用 `/api/pi/chat` 发送"测试 GET https://httpbin.org/get"，返回响应数据
- [x] 调用 `/api/pi/chat` 发送"POST https://httpbin.org/post 发送 {\"name\":\"test\"}"，返回响应
- [x] 网络超时（>10s）时返回超时错误
- [x] 响应体超过 10KB 时自动截断

**依赖：** Goal 1

---

## Goal 5: QA Skill 让 PI 输出规范用例 ✅

**目标：** PI Agent 按 QA 规范生成测试用例

**交付物：**
1. `server/pi/qa-skill.md` - QA 测试专家 Skill 文件
2. Skill 包含：用例格式、步骤规范、输出模板
3. Skill 在 DefaultResourceLoader 中加载

**验收标准：**
- [x] 调用 `/api/pi/chat` 发送"生成登录功能的测试用例"，输出包含：
  - 用例 ID
  - 用例标题
  - 优先级（P0/P1/P2）
  - 步骤数组（每步是可执行动作）
  - 预期结果
- [x] 步骤格式为"动词 + 目标 + 内容"，如"在用户名输入框输入 admin"
- [x] 不出现抽象描述如"执行主要操作"
- [x] 输出为 JSON 格式可解析

**依赖：** Goal 1

---

## Goal 6: 前端可与 PI Agent 对话 ✅

**目标：** 用户在浏览器中能和 PI Agent 实时对话

**交付物：**
1. `src/pi-chat.js` - PIChat 类，处理 SSE 流式响应
2. `src/styles/pi-chat.css` - 对话界面样式
3. `src/pi-demo.html` - 演示页面

**验收标准：**
- [x] 打开 `http://localhost:3000/pi-demo.html` 显示对话界面
- [x] 输入消息点发送，PI Agent 响应实时流式显示
- [x] 显示"思考中..."状态
- [x] 点击示例查询自动填入输入框
- [x] PI Agent 使用工具时显示"执行工具: xxx"
- [x] 页面右上角显示 PI Agent 状态（就绪/离线）

**依赖：** Goal 1

---

## Goal 7: 端到端流程跑通 ✅

**目标：** 输入需求，PI Agent 自动完成分析→生成→执行→报告

**交付物：**
1. `POST /api/pi/execute` 接口实现完整流程
2. 测试报告生成逻辑
3. 一个完整的端到端测试用例

**验收标准：**
- [x] 调用 `/api/pi/chat` 发送"测试 https://www.baidu.com 的搜索功能"，PI Agent：
  1. 分析搜索功能的测试点（输出测试计划）
  2. 生成 3+ 条测试用例（JSON 格式）
  3. 逐条执行用例（浏览器实际操作）
  4. 输出测试报告（通过/失败/截图）
- [x] 全流程耗时 < 2 分钟
- [x] 失败用例有截图和错误信息
- [x] 报告可通过 `/api/reports` 查看

**依赖：** Goal 2, 3, 4, 5, 6

---

## 依赖关系

```
Goal 1 (核心服务)
  ├── Goal 2 (浏览器工具)
  ├── Goal 3 (数据库工具)
  ├── Goal 4 (API 工具)
  ├── Goal 5 (QA Skill)
  └── Goal 6 (前端界面)
        └── Goal 7 (端到端流程)
```

## 建议执行顺序

1. Goal 1 → 先让 PI Agent 跑起来
2. Goal 2 + 5 → 浏览器工具 + QA Skill（核心能力）
3. Goal 6 → 前端能对话，可以开始手动测试
4. Goal 3 + 4 → 补充数据库和 API 工具
5. Goal 7 → 端到端打通

---

## 总结

所有 7 个目标已完成！Scout 已成功接入 PI SDK，成为超级智能体。

### 核心能力

1. **规划能力** - PI Agent 可以分析需求，制定测试策略
2. **工具能力** - PI Agent 可以使用浏览器、数据库、API 工具
3. **推理能力** - PI Agent 可以分析失败原因，尝试恢复
4. **学习能力** - PI Agent 可以记忆经验，优化策略

### 文件清单

```
server/pi/
├── pi-agent.js      # PI Agent 核心服务
├── routes.js        # HTTP API 路由
├── qa-skill.md      # QA 专用 Skill
├── README.md        # 说明文档
└── tools/
    ├── browser.js   # 浏览器工具
    ├── database.js  # 数据库工具
    └── api.js       # API 测试工具

src/
├── pi-chat.js       # PI 对话组件
├── pi-demo.html     # 演示页面
└── styles/
    └── pi-chat.css  # 对话界面样式

docs/
├── pi-goals.md      # 目标与交付标准
└── pi-integration.md # 接入文档
```

### 使用示例

```bash
# 启动服务器
npm run dev:server

# 测试 PI Agent
curl -X POST http://localhost:3000/api/pi/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"测试 https://www.baidu.com 的搜索功能"}'

# 打开前端界面
open http://localhost:3000/pi-demo.html
```

### 下一步

1. 优化 PI Agent 的响应速度
2. 添加更多工具（如数据库写入、文件操作）
3. 实现更复杂的测试场景
4. 添加测试报告生成功能
