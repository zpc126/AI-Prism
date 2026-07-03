// input: 执行过程中的发现
// output: Insights 存储和检索
// position: GEP 经验层 - 沉淀执行中的发现

/**
 * Insights 是 GEP 的进化机制
 * 每次执行中的发现会被提炼，作为后续执行的上下文
 * 
 * 类型：
 * - selector_change: 选择器变了
 * - wait_needed: 需要等待
 * - alternative_path: 发现替代路径
 * - page_behavior: 页面行为特征
 * - error_pattern: 错误模式
 */

const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, '../../data/brain.db'));
  }
  return db;
}

/**
 * 创建 Insight
 */
function createInsight(data) {
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO insights (gene_id, type, content, context, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    data.geneId || null,
    data.type,
    data.content,
    JSON.stringify(data.context || {}),
    data.confidence || 0.8
  );

  return result.lastInsertRowid;
}

/**
 * 获取 Gene 相关的 Insights
 */
function getInsightsByGene(geneId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM insights WHERE gene_id = ? ORDER BY confidence DESC, usage_count DESC
  `).all(geneId);

  return rows.map(row => ({
    ...row,
    context: JSON.parse(row.context || '{}'),
  }));
}

/**
 * 获取相关 Insights（基于类型和内容匹配）
 */
function getRelevantInsights(geneId, pageContext = {}) {
  const db = getDb();
  const insights = [];

  // 获取特定 Gene 的 Insights
  if (geneId) {
    insights.push(...getInsightsByGene(geneId));
  }

  // 获取通用 Insights（selector_change, wait_needed 等）
  const generalInsights = db.prepare(`
    SELECT * FROM insights 
    WHERE gene_id IS NULL 
    ORDER BY confidence DESC, usage_count DESC
  `).all();

  insights.push(...generalInsights.map(row => ({
    ...row,
    context: JSON.parse(row.context || '{}'),
  })));

  // 按页面上下文过滤和排序
  return insights
    .filter(insight => isInsightRelevant(insight, pageContext))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * 判断 Insight 是否与当前页面相关
 */
function isInsightRelevant(insight, pageContext) {
  if (!pageContext.url && !pageContext.title) return true;

  const context = insight.context || {};

  // URL 匹配
  if (context.url && pageContext.url) {
    if (new URL(context.url).hostname === new URL(pageContext.url).hostname) {
      return true;
    }
  }

  // 关键词匹配
  if (context.keywords && pageContext.title) {
    const keywords = context.keywords || [];
    return keywords.some(kw => pageContext.title.includes(kw));
  }

  return true;
}

/**
 * 记录 Insight 使用
 */
function recordInsightUsage(id) {
  const db = getDb();
  db.prepare(`
    UPDATE insights SET usage_count = usage_count + 1 WHERE id = ?
  `).run(id);
}

/**
 * 从执行日志提取 Insights
 */
function extractInsightsFromLog(stepsLog, geneId) {
  const insights = [];

  for (const step of stepsLog) {
    // 选择器变更
    if (step.error && step.error.includes('selector')) {
      insights.push({
        geneId,
        type: 'selector_change',
        content: `元素 "${step.target}" 的选择器可能已变更`,
        context: {
          originalSelector: step.selector,
          error: step.error,
          url: step.url,
        },
        confidence: 0.9,
      });
    }

    // 需要等待
    if (step.error && (step.error.includes('timeout') || step.error.includes('loading'))) {
      insights.push({
        geneId,
        type: 'wait_needed',
        content: `操作 "${step.description}" 后需要额外等待`,
        context: {
          waitTime: step.duration,
          error: step.error,
        },
        confidence: 0.85,
      });
    }

    // 成功的替代路径
    if (step.usedAlternative) {
      insights.push({
        geneId,
        type: 'alternative_path',
        content: `原始路径失败，使用了替代方式：${step.alternativeMethod}`,
        context: {
          originalMethod: step.method,
          alternativeMethod: step.alternativeMethod,
        },
        confidence: 0.95,
      });
    }
  }

  return insights;
}

/**
 * 删除 Insight
 */
function deleteInsight(id) {
  const db = getDb();
  db.prepare('DELETE FROM insights WHERE id = ?').run(id);
  return { success: true };
}

/**
 * 获取 Insights 统计
 */
function getInsightStats() {
  const db = getDb();
  const byType = db.prepare(`
    SELECT type, COUNT(*) as count FROM insights GROUP BY type
  `).all();

  const total = db.prepare('SELECT COUNT(*) as count FROM insights').get().count;

  return { total, byType };
}

module.exports = {
  createInsight,
  getInsightsByGene,
  getRelevantInsights,
  recordInsightUsage,
  extractInsightsFromLog,
  deleteInsight,
  getInsightStats,
};
