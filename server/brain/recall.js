// input: 查询文本
// output: 相关碎片列表
// position: 记忆检索模块（bigram 相似度）

const { getDb } = require('./db');
const { recordUsage } = require('./fragments');

/**
 * 生成中文 bigram
 */
function getBigrams(text) {
  const bigrams = new Set();
  const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  
  for (let i = 0; i < clean.length - 1; i++) {
    bigrams.add(clean.substring(i, i + 2));
  }
  
  // 也添加单词级别的 bigram
  const words = text.split(/[\s,，。、；：！？\-\(\)\[\]]+/);
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] && words[i + 1]) {
      bigrams.add(`${words[i]}_${words[i + 1]}`);
    }
  }
  
  return bigrams;
}

/**
 * 计算 Jaccard 相似度
 */
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * 提取关键词
 */
function extractKeywords(text) {
  const keywords = new Set();
  
  // 提取中文词汇（2-4字）
  const chineseWords = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  chineseWords.forEach(w => keywords.add(w));
  
  // 提取英文单词
  const englishWords = text.match(/[a-zA-Z]{2,}/g) || [];
  englishWords.forEach(w => keywords.add(w.toLowerCase()));
  
  // 提取 URL
  const urls = text.match(/https?:\/\/[^\s]+/g) || [];
  urls.forEach(u => keywords.add(u));
  
  // 提取账号相关信息
  const accounts = text.match(/(账号|密码|登录|管理员|权限|SSO)/gi) || [];
  accounts.forEach(a => keywords.add(a.toLowerCase()));
  
  return keywords;
}

/**
 * 检索相关碎片
 */
function recall(query, options = {}) {
  const db = getDb();
  const { limit = Number.MAX_SAFE_INTEGER, threshold = 0.1, includeConsolidated = false, source } = options;
  
  // 获取所有活跃碎片
  let sql = 'SELECT * FROM fragments';
  const conditions = [];
  const params = [];
  if (!includeConsolidated) conditions.push('is_consolidated = 0');
  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  
  const fragments = db.prepare(sql).all(...params);
  
  if (fragments.length === 0) return [];
  
  const queryBigrams = getBigrams(query);
  const queryKeywords = extractKeywords(query);
  
  // 计算每个碎片的相关度
  const scored = fragments.map(fragment => {
    const contentBigrams = getBigrams(fragment.content);
    const contentKeywords = extractKeywords(fragment.content);
    const fragmentTags = new Set(JSON.parse(fragment.tags || '[]'));
    
    // 1. Bigram 相似度（基础）
    const bigramScore = jaccardSimilarity(queryBigrams, contentBigrams);
    
    // 2. 关键词匹配
    const keywordIntersection = [...queryKeywords].filter(k => contentKeywords.has(k));
    const keywordScore = keywordIntersection.length / Math.max(queryKeywords.size, 1);
    
    // 3. 标签匹配
    const tagIntersection = [...queryKeywords].filter(k => fragmentTags.has(k));
    const tagScore = tagIntersection.length / Math.max(fragmentTags.size, 1);
    
    // 4. URL/账号加权（这些是可执行的）
    const hasUrl = /https?:\/\//.test(fragment.content);
    const hasAccount = /(账号|密码|登录|管理员)/i.test(fragment.content);
    const actionBonus = (hasUrl || hasAccount) ? 0.2 : 0;
    
    // 5. 使用次数权重（温和，有上限）
    const usageWeight = Math.min(0.3, fragment.usage_count * 0.05);
    
    // 综合得分
    const totalScore = (
      bigramScore * 0.4 +
      keywordScore * 0.3 +
      tagScore * 0.2 +
      actionBonus +
      usageWeight
    ) * (fragment.importance || 1.0);
    
    return {
      ...fragment,
      tags: JSON.parse(fragment.tags || '[]'),
      score: totalScore,
      matchedKeywords: keywordIntersection
    };
  });
  
  // 过滤和排序
  const sorted = scored
    .filter(f => f.score >= threshold)
    .sort((a, b) => b.score - a.score);
  return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
}

/**
 * 标签关联扩展检索
 */
function recallWithAssociations(query, options = {}) {
  const { limit = Number.MAX_SAFE_INTEGER, source } = options;
  
  // 第一轮：直接检索
  let results = recall(query, { limit, source });
  
  // 如果结果不够，进行标签扩展
  if (results.length < limit) {
    // 从已有结果中提取标签
    const existingIds = new Set(results.map(r => r.id));
    const allTags = new Set();
    
    results.forEach(r => {
      r.tags.forEach(t => allTags.add(t));
      r.matchedKeywords.forEach(k => allTags.add(k));
    });
    
    // 用标签做第二轮检索
    if (allTags.size > 0) {
      const tagQuery = [...allTags].join(' ');
      const moreResults = recall(tagQuery, { limit: limit * 2, source });
      
      moreResults.forEach(r => {
        if (!existingIds.has(r.id)) {
          // 降低关联结果的分数
          r.score *= 0.7;
          r.isAssociated = true;
          results.push(r);
          existingIds.add(r.id);
        }
      });
    }
  }
  
  // 重新排序并截断
  const sorted = results.sort((a, b) => b.score - a.score);
  return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
}

/**
 * 记录检索使用
 */
function recordRecallUsage(fragmentIds) {
  fragmentIds.forEach(id => recordUsage(id));
}

module.exports = {
  recall,
  recallWithAssociations,
  recordRecallUsage,
  getBigrams,
  extractKeywords
};
