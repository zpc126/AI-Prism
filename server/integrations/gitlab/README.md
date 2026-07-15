<!-- input: GitLab Issue、成员、里程碑、附件与本地配置模块 -->
<!-- output: GitLab 集成目录架构及文件职责索引 -->
<!-- position: server/integrations/gitlab 目录说明 -->

# server/integrations/gitlab/

GitLab Issue 集成层，复用本地配置把自动化报告、手工 Bug 草稿、项目里程碑和图片证据提交到项目。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| client.js | 客户端 | GitLab REST API、Issue 创建、项目成员/活跃里程碑查询、项目连接测试与附件上传 |
| client.test.js | 测试 | 验证活跃里程碑查询以及创建 Issue 时的 milestone_id 契约 |
| config.js | 配置 | GitLab Base URL、Project、Token、Labels、Assignee 本地持久化 |
| issue-builder.js | 转换 | 把自动化测试报告失败结果转换成可编辑 Issue 草稿 |
| routes.js | 路由 | GitLab 配置、项目成员/活跃里程碑、报告 Issue 草稿/提交、一键提交、手工 Bug、图片附件上传与 AI 完善 API |
| README.md | 文档 | 说明 GitLab 集成目录结构 |
