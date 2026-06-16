# Server

> Prism 后端服务

## 架构

```
server/
├── index.js              # Web 服务入口、静态资源、图片请求、局域网监听与路由注册
├── config.js             # Web-only 配置中心
├── ai/                   # AI 能力
│   ├── generate.js       # 用例生成、Base URL 规范化与流式响应校验
│   └── README.md
├── brain/                # Agent 大脑
│   ├── db.js             # SQLite 数据库
│   ├── fragments.js      # 碎片 CRUD
│   ├── recall.js         # 记忆检索（bigram 相似度）
│   ├── dream.js          # 记忆整合（做梦机制）
│   ├── routes.js         # API 路由
│   └── README.md
├── gep/                  # GEP 执行协议
│   ├── gene.js           # 基因层（测试意图 + 验收条件）
│   ├── capsule.js        # 胶囊层（执行路径 + 环境指纹）
│   ├── insights.js       # 经验层（执行发现沉淀）
│   ├── gep-executor.js   # 核心执行器（双通道方案）
│   ├── routes.js         # API 路由
│   └── README.md
├── scraper/              # 内容抓取
│   └── url-scraper.js    # URL 抓取（飞书/Notion/通用）
├── parser/               # 文件解析
│   ├── file-parser.js    # PDF/DOCX/Excel/图片解析
│   └── routes.js         # API 路由
├── reports/              # 测试报告
│   ├── report-store.js   # 报告、用例详情与截图索引存储
│   └── routes.js         # API 路由与 HTML 报告渲染
├── device/               # Android 真机
│   ├── adb-device.js     # USB/无线 ADB、UIAutomator 操作与截图
│   ├── routes.js         # 设备状态、连接和配对 API
│   └── README.md
├── executor/             # 旧版执行器（兼容）
│   ├── pi-runner.js      # PI 引擎适配器
│   ├── auto-runner.js    # 自动化执行器
│   ├── enhanced-runner.js # 增强执行器
│   ├── batch-executor.js # 批量执行器
│   └── README.md
├── evaluation/           # Web E2E 评估
│   ├── runner.js         # Chromium 评估执行器
│   ├── storage.js        # 评估数据存储
│   ├── routes.js         # API 路由
│   ├── ws.js             # 实时日志推送
│   └── README.md
├── pi/                   # PI Agent 集成
│   ├── pi-agent.js       # PI Agent 核心服务
│   ├── routes.js         # HTTP API 路由
│   ├── qa-skill.md       # QA 专用 Skill
│   └── README.md
└── storage/              # 会话与统计存储
    ├── sessions.js       # 会话 CRUD
    ├── stats.js          # 首页统计累计与汇总
    ├── routes.js         # API 路由
    └── README.md
```

## 核心模块

### GEP（Gene-Evolution Protocol）

GEP 是 Prism 的核心执行协议，解决了传统自动化测试的脆弱性问题。

- **Gene**：测试意图 + 验收条件（稳定的）
- **Capsule**：执行路径 + 环境指纹（可复用的）
- **Insights**：执行发现 + 经验沉淀（进化的）

详见 [gep/README.md](./gep/README.md)

### Brain（Agent 大脑）

记忆系统，存储和检索"工作认知"碎片。

- **Fragments**：知识碎片存储
- **Recall**：bigram 相似度检索
- **Dream**：记忆整合机制

详见 [brain/README.md](./brain/README.md)

### Scraper（内容抓取）

支持多种需求载体的内容抓取。

- 飞书文档
- Notion 页面
- 通用网页
- 自动检测 URL 输入

### Prism Agent（超级智能体）

Prism 接入 PI SDK，获得超级智能体能力。

- **规划能力** - 分析需求，制定测试策略
- **工具能力** - 使用浏览器、数据库、API 工具
- **推理能力** - 分析失败原因，尝试恢复
- **学习能力** - 记忆经验，优化策略

详见 [pi/README.md](./pi/README.md)

## API 接口

### 核心 API

详见 [README.md](../README.md)

### Prism Agent API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/pi/analyze` | POST | 分析需求，制定测试策略 |
| `/api/pi/generate` | POST | 生成测试用例 |
| `/api/pi/execute` | POST | 执行测试 |
| `/api/pi/chat` | POST | 对话式交互 |
| `/api/pi/status` | GET | 获取 Prism Agent 状态 |
| `/api/pi/reset` | POST | 重置 Prism Agent |
| `/api/device/adb` | GET | 查询 Android 真机连接状态 |
| `/api/device/adb/connect` | POST | 连接无线 ADB 设备 |
| `/api/device/adb/pair` | POST | 使用 6 位配对码完成无线调试配对 |
