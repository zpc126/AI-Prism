// input: 评估集用例
// output: 执行日志（通过 ws 推送）
// position: server/evaluation/runner.js

const { _electron: electron } = require('playwright');
const path = require('path');
const ws = require('./ws');
const storage = require('./storage');
const { app } = require('electron');

let running = false;

// 获取 Electron 可执行文件路径
function getElectronPath() {
  return path.join(__dirname, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
}

function getAppPath() {
  return path.join(__dirname, '../..');
}

// 生成截图保存路径
function getScreenshotDir(runId) {
  const dir = path.join(app.getPath('userData'), 'eval-screenshots', runId);
  const fs = require('fs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 运行单个评估用例
 */
async function runCase(electronApp, caseItem, runId, screenshotDir, index, total) {
  const window = await electronApp.firstWindow();
  ws.log(runId, 'info', `[${index + 1}/${total}] ${caseItem.name}`);

  // 1. 回到首页
  await window.evaluate(() => {
    const backBtn = document.querySelector('#btn-back');
    if (backBtn) backBtn.click();
  });
  await sleep(1000);

  // 2. 输入需求
  ws.log(runId, 'info', `输入需求: ${caseItem.input.substring(0, 50)}...`);
  await window.fill('#requirement-input', caseItem.input);
  await window.screenshot({ path: path.join(screenshotDir, `${index + 1}-input.png`) });
  await sleep(500);

  // 3. 点击开始
  ws.log(runId, 'info', '点击「开始」');
  await window.click('#btn-start');
  await sleep(2000);

  // 4. 监控生成过程
  const startTime = Date.now();
  let lastLog = '';
  let caseCount = 0;
  const timeout = 120000; // 2 分钟

  while (Date.now() - startTime < timeout) {
    const state = await window.evaluate(() => {
      const thinking = document.querySelector('.thinking-step.active');
      const cases = document.querySelectorAll('.node-leaf');
      const danmaku = document.querySelector('#danmaku');
      const canvas = document.querySelector('#canvas-container');
      
      return {
        thinkingText: thinking?.textContent || '',
        caseCount: cases.length,
        danmakuText: danmaku?.textContent || '',
        canvasVisible: canvas?.offsetParent !== null
      };
    });

    // 日志去重
    if (state.thinkingText && state.thinkingText !== lastLog) {
      ws.log(runId, 'step', `思考中: ${state.thinkingText}`);
      lastLog = state.thinkingText;
    }

    if (state.danmakuText) {
      ws.log(runId, 'info', `弹幕: ${state.danmakuText}`);
    }

    if (state.caseCount > caseCount) {
      ws.log(runId, 'success', `生成 ${state.caseCount} 条用例`);
      caseCount = state.caseCount;
      await window.screenshot({ path: path.join(screenshotDir, `${index + 1}-progress.png`) });
    }

    // 检查是否完成（画布可见且不再有新用例）
    if (state.canvasVisible && state.caseCount > 0) {
      const stableStart = Date.now();
      while (Date.now() - stableStart < 5000) {
        const newCount = await window.evaluate(() => document.querySelectorAll('.node-leaf').length);
        if (newCount !== state.caseCount) break;
        await sleep(1000);
      }
      if (Date.now() - stableStart >= 5000) break; // 5 秒没变化，认为完成
    }

    await sleep(1000);
  }

  // 5. 收集结果
  await window.screenshot({ path: path.join(screenshotDir, `${index + 1}-result.png`) });
  
  const result = await window.evaluate(() => {
    const nodes = document.querySelectorAll('.node-leaf');
    const cases = [];
    nodes.forEach(n => {
      const priority = n.querySelector('.priority-badge')?.textContent || '';
      const title = n.textContent?.replace(priority, '').trim() || '';
      cases.push({ title, priority });
    });
    return { caseCount: cases.length, cases };
  });

  ws.log(runId, 'success', `完成: ${result.caseCount} 条用例，耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  return {
    ...result,
    duration: Date.now() - startTime
  };
}

/**
 * 运行完整评估
 */
async function runEvaluation(runId, datasetId) {
  if (running) {
    throw new Error('已有评估在运行中');
  }

  running = true;
  const startTime = Date.now();

  try {
    // 加载评估集
    const dataset = storage.getDataset(datasetId);
    if (!dataset) throw new Error('评估集不存在');

    const cases = JSON.parse(dataset.cases);
    ws.log(runId, 'info', `开始评估: ${dataset.name}，共 ${cases.length} 个用例`);

    // 更新状态
    storage.updateRun(runId, { status: 'running' });

    // 截图目录
    const screenshotDir = getScreenshotDir(runId);
    ws.log(runId, 'info', `截图目录: ${screenshotDir}`);

    // 启动 Prism
    ws.log(runId, 'info', '启动 Prism...');
    const electronApp = await electron.launch({
      executablePath: getElectronPath(),
      args: [getAppPath()],
      timeout: 30000
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    ws.log(runId, 'success', 'Prism 已启动');
    await sleep(2000);

    // 逐个运行用例
    const results = [];
    for (let i = 0; i < cases.length; i++) {
      ws.progress(runId, i + 1, cases.length, cases[i].name);
      const result = await runCase(electronApp, cases[i], runId, screenshotDir, i, cases.length);
      results.push({
        id: cases[i].id,
        name: cases[i].name,
        input: cases[i].input,
        expect: cases[i].expect,
        actual: result
      });
    }

    // 关闭 Prism
    await electronApp.close();
    ws.log(runId, 'info', 'Prism 已关闭');

    // 计算指标
    const metrics = results.map(r => {
      const expect = r.expect || {};
      const actual = r.actual || {};
      
      const caseCountOk = actual.caseCount >= (expect.minCases || 5);
      const keywordHits = (expect.keywords || []).filter(kw => 
        (actual.cases || []).some(c => c.title.includes(kw))
      );
      const keywordRate = expect.keywords ? keywordHits.length / expect.keywords.length : 1;
      const categoryHits = (expect.categories || []).filter(cat => 
        (actual.categories || []).some(c => c.includes(cat))
      );
      const categoryRate = expect.categories ? categoryHits.length / expect.categories.length : 1;

      const score = (
        (caseCountOk ? 0.3 : 0.1) +
        keywordRate * 0.35 +
        categoryRate * 0.35
      );

      return {
        caseCount: actual.caseCount,
        caseCountOk,
        keywordRate: Math.round(keywordRate * 100),
        categoryRate: Math.round(categoryRate * 100),
        score: Math.round(score * 100)
      };
    });

    const avgScore = metrics.reduce((s, m) => s + m.score, 0) / metrics.length;
    const duration = Date.now() - startTime;

    const report = {
      datasetName: dataset.name,
      totalCases: cases.length,
      avgScore: Math.round(avgScore),
      duration,
      results: results.map((r, i) => ({
        name: r.name,
        ...metrics[i]
      }))
    };

    // 保存结果
    storage.updateRun(runId, {
      status: 'done',
      duration_ms: duration,
      results,
      report
    });

    ws.done(runId, report);
    ws.log(runId, 'success', `评估完成，总分: ${report.avgScore}，耗时: ${(duration / 1000).toFixed(1)}s`);

    return report;
  } catch (err) {
    storage.updateRun(runId, { status: 'error' });
    ws.error(runId, err);
    ws.log(runId, 'error', `评估失败: ${err.message}`);
    throw err;
  } finally {
    running = false;
  }
}

function isRunning() {
  return running;
}

module.exports = { runEvaluation, isRunning };
