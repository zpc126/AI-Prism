# Scout 项目

## 设计风格
优雅、高级、克制。参考 Linear、Vercel。禁止 AI 味道、渐变紫蓝、emoji。

## 核心规则
- 任何功能、架构、写法更新，必须在工作结束后更新相关目录的子文档
- 每个文件夹必须有 README.md，3行以内架构说明 + 每个文件的名字/地位/功能
- 每个文件开头必须有3行注释：input / output / position
- 文件被更新时，务必更新开头注释 + 所属文件夹的 README.md

## 项目结构
```
scout/
├── electron/        # Electron 主进程
├── server/          # 后端服务
│   ├── ai/          # LLM 调用
│   ├── executor/    # 用例执行
│   ├── pi/          # PI Agent 集成（超级智能体）
│   └── storage/     # 数据存储
└── src/             # 前端界面
    └── styles/      # 样式
```
