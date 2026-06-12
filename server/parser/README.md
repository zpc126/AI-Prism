# Parser

> 文件解析模块，支持 PDF、DOCX、图片

## 架构

```
parser/
├── file-parser.js    # 文件解析核心
├── routes.js         # API 路由
└── README.md
```

## 支持格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| PDF | .pdf | 提取文本内容 |
| Word | .docx, .doc | 提取文本内容 |
| 图片 | .png, .jpg, .jpeg, .gif, .webp | 返回 base64，用于多模态 LLM |
| 文本 | .txt, .md | 直接读取 |

## API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/files/upload` | POST | 单文件上传并解析 |
| `/api/files/upload-multiple` | POST | 多文件上传并解析 |
| `/api/files/supported-formats` | GET | 获取支持的格式 |

## 使用示例

```javascript
// 上传文件
const formData = new FormData();
formData.append('file', file);

const response = await fetch('/api/files/upload', {
  method: 'POST',
  body: formData
});

const data = await response.json();
// data.data.text - 提取的文本
// data.data.type - 文件类型
// data.data.base64 - 图片的 base64（仅图片）
```
