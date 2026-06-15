# server/device/

Android 真机设备适配层，用于 Web 与手机跨端自动化测试。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| adb-device.js | 真机驱动 | 发现 USB/无线 ADB 设备，通过 UIAutomator 执行点击、输入、滑动、截图和页面快照 |
| routes.js | 设备 API | 查询设备状态、无线连接和 Android 11+ 无线调试配对 |

## 连接方式

- USB：手机开启开发者选项与 USB 调试，插入数据线并允许调试授权。
- 无线连接：输入无线调试中的连接地址，调用 `adb connect`。
- 首次无线配对：输入配对地址和 6 位配对码，调用 `adb pair`，配对后再连接。

中文输入依赖手机安装并启用 ADB Keyboard；英文和数字可直接使用系统 `input text`。
