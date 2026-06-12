# Brain

> Prism 大脑模块，实现记忆存储、检索和整合

## 架构

```
brain/
├── db.js              # SQLite 数据库
├── fragments.js       # 碎片 CRUD（支持图片附件）
├── recall.js          # 记忆检索（bigram 相似度）
├── image-recall.js    # 图文混合检索
├── dream.js           # 记忆整合（做梦机制）
├── routes.js          # API 路由
└── README.md
```

## 核心概念

### 碎片（Fragment）
知识的基本单位，支持图文混合存储。

```javascript
{
  id: 1,
  content: "登录按钮在页面右上角",
  tags: ["登录", "UI"],
  image_path: "/path/to/screenshot.png",
  images: [{ id: 1, description: "登录页面截图" }]
}
```

### 记忆检索
- **recall**: 文字检索，基于 bigram 相似度
- **recallWithImages**: 图文混合检索，带图片的碎片权重更高

### 做梦机制
定期整合碎片，提取规律，构建关系。

## API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/brain/fragments` | POST | 创建碎片 |
| `/api/brain/fragments/with-image` | POST | 创建带图片的碎片 |
| `/api/brain/fragments/:id/images` | POST | 为碎片添加图片 |
| `/api/brain/recall` | POST | 文字检索 |
| `/api/brain/recall-with-images` | POST | 图文混合检索 |
| `/api/brain/knowledge-graph` | GET | 图文知识图谱 |
| `/api/brain/dream` | POST | 触发记忆整合 |
