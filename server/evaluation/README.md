# server/evaluation/

Prism 评估模块。管理评估集、运行评估、实时监控。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| routes.js | 路由 | API 接口：CRUD + 运行评估 |
| runner.js | 核心 | Playwright 驱动 Prism E2E 评估 |
| storage.js | 存储 | 评估集 + 评估记录 SQLite |
| ws.js | 通信 | WebSocket 实时推送评估日志 |
