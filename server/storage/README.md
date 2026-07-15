# server/storage/

数据存储模块，管理会话、统计、脚本库和旧脚本兼容导出。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| sessions.js | 存储 | 用例生成会话、需求版本与 AI 对话记录的增删改查 |
| stats.js | 存储 | 首页统计累计、历史会话回填、报告数量和执行次数汇总 |
| routes.js | 路由 | 会话 API 路由与轻量对话记录保存接口 |
| automation-scripts.js | 存储 | 自动化脚本库、旧脚本字段兼容、DSL v2 归一化和脚本包导出 |
| script-routes.js | 路由 | 脚本库 CRUD、GitLab 配置读取、脚本包导出、GitLab 提交与单脚本回放 SSE |
