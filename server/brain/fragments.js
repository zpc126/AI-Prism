// input: 碎片数据
// output: 碎片 CRUD 操作
// position: 碎片管理模块

const { getDb } = require('./db');
const path = require('path');
const fs = require('fs');

// 图片存储目录
const IMAGES_DIR = path.join(__dirname, '../../data/images');

// 确保图片目录存在
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * 创建碎片
 */
function createFragment(content, tags = [], source = 'manual', imagePath = null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO fragments (content, tags, source, image_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  
  const result = stmt.run(content, JSON.stringify(tags), source, imagePath);
  return getFragmentById(result.lastInsertRowid);
}

function upsertFragmentBySourceRef(sourceRef, content, tags = [], source = 'test_case_history') {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM fragments WHERE source_ref = ?').get(sourceRef);
  if (existing) {
    db.prepare(`
      UPDATE fragments
      SET content = ?, tags = ?, source = ?, is_consolidated = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(content, JSON.stringify(tags), source, existing.id);
    return getFragmentById(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO fragments (content, tags, source, source_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(content, JSON.stringify(tags), source, sourceRef);
  return getFragmentById(result.lastInsertRowid);
}

function deleteFragmentsBySourceRefPrefix(prefix, keepRefs = []) {
  const db = getDb();
  const rows = db.prepare('SELECT id, source_ref FROM fragments WHERE source_ref LIKE ?').all(`${prefix}%`);
  const keep = new Set(keepRefs);
  const deleteStmt = db.prepare('DELETE FROM fragments WHERE id = ?');
  let deleted = 0;
  for (const row of rows) {
    if (!keep.has(row.source_ref)) {
      deleteStmt.run(row.id);
      deleted++;
    }
  }
  return deleted;
}

/**
 * 获取单个碎片
 */
function getFragmentById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM fragments WHERE id = ?').get(id);
  if (row) {
    row.tags = JSON.parse(row.tags || '[]');
  }
  return row;
}

/**
 * 获取所有碎片
 */
function getAllFragments(options = {}) {
  const db = getDb();
  const { limit = 100, offset = 0, source, minUsage = 0 } = options;
  
  let sql = 'SELECT * FROM fragments WHERE is_consolidated = 0';
  const params = [];
  
  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }
  
  if (minUsage > 0) {
    sql += ' AND usage_count >= ?';
    params.push(minUsage);
  }
  
  sql += ' ORDER BY usage_count DESC, created_at DESC';
  sql += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const rows = db.prepare(sql).all(...params);
  return rows.map(row => ({
    ...row,
    tags: JSON.parse(row.tags || '[]')
  }));
}

/**
 * 更新碎片
 */
function updateFragment(id, updates) {
  const db = getDb();
  const sets = [];
  const params = [];
  
  if (updates.content !== undefined) {
    sets.push('content = ?');
    params.push(updates.content);
  }
  if (updates.tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(updates.tags));
  }
  if (updates.importance !== undefined) {
    sets.push('importance = ?');
    params.push(updates.importance);
  }
  
  sets.push("updated_at = datetime('now')");
  params.push(id);
  
  db.prepare(`UPDATE fragments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getFragmentById(id);
}

/**
 * 删除碎片
 */
function deleteFragment(id) {
  const db = getDb();
  db.prepare('DELETE FROM fragments WHERE id = ?').run(id);
  return { success: true };
}

/**
 * 记录使用
 */
function recordUsage(id) {
  const db = getDb();
  db.prepare(`
    UPDATE fragments 
    SET usage_count = usage_count + 1, 
        last_used_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

/**
 * 获取标签统计
 */
function getTagStats() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tags FROM fragments WHERE is_consolidated = 0
  `).all();
  
  const tagCount = {};
  rows.forEach(row => {
    const tags = JSON.parse(row.tags || '[]');
    tags.forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  
  return Object.entries(tagCount)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 获取碎片统计
 */
function getStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM fragments').get().count;
  const active = db.prepare('SELECT COUNT(*) as count FROM fragments WHERE is_consolidated = 0').get().count;
  const consolidated = db.prepare('SELECT COUNT(*) as count FROM fragments WHERE is_consolidated = 1').get().count;
  const withImages = db.prepare('SELECT COUNT(*) as count FROM fragments WHERE image_path IS NOT NULL').get().count;
  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count FROM fragments GROUP BY source
  `).all();
  
  return { total, active, consolidated, withImages, bySource };
}

// ==================== 图片相关 ====================

/**
 * 为碎片添加图片
 */
function addFragmentImage(fragmentId, imageBase64, description = '', mimeType = 'image/png') {
  const db = getDb();
  
  // 保存图片到文件
  const imageId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const ext = mimeType.split('/')[1] || 'png';
  const filename = `${imageId}.${ext}`;
  const filepath = path.join(IMAGES_DIR, filename);
  
  // 从 base64 提取数据
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
  
  // 保存到数据库
  const result = db.prepare(`
    INSERT INTO fragment_images (fragment_id, image_path, image_base64, description, mime_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(fragmentId, filepath, imageBase64, description, mimeType);
  
  return {
    id: result.lastInsertRowid,
    fragmentId,
    path: filepath,
    description,
    mimeType
  };
}

/**
 * 获取碎片的所有图片
 */
function getFragmentImages(fragmentId) {
  const db = getDb();
  return db.prepare('SELECT * FROM fragment_images WHERE fragment_id = ? ORDER BY created_at').all(fragmentId);
}

/**
 * 删除碎片图片
 */
function deleteFragmentImage(imageId) {
  const db = getDb();
  
  // 获取图片信息
  const image = db.prepare('SELECT * FROM fragment_images WHERE id = ?').get(imageId);
  if (image) {
    // 删除文件
    if (fs.existsSync(image.image_path)) {
      fs.unlinkSync(image.image_path);
    }
    // 删除记录
    db.prepare('DELETE FROM fragment_images WHERE id = ?').run(imageId);
  }
  
  return { success: true };
}

/**
 * 创建带图片的碎片
 */
function createFragmentWithImage(content, tags = [], source = 'manual', imageBase64 = null, imageDescription = '') {
  const db = getDb();
  
  // 先创建碎片
  const fragment = createFragment(content, tags, source);
  
  // 如果有图片，添加图片
  if (imageBase64) {
    addFragmentImage(fragment.id, imageBase64, imageDescription);
  }
  
  return getFragmentById(fragment.id);
}

/**
 * 获取带图片的碎片详情
 */
function getFragmentWithImages(id) {
  const fragment = getFragmentById(id);
  if (fragment) {
    fragment.images = getFragmentImages(id);
  }
  return fragment;
}

module.exports = {
  createFragment,
  upsertFragmentBySourceRef,
  deleteFragmentsBySourceRefPrefix,
  getFragmentById,
  getAllFragments,
  updateFragment,
  deleteFragment,
  recordUsage,
  getTagStats,
  getStats,
  addFragmentImage,
  getFragmentImages,
  deleteFragmentImage,
  createFragmentWithImage,
  getFragmentWithImages,
  IMAGES_DIR
};
