// input: 已保存的测试会话与用例
// output: 与历史用例一一对应的知识库碎片
// position: 历史用例自动学习同步层

const {
  upsertFragmentBySourceRef,
  deleteFragmentsBySourceRefPrefix,
} = require('../brain/fragments');

function buildCaseContent(session, category, testCase) {
  const productName = session.mindMap?.title || session.title || '未命名产品';
  const steps = (testCase.steps || []).map((step, index) => `${index + 1}. ${step}`).join('\n');
  return [
    '【历史测试用例】',
    `产品：${productName}`,
    `模块：${category.name || category.type || testCase.category || '未分类'}`,
    `标题：${testCase.title || '未命名用例'}`,
    `优先级：${testCase.priority || 'P1'}`,
    testCase.reason ? `设计理由：${testCase.reason}` : '',
    testCase.source ? `需求来源：${testCase.source}` : '',
    steps ? `测试步骤：\n${steps}` : '',
    testCase.expected ? `预期结果：${testCase.expected}` : '',
  ].filter(Boolean).join('\n');
}

function syncSessionCasesToKnowledge(session) {
  if (!session?.id) return { learned: 0, deleted: 0 };
  const prefix = `session:${session.id}:case:`;
  const keepRefs = [];
  let learned = 0;

  (session.categories || []).forEach((category, categoryIndex) => {
    (category.cases || []).forEach((testCase, caseIndex) => {
      const caseKey = testCase.id || `${categoryIndex}-${caseIndex}`;
      const sourceRef = `${prefix}${encodeURIComponent(String(caseKey))}`;
      const tags = [...new Set([
        '历史用例',
        '测试用例',
        session.mindMap?.title || session.title,
        category.name || category.type || testCase.category,
        testCase.priority,
      ].filter(Boolean))];
      upsertFragmentBySourceRef(
        sourceRef,
        buildCaseContent(session, category, testCase),
        tags,
        'test_case_history'
      );
      keepRefs.push(sourceRef);
      learned++;
    });
  });

  const deleted = deleteFragmentsBySourceRefPrefix(prefix, keepRefs);
  return { learned, deleted };
}

function deleteSessionKnowledge(sessionId) {
  return deleteFragmentsBySourceRefPrefix(`session:${sessionId}:case:`);
}

module.exports = {
  syncSessionCasesToKnowledge,
  deleteSessionKnowledge,
};
