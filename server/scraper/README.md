# server/scraper/

URL 内容抓取模块，支持飞书/Notion/通用网页。

## 文件

| 文件 | 地位 | 功能 |
|------|------|------|
| url-scraper.js | 核心 | URL 内容抓取，飞书用 playwright 渲染，通用网页用 cheerio |

## 支持的平台

| 平台 | 抓取方式 |
|------|----------|
| 飞书 | playwright（需要 JS 渲染） |
| Notion | cheerio |
| 通用网页 | cheerio |
