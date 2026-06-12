# GEP（Gene-Evolution Protocol）

> 从"步骤复读机"到"有经验的测试搭档"

## 核心思想

GEP 是一种测试执行协议，解决了传统自动化测试最大的痛点——**脆弱性**。

传统脚本写死了"点击 id=submit-btn 的按钮"，前端一改 id 就挂。GEP 的 AI 理解的是**意图**，不是死步骤。页面改版了，它会重新探索一条路径，成功后存成新的 Capsule，旧的自然淘汰。

## 三层结构

### Gene（基因）

把用例提炼成"测试意图 + 验收条件"。

```
❌ 传统：第一步点登录按钮，第二步输入用户名，第三步...
✅ Gene：验证正确账号密码能成功登录，验收条件是跳转到首页且显示用户昵称
```

- **意图是稳定的**：不管页面怎么改，"验证登录"这个意图不变
- **步骤是易变的**：今天点按钮，明天可能要滑动验证

### Capsule（胶囊）

记录一次成功执行的完整路径：

```json
{
  "path": [
    {"action": "click", "target": "登录按钮", "description": "点击登录"},
    {"action": "fill", "target": "邮箱输入框", "value": "test@example.com"}
  ],
  "envFingerprint": {
    "url": "https://example.com/login",
    "title": "登录页面",
    "keyElements": [...],
    "accessibilityTreeHash": "abc123"
  }
}
```

**环境匹配策略**：

| 匹配度 | 策略 | 说明 |
|--------|------|------|
| ≥ 80% | 复用（reuse） | 直接按上次路径执行 |
| 40-80% | 适配（adapt） | 参考路径，灵活调整 |
| < 40% | 探索（explore） | 从头理解页面 |

### Learned Insights（经验沉淀）

每次执行中的发现会被提炼：

- `selector_change`：某个按钮的选择器变了
- `wait_needed`：某个操作需要等待 loading
- `alternative_path`：发现替代路径
- `page_behavior`：页面行为特征

这些经验会在后续执行中作为上下文注入给 AI。

## 双通道方案

GEP 使用双通道理解页面：

```
┌─────────────────────────────────────────────────────────┐
│                      页面理解                            │
├─────────────────────────┬───────────────────────────────┤
│   Accessibility Tree    │          截图验证              │
│   (结构化理解)           │        (视觉确认)             │
├─────────────────────────┼───────────────────────────────┤
│ • 按钮、链接、输入框     │ • 操作后的页面变化             │
│ • 层级关系               │ • 验证结果是否正确             │
│ • 属性值                 │ • 像人一样用眼睛确认           │
├─────────────────────────┼───────────────────────────────┤
│   → 知道点哪             │    → 确认点对了               │
└─────────────────────────┴───────────────────────────────┘
```

## 执行流程

```
输入 Gene
    │
    ▼
获取环境指纹
    │
    ▼
查找最佳 Capsule ──────────────────────────────┐
    │                                           │
    ▼                                           │
计算匹配度                                       │
    │                                           │
    ├─── 高匹配 ──→ 复用策略 ──→ 直接执行        │
    │                                           │
    ├─── 中匹配 ──→ 适配策略 ──→ LLM 生成新步骤  │
    │                                           │
    └─── 低匹配 ──→ 探索策略 ──→ LLM 理解页面    │
                                               │
    ▼                                          │
执行步骤（双通道）                               │
    │                                          │
    ├─ Accessibility Tree 定位元素              │
    ├─ 截图验证操作结果                          │
    │                                          │
    ▼                                          │
验证验收条件                                    │
    │                                          │
    ├─── 通过 ──→ 保存 Capsule ──→ 提取 Insights│
    │                                          │
    └─── 失败 ──→ 尝试恢复 ────────────────────┘
```

## API 接口

### Gene 管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/gep/genes` | POST | 创建 Gene |
| `/api/gep/genes/extract` | POST | 从测试用例批量提取 |
| `/api/gep/genes` | GET | 获取所有 Gene |
| `/api/gep/genes/:id` | GET | 获取单个 Gene |
| `/api/gep/genes/:id` | PUT | 更新 Gene |
| `/api/gep/genes/:id` | DELETE | 删除 Gene |

### Capsule 查询

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/gep/genes/:id/capsules` | GET | 获取 Gene 的所有 Capsule |
| `/api/gep/genes/:id/best-capsule` | GET | 获取最佳 Capsule |

### 执行

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/gep/execute/:geneId` | POST | 执行单个 Gene（SSE） |
| `/api/gep/execute-batch` | POST | 批量执行（SSE） |
| `/api/gep/execute-cases` | POST | 从测试用例一键执行（SSE） |

## 使用示例

### 1. 从测试用例创建 Gene

```javascript
POST /api/gep/genes/extract
{
  "cases": [
    {
      "id": "case_1",
      "title": "验证正确账号密码能成功登录",
      "category": "用户体系",
      "priority": "P0",
      "steps": ["打开登录页", "输入账号密码", "点击登录"],
      "expected": "跳转到首页，显示用户昵称"
    }
  ]
}
```

### 2. 执行 Gene

```javascript
POST /api/gep/execute/gene_xxx
{
  "targetUrl": "https://example.com/login"
}
```

### 3. 一键从用例执行

```javascript
POST /api/gep/execute-cases
{
  "cases": [...],
  "options": {
    "stopOnFailure": false
  }
}
```

## 为什么 GEP 更稳定？

| 传统自动化 | GEP |
|-----------|-----|
| 写死选择器 | 理解意图 |
| 页面改就挂 | 自动适配 |
| 维护成本高 | 经验复用 |
| 每次从零开始 | 越跑越快 |

**第一次跑是探索，第二次跑是复用，跑得越多越快越稳。**
