// input: 查询文本或图片
// output: 相关的图文碎片
// position: 图文联想模块，实现"概念 → 具象照片"的检索

const { getDb } = require('./db');
const { getBigrams, extractKeywords } = require('./recall');

/**
 * 图文混合检索
 * 输入文字，返回相关的碎片（包含图片）
 */
async function recallWithImages(query, options = {}) {
  const db = getDb();
  const { limit = 10, includeImages = true } = options;

  // 获取所有活跃碎片
  let sql = 'SELECT * FROM fragments WHERE is_consolidated = 0';
  const fragments = db.prepare(sql).all();

  if (fragments.length === 0) return [];

  const queryBigrams = getBigrams(query);
  const queryKeywords = extractKeywords(query);

  // 计算每个碎片的相关度
  const scored = fragments.map(fragment => {
    const contentBigrams = getBigrams(fragment.content);
    const contentKeywords = extractKeywords(fragment.content);
    const fragmentTags = new Set(JSON.parse(fragment.tags || '[]'));

    // 1. Bigram 相似度
    const bigramScore = jaccardSimilarity(queryBigrams, contentBigrams);

    // 2. 关键词匹配
    const keywordIntersection = [...queryKeywords].filter(k => contentKeywords.has(k));
    const keywordScore = keywordIntersection.length / Math.max(queryKeywords.size, 1);

    // 3. 标签匹配
    const tagIntersection = [...queryKeywords].filter(k => fragmentTags.has(k));
    const tagScore = tagIntersection.length / Math.max(fragmentTags.size, 1);

    // 4. 有图片的碎片加权
    const hasImage = fragment.image_path ? 0.15 : 0;

    // 综合得分
    const totalScore = (
      bigramScore * 0.35 +
      keywordScore * 0.3 +
      tagScore * 0.2 +
      hasImage
    ) * (fragment.importance || 1.0);

    return {
      ...fragment,
      tags: JSON.parse(fragment.tags || '[]'),
      score: totalScore,
      matchedKeywords: keywordIntersection
    };
  });

  // 过滤和排序
  let results = scored
    .filter(f => f.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // 如果需要包含图片，获取图片信息
  if (includeImages) {
    for (const result of results) {
      if (result.image_path) {
        result.images = db.prepare('SELECT * FROM fragment_images WHERE fragment_id = ?').all(result.id);
      }
    }
  }

  return results;
}

/**
 * 图片关联检索
 * 输入图片描述，返回相关的文字碎片和图片碎片
 */
async function findRelatedFragments(imageDescription, options = {}) {
  const db = getDb();
  const { limit = 5 } = options;

  // 从图片描述中提取关键词
  const keywords = extractKeywords(imageDescription);

  // 搜索相关碎片
  const query = [...keywords].join(' ');
  return await recallWithImages(query, { limit });
}

/**
 * 获取图文知识图谱数据
 * 用于前端可视化展示
 */
async function getImageKnowledgeGraph(options = {}) {
  const db = getDb();
  const { limit = 50 } = options;

  // 获取所有带图片的碎片
  const fragmentsWithImages = db.prepare(`
    SELECT f.*, 
      (SELECT COUNT(*) FROM fragment_images WHERE fragment_id = f.id) as image_count
    FROM fragments f 
    WHERE f.is_consolidated = 0 
    AND (f.image_path IS NOT NULL OR EXISTS (
      SELECT 1 FROM fragment_images WHERE fragment_id = f.id
    ))
    ORDER BY f.usage_count DESC
    LIMIT ?
  `).all(limit);

  // 构建图谱数据
  const nodes = [];
  const edges = [];

  for (const fragment of fragmentsWithImages) {
    // 添加碎片节点
    nodes.push({
      id: `fragment_${fragment.id}`,
      type: 'fragment',
      label: fragment.content.substring(0, 50) + (fragment.content.length > 50 ? '...' : ''),
      content: fragment.content,
      tags: JSON.parse(fragment.tags || '[]'),
      hasImage: !!fragment.image_path || fragment.image_count > 0,
      imageCount: fragment.image_count || (fragment.image_path ? 1 : 0)
    });

    // 获取图片
    const images = db.prepare('SELECT * FROM fragment_images WHERE fragment_id = ?').all(fragment.id);
    for (const image of images) {
      nodes.push({
        id: `image_${image.id}`,
        type: 'image',
        label: image.description || '图片',
        fragmentId: fragment.id,
        path: image.image_path
      });

      edges.push({
        source: `fragment_${fragment.id}`,
        target: `image_${image.id}`,
        type: 'has_image'
      });
    }
  }

  // 基于标签建立关联
  const tagMap = {};
  for (const node of nodes.filter(n => n.type === 'fragment')) {
    for (const tag of node.tags || []) {
      if (!tagMap[tag]) tagMap[tag] = [];
      tagMap[tag].push(node.id);
    }
  }

  // 同标签的碎片建立边
  for (const [tag, fragmentIds] of Object.entries(tagMap)) {
    for (let i = 0; i < fragmentIds.length; i++) {
      for (let j = i + 1; j < fragmentIds.length; j++) {
        edges.push({
          source: fragmentIds[i],
          target: fragmentIds[j],
          type: 'same_tag',
          label: tag
        });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Jaccard 相似度
 */
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

module.exports = {
  recallWithImages,
  findRelatedFragments,
  getImageKnowledgeGraph,
};
