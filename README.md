# Prism Web

> AI 驱动的 QA 分身 — 让 AI 帮你测试企业内部系统。

Prism Web 是一个基于大语言模型的智能测试工具，能够理解需求文档、自动生成测试用例、驱动浏览器执行测试，并生成可视化报告。项目采用 Web-only 访问方式。

## 功能特性

- **需求分析** — 输入需求文档，AI 自动检查逻辑漏洞、边界场景、歧义描述
- **用例生成** — 从需求自动生成结构化测试用例，以思维导图形式展示
- **自动测试** — 用自然语言描述操作，Prism 接管浏览器帮你执行
- **Bug 回归** — 描述 Bug 表现，自动生成回归测试用例
- **测试报告** — 根据测试内容自动生成测试报告
- **知识大脑** — 记忆系统，存储和检索测试经验，越用越聪明

## 快速开始

### 环境要求

- Node.js >= 18
- macOS / Windows / Linux

### 安装

```bash
git clone https://github.com/zpc126/AI-Prism.git
cd AI-Prism
npm install
```

### 启动

```bash
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，进入右上角“设置”填写模型配置。

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

设置页配置保存在 `data/config.json`；没有 Web 配置时会回退到环境变量。

### 生产部署

```bash
# 安装依赖
npm install

# 安装浏览器自动化运行环境
npx playwright install chromium

# Linux 服务器如缺少系统依赖，可额外执行
npx playwright install-deps chromium

# 构建前端样式
npm run build

# 启动 Web 服务
HOST=0.0.0.0 PORT=3000 NODE_ENV=production npm start
```

默认监听 `127.0.0.1:3000`。需要容器或局域网访问时，可设置 `HOST=0.0.0.0` 和 `PORT`。

### 后台常驻

推荐使用 PM2 管理进程：

```bash
npm install -g pm2
HOST=0.0.0.0 PORT=3000 NODE_ENV=production pm2 start server/index.js --name prism-web
pm2 save
```

### Nginx 反向代理

如果绑定域名，可将 Nginx 转发到本地服务：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### 部署注意事项

- `data/` 是运行时数据目录，会保存配置、报告、截图和 SQLite 数据，请确保服务器可写并定期备份。
- `.env` 和 `data/config.json` 可能包含模型 API Key，不要提交到仓库。
- 公网部署前，建议为配置接口和内部测试入口增加访问控制，或仅部署在内网。
- Playwright 执行测试时会启动浏览器进程，服务器需要预留足够内存。
- 部署完成后，建议先访问 `/api/health` 确认服务状态，再进入页面配置模型。

## 技术栈

| 组件 | 技术 |
|------|------|
| 客户端 | 浏览器 Web |
| 前端 | Tailwind CSS, Canvas API |
| 后端 | Node.js, Express |
| 浏览器自动化 | Playwright |
| AI Agent | PI SDK |
| 数据库 | SQLite (better-sqlite3) |

## 项目结构

```
AI-Prism/
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
| `/api/analysis-reports` | POST | 保存需求分析报告并生成分享链接，兼容旧版文本报告 |
| `/analysis-reports/:id` | GET | 查看分享的需求分析报告 |
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
```

## License

[MIT](LICENSE)
