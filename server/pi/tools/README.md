# server/pi/tools/

PI Agent 的自定义工具定义，用于扩展 Agent 的能力。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| browser.js | 核心工具 | 浏览器操作：导航、点击、填写、截图、页面快照、滚动、等待 |
| database.js | 数据工具 | 数据库查询和操作 |
| api.js | API 工具 | 外部 API 调用 |

## Browser Tool 操作

| 操作 | 说明 | 参数 |
|------|------|------|
| navigate | 导航到 URL | target: URL |
| click | 点击元素 | target: 元素文本/选择器 |
| fill | 填写输入框 | target: 输入框, value: 内容 |
| screenshot | 截图 | target: 标签（可选） |
| get_snapshot | 获取页面快照 | 无 |
| wait | 等待元素出现 | target: 选择器 |
| scroll | 滚动页面 | target: 方向, value: 距离 |
