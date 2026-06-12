# Scout Web

> AI 驱动的 QA 分身 — 让 AI 帮你测试企业内部系统。

Scout Web 是一个基于大语言模型的智能测试工具，能够理解需求文档、自动生成测试用例、驱动浏览器执行测试，并生成可视化报告。默认通过浏览器访问，同时保留 Electron 桌面入口。

## 功能特性

- **需求分析** — 输入需求文档，AI 自动检查逻辑漏洞、边界场景、歧义描述
- **用例生成** — 从需求自动生成结构化测试用例，以思维导图形式展示
- **自动测试** — 用自然语言描述操作，Scout 接管浏览器帮你执行
- **Bug 回归** — 描述 Bug 表现，自动生成回归测试用例
- **测试报告** — 根据测试内容自动生成测试报告
- **知识大脑** — 记忆系统，存储和检索测试经验，越用越聪明

## 快速开始

### 环境要求

- Node.js >= 18
- macOS / Windows / Linux

### 安装

```bash
git clone https://github.com/your-username/scout.git
cd scout
npm install
```

### 启动

```bash
npm run dev
```

打开 [http://127.0.0.1:3001](http://127.0.0.1:3001)，进入右上角“设置”填写模型配置。

也可以复制环境变量模板，通过 `.env` 配置：

```bash
cp .env.example .env
```

编辑 `.env`，配置你的 LLM API Key：

```env
# OpenAI
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4
OPENAI_BASE_URL=https://api.openai.com/v1

# 或者使用其他兼容 OpenAI 接口的服务
CUSTOM_API_KEY=xxx
CUSTOM_BASE_URL=https://api.xxx.com/v1
CUSTOM_MODEL=xxx
```

设置页配置保存在 `data/config.json`，与 Electron 桌面配置隔离；没有 Web 配置时会回退到环境变量。

### 生产启动

```bash
npm run build
npm start
```

默认仅监听 `127.0.0.1:3001`。需要容器或局域网访问时，可设置 `HOST=0.0.0.0` 和 `PORT`，并在公网部署前为配置接口增加访问控制。

## 技术栈

| 组件 | 技术 |
|------|------|
| 客户端 | 浏览器（可选 Electron） |
| 前端 | Tailwind CSS, Canvas API |
| 后端 | Node.js, Express |
| 浏览器自动化 | Playwright |
| AI Agent | PI SDK |
| 数据库 | SQLite (better-sqlite3) |

## 项目结构

```
scout/
├── electron/              # 可选 Electron 桌面壳
│   ├── main.js            # 主进程入口
│   └── preload.js         # 预加载脚本
├── src/                   # 前端代码
│   ├── index.html         # 主页面
│   ├── renderer.js        # Web 页面主逻辑
│   ├── canvas.js          # 画布引擎（思维导图）
│   ├── pi-chat.js         # PI Agent 聊天界面
│   └── styles/            # 样式文件
├── server/                # Node.js 后端
│   ├── index.js           # 服务端入口
│   ├── ai/                # AI 调用
│   │   └── generate.js    # 用例生成、需求分析
│   ├── executor/          # 测试执行器
│   │   ├── pi-engine-runner.js  # PI Agent 执行器
│   │   └── batch-executor.js    # 批量执行器
│   ├── pi/                # PI Agent 集成
│   │   ├── pi-agent.js    # Agent 封装
│   │   ├── routes.js      # API 路由
│   │   └── tools/         # Agent 工具（浏览器等）
│   ├── brain/             # 知识大脑
│   │   ├── db.js          # SQLite 数据库
│   │   ├── fragments.js   # 知识碎片 CRUD
│   │   ├── recall.js      # 记忆检索
│   │   └── routes.js      # API 路由
│   ├── scraper/           # 内容抓取
│   │   └── url-scraper.js
│   ├── parser/            # 文件解析
│   │   └── file-parser.js
│   └── storage/           # 会话存储
│       └── sessions.js
├── data/                  # 数据目录（运行时生成）
├── .env.example           # 环境变量模板
├── LICENSE                # MIT License
└── package.json
```

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/config` | GET/PUT | Web 模型配置读写 |
| `/api/generate-cases` | POST | 生成测试用例 |
| `/api/generate-cases-stream` | POST | 流式生成用例 |
| `/api/generate-report` | POST | 生成测试报告 |
| `/api/execute-stream` | POST | 执行测试（流式） |
| `/api/stop` | POST | 停止执行 |
| `/api/brain/fragments` | GET/POST | 知识碎片管理 |
| `/api/brain/recall` | POST | 记忆检索 |
| `/api/sessions` | GET/POST | 会话管理 |

## 开发

```bash
# 启动 Web 开发模式（构建 CSS 后启动服务）
npm run dev

# 手动重建 Tailwind CSS
npm run build:css

# 构建 Web 静态资源
npm run build

# 可选：启动或打包 Electron 桌面版
npm run desktop
npm run build:desktop
```

## License

[MIT](LICENSE)
