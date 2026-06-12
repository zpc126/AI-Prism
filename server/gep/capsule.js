// input: Gene ID, 执行路径, 环境指纹
// output: Capsule 对象（一次成功执行的完整记录）
// position: GEP 胶囊层 - 记录成功执行路径 + 环境指纹

/**
 * Capsule 是 GEP 的核心
 * 记录一次成功执行的完整路径和当时的环境状态
 * 
 * 环境匹配策略：
 * - 高度匹配 → 复用，直接按上次路径执行
 * - 部分变化 → 适配，参考路径但灵活调整
 * - 全新环境 → 探索，从头理解页面
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
 * 创建 Capsule
 */
function createCapsule(data) {
  const db = getDb();
  const id = data.id || `capsule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  db.prepare(`
    INSERT INTO capsules (id, gene_id, path, env_fingerprint, status, duration_ms, screenshot_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.geneId,
    JSON.stringify(data.path),
    JSON.stringify(data.envFingerprint),
    data.status || 'success',
    data.durationMs || 0,
    data.screenshotPath || null
  );

  return getCapsuleById(id);
}

/**
 * 获取 Capsule
 */
function getCapsuleById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM capsules WHERE id = ?').get(id);
  if (row) {
    row.path = JSON.parse(row.path || '[]');
    row.envFingerprint = JSON.parse(row.env_fingerprint || '{}');
  }
  return row;
}

/**
 * 获取 Gene 的所有 Capsule
 */
function getCapsulesByGene(geneId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM capsules WHERE gene_id = ? ORDER BY created_at DESC
  `).all(geneId);

  return rows.map(row => ({
    ...row,
    path: JSON.parse(row.path || '[]'),
    envFingerprint: JSON.parse(row.env_fingerprint || '{}'),
  }));
}

/**
 * 获取 Gene 最成功的 Capsule（最近一次成功的）
 */
function getBestCapsule(geneId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM capsules 
    WHERE gene_id = ? AND status = 'success'
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(geneId);

  if (row) {
    row.path = JSON.parse(row.path || '[]');
    row.envFingerprint = JSON.parse(row.env_fingerprint || '{}');
  }
  return row;
}

/**
 * 计算环境匹配度
 * 返回 0-1 之间的分数
 */
function calculateEnvMatch(capsuleFingerprint, currentFingerprint) {
  let score = 0;
  let total = 0;

  // URL 匹配（权重最高）
  if (capsuleFingerprint.url && currentFingerprint.url) {
    total += 3;
    if (capsuleFingerprint.url === currentFingerprint.url) {
      score += 3;
    } else if (new URL(capsuleFingerprint.url).hostname === new URL(currentFingerprint.url).hostname) {
      score += 1.5; // 同域名部分匹配
    }
  }

  // 页面标题匹配
  if (capsuleFingerprint.title && currentFingerprint.title) {
    total += 2;
    const similarity = calculateStringSimilarity(capsuleFingerprint.title, currentFingerprint.title);
    score += similarity * 2;
  }

  // 关键元素存在性
  if (capsuleFingerprint.keyElements && currentFingerprint.keyElements) {
    total += 3;
    const capsuleElements = new Set(capsuleFingerprint.keyElements);
    const currentElements = new Set(currentFingerprint.keyElements);
    const intersection = [...capsuleElements].filter(e => currentElements.has(e));
    score += (intersection.length / Math.max(capsuleElements.size, 1)) * 3;
  }

  // 页面结构相似度
  if (capsuleFingerprint.accessibilityTreeHash && currentFingerprint.accessibilityTreeHash) {
    total += 2;
    if (capsuleFingerprint.accessibilityTreeHash === currentFingerprint.accessibilityTreeHash) {
      score += 2;
    }
  }

  return total > 0 ? score / total : 0;
}

/**
 * 决定执行策略
 */
function decideStrategy(matchScore) {
  if (matchScore >= 0.8) {
    return 'reuse';      // 复用：直接按路径执行
  } else if (matchScore >= 0.4) {
    return 'adapt';      // 适配：参考路径，灵活调整
  } else {
    return 'explore';    // 探索：从头理解页面
  }
}

/**
 * 字符串相似度计算（简化版）
 */
function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1;

  // 简单的包含检查
  if (longer.includes(shorter)) return shorter.length / longer.length;

  return 0;
}

/**
 * 删除 Capsule
 */
function deleteCapsule(id) {
  const db = getDb();
  db.prepare('DELETE FROM capsules WHERE id = ?').run(id);
  return { success: true };
}

module.exports = {
  createCapsule,
  getCapsuleById,
  getCapsulesByGene,
  getBestCapsule,
  calculateEnvMatch,
  decideStrategy,
  deleteCapsule,
};
