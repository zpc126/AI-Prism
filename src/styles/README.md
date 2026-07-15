<!-- input: Prism 页面结构、探索限次/持续状态、组件状态和响应式视口 -->
<!-- output: 主界面、探索运行边界、脚本库和报告样式 -->
<!-- position: src/styles 样式目录说明 -->

# src/styles/

样式文件目录。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| main.css | 主样式 | 全局样式、Prism 图标、探索模式与时长控件、历史报告、执行岛、脚本库和 GitLab 弹窗 |
| tailwind-input.css | Tailwind 输入 | 包含 @tailwind 指令，供 CLI 扫描 |
| tailwind-output.css | Tailwind 输出 | 由 CLI 生成的工具类，每次 dev 自动重建 |

## 构建

```bash
npm run build:css  # 手动重建 tailwind CSS
npm run dev        # 构建样式后启动 Web 服务
```
