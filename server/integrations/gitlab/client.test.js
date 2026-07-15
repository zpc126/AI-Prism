// input: 本地模拟 GitLab API 与客户端 Issue/里程碑请求
// output: milestone_id 提交和活跃里程碑查询的契约验证结果
// position: GitLab REST 客户端的无外部依赖回归测试

const assert = require('assert');
const http = require('http');
const { createIssue, listProjectMilestones } = require('./client');

async function run() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify([{
          id: 42,
          iid: 7,
          title: 'V2.3',
          description: '当前版本',
          state: 'active',
          start_date: '2026-07-01',
          due_date: '2026-07-31',
          web_url: 'http://gitlab.test/milestones/7',
        }]));
        return;
      }
      res.end(JSON.stringify({ id: 100, iid: 9, title: body ? JSON.parse(body).title : '' }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    projectId: 'group/project',
    token: 'test-token',
  };

  try {
    const milestones = await listProjectMilestones(config);
    assert.deepStrictEqual(milestones.map(item => ({ id: item.id, title: item.title })), [{ id: 42, title: 'V2.3' }]);
    assert.match(requests[0].url, /milestones\?per_page=100&state=active$/);

    await createIssue(config, { title: '带版本', description: '描述', milestoneId: '42' });
    assert.strictEqual(requests[1].body.milestone_id, 42);

    await createIssue(config, { title: '无版本', description: '描述', milestoneId: '' });
    assert.strictEqual(Object.hasOwn(requests[2].body, 'milestone_id'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run()
  .then(() => console.log('GitLab client milestone tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
