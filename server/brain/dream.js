// input: 无
// output: 记忆整合（做梦）机制
// position: 后台记忆整合模块

const { getDb } = require('./db');
const { getBigrams, extractKeywords } = require('./recall');

/**
 * 执行一轮做梦
 */
async function dream(llmCall) {
  const db = getDb();
  const results = {
    forgotten: 0,
    clustered: 0,
    consolidated: 0
  };
  
  try {
    // 1. 软遗忘：降低长期未使用碎片的权重
    results.forgotten = softForget();
    
    // 2. 聚类：根据标签共现关系聚类
    const clusters = clusterFragments();
    results.clustered = clusters.length;
    
    // 3. 整合：用 LLM 合并同簇碎片
    if (llmCall && clusters.length > 0) {
      results.consolidated = await consolidateClusters(clusters, llmCall);
    }
    
    // 记录做梦日志
    db.prepare(`
      INSERT INTO dream_logs (action, result, created_at)
      VALUES (?, ?, datetime('now'))
    `).run('dream', JSON.stringify(results));
    
  } catch (error) {
    console.error('Dream error:', error);
    db.prepare(`
      INSERT INTO dream_logs (action, result, created_at)
      VALUES (?, ?, datetime('now'))
    `).run('error', JSON.stringify({ error: error.message }));
  }
  
  return results;
}

/**
 * 软遗忘：降低长期未使用碎片的权重
 */
function softForget() {
  const db = getDb();
  
  // 30天未使用的碎片
  const result = db.prepare(`
    UPDATE fragments 
    SET importance = MAX(0.3, importance * 0.8),
        updated_at = datetime('now')
    WHERE is_consolidated = 0
    AND (last_used_at IS NULL OR last_used_at < datetime('now', '-30 days'))
    AND usage_count < 3
  `).run();
  
  return result.changes;
}

/**
 * 聚类：根据标签共现关系聚类
 */
function clusterFragments() {
  const db = getDb();
  
  // 获取所有活跃碎片
  const fragments = db.prepare(`
    SELECT * FROM fragments WHERE is_consolidated = 0
  `).all().map(f => ({
    ...f,
    tags: JSON.parse(f.tags || '[]')
  }));
  
  if (fragments.length < 2) return [];
  
  // 构建标签共现图
  const tagCooccurrence = new Map();
  
  fragments.forEach(f => {
    f.tags.forEach(tag => {
      if (!tagCooccurrence.has(tag)) {
        tagCooccurrence.set(tag, new Set());
      }
      f.tags.forEach(otherTag => {
        if (tag !== otherTag) {
          tagCooccurrence.get(tag).add(otherTag);
        }
      });
    });
  });
  
  // 简单聚类：找相似度高的碎片对
  const clusters = [];
  const used = new Set();
  
  for (let i = 0; i < fragments.length; i++) {
    if (used.has(fragments[i].id)) continue;
    
    const cluster = [fragments[i]];
    used.add(fragments[i].id);
    
    const iBigrams = getBigrams(fragments[i].content);
    const iKeywords = extractKeywords(fragments[i].content);
    
    for (let j = i + 1; j < fragments.length; j++) {
      if (used.has(fragments[j].id)) continue;
      
      const jBigrams = getBigrams(fragments[j].content);
      const jKeywords = extractKeywords(fragments[j].content);
      
      // 计算相似度
      const bigramSim = jaccardSimilarity(iBigrams, jBigrams);
      const keywordSim = jaccardSimilarity(iKeywords, jKeywords);
      const tagSim = calculateTagSimilarity(fragments[i].tags, fragments[j].tags);
      
      const totalSim = bigramSim * 0.4 + keywordSim * 0.3 + tagSim * 0.3;
      
      if (totalSim > 0.3) {
        cluster.push(fragments[j]);
        used.add(fragments[j].id);
      }
    }
    
    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

/**
 * 计算标签相似度
 */
function calculateTagSimilarity(tags1, tags2) {
  const set1 = new Set(tags1);
  const set2 = new Set(tags2);
  const intersection = [...set1].filter(t => set2.has(t));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

/**
 * Jaccard 相似度
 */
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * 整合聚类
 */
async function consolidateClusters(clusters, llmCall) {
  const db = getDb();
  let consolidated = 0;
  
  for (const cluster of clusters) {
    try {
      // 构建整合提示
      const fragmentTexts = cluster.map((f, i) => `${i + 1}. ${f.content}`).join('\n');
      
      const prompt = `请将以下碎片整合为一条更完整的认知：

${fragmentTexts}

要求：
1. 保留所有重要信息
2. 合并重复内容
3. 用简洁自然的语言表达
4. 输出一条完整的认知`;

      // 调用 LLM
      const consolidatedContent = await llmCall(prompt);
      
      if (consolidatedContent) {
        // 合并标签
        const allTags = new Set();
        cluster.forEach(f => f.tags.forEach(t => allTags.add(t)));
        
        // 创建整合后的碎片
        db.prepare(`
          INSERT INTO fragments (content, tags, source, usage_count, importance, created_at, updated_at)
          VALUES (?, ?, 'dream', ?, 1.2, datetime('now'), datetime('now'))
        `).run(
          consolidatedContent,
          JSON.stringify([...allTags]),
          Math.max(...cluster.map(f => f.usage_count))
        );
        
        // 标记原碎片为已整合
        const newId = db.prepare('SELECT last_insert_rowid()').get()['last_insert_rowid()'];
        
        cluster.forEach(f => {
          db.prepare(`
            UPDATE fragments 
            SET is_consolidated = 1, 
                consolidated_into = ?,
                updated_at = datetime('now')
            WHERE id = ?
          `).run(newId, f.id);
        });
        
        consolidated++;
      }
    } catch (error) {
      console.error('Consolidate error:', error);
    }
  }
  
  return consolidated;
}

/**
 * 获取做梦日志
 */
function getDreamLogs(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM dream_logs ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  dream,
  getDreamLogs
};
