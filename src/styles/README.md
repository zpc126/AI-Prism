# src/styles/

样式文件目录。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| main.css | 主样式 | 全局样式、Prism 图标动效、首页统计、对话岛与执行岛隔离样式 |
| tailwind-input.css | Tailwind 输入 | 包含 @tailwind 指令，供 CLI 扫描 |
| tailwind-output.css | Tailwind 输出 | 由 CLI 生成的工具类，每次 dev 自动重建 |

## 构建

```bash
npm run build:css  # 手动重建 tailwind CSS
npm run dev        # 构建样式后启动 Web 服务
```
