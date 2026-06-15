// input: 测试用例列表，报告配置
// output: 批量执行结果、截图和原始用例详情
// position: 批量执行器，支持截图、报告生成和用例上下文保存

const { EnhancedRunner } = require('./enhanced-runner');
const { PIEngineRunner } = require('./pi-engine-runner');
const {
  createReport,
  updateReport,
  addTestResult,
  updateTestResult,
  addTestStep,
  updateTestStep,
  getReportDir,
} = require('../reports/report-store');

class BatchExecutor {
  constructor() {
    this.runner = null;
    this.reportId = null;
    this.reportDir = null;
    this.stopped = false;
  }

  // 停止执行
  async stop() {
    console.log('[BatchExecutor] 正在停止执行...');
    this.stopped = true;
    if (this.runner && typeof this.runner.stop === 'function') {
      await this.runner.stop();
    }
    console.log('[BatchExecutor] 已停止');
  }

  /**
   * 批量执行测试用例
   * @param {Array} cases - 测试用例列表
   * @param {Object} options - 配置选项
   * @param {Function} onLog - 日志回调
   * @returns {Object} 执行报告
   */
  async execute(cases, options = {}, onLog = () => {}) {
    const {
      title = `测试报告 ${new Date().toLocaleString('zh-CN')}`,
      requirement = '',
      stopOnFailure = false,
    } = options;

    // 创建报告
    const report = createReport({
      title,
      requirement,
      totalCases: cases.length,
    });

    this.reportId = report.id;
    this.reportDir = getReportDir(report.id);

    onLog({ type: 'system', text: `报告 ID: ${report.id}` });
    onLog({ type: 'system', text: `共 ${cases.length} 条用例待执行` });
    onLog({ type: 'divider', text: '' });

    // 初始化执行器（默认使用 PI Engine 智能模式）
    const hasMobileCase = cases.some(testCase => {
      const steps = (testCase.steps || []).join('\n');
      return /\[(手机|移动端|小程序|H5|App)\]|手机端|移动端|小程序|Android|安卓|\bApp\b|\bH5\b/i.test(steps);
    });
    const usePIEngine = hasMobileCase || options.usePIEngine !== false;
    if (hasMobileCase && options.usePIEngine === false) {
      onLog({
        type: 'system',
        text: '检测到 Android 手机步骤，已自动切换为支持 ADB 的 Prism Engine 智能模式',
      });
    }
    
    if (usePIEngine) {
      this.runner = new PIEngineRunner({
        reportId: report.id,
        reportDir: this.reportDir,
        preferredScriptId: options.preferredScriptId,
        scriptOnly: options.scriptOnly,
      });
      onLog({
        type: 'system',
        text: options.scriptOnly ? '使用脚本库直接回放模式' : '使用 Prism Engine 智能模式',
      });
    } else {
      this.runner = new EnhancedRunner({
        reportId: report.id,
        reportDir: this.reportDir,
      });
      onLog({ type: 'system', text: '使用快速模式' });
    }

    let passedCount = 0;
    let failedCount = 0;
    let wasStopped = false;
    const startTime = Date.now();

    try {
      // 启动浏览器
      await this.runner.launch(onLog);
      onLog({ type: 'divider', text: '' });

      // 逐个执行用例
      for (let i = 0; i < cases.length; i++) {
        // 检查是否被停止
        if (this.stopped) {
          onLog({ type: 'system', text: '用户已停止执行' });
          break;
        }
        
        const testCase = cases[i];

        onLog({ type: 'system', text: `--- 用例 ${i + 1}/${cases.length} ---` });

        // 创建测试结果记录
        const resultId = addTestResult({
          reportId: report.id,
          caseId: testCase.id,
          caseTitle: testCase.title,
          category: testCase.category,
          priority: testCase.priority,
          caseDetail: testCase,
        });

        try {
          // 执行用例
          const result = await this.runner.executeTestCase(testCase, onLog);

          // 更新测试结果
          updateTestResult(resultId, {
            status: result.status,
            error_message: result.errorMessage,
            duration_ms: result.durationMs,
            finished_at: new Date().toISOString(),
          });

          // 保存步骤
          for (const step of result.steps) {
            addTestStep({
              resultId,
              stepIndex: step.stepIndex,
              description: step.description,
              action: step.action,
              status: step.status,
              screenshotPath: step.screenshotPath,
              errorMessage: step.errorMessage,
              durationMs: step.durationMs,
            });
          }

          if (result.status === 'passed') {
            passedCount++;
            onLog({ type: 'success', text: `✓ ${testCase.title} 通过` });
          } else if (result.status === 'stopped') {
            wasStopped = true;
            onLog({ type: 'system', text: '用户已停止执行，后续脚本不再运行' });
            break;
          } else {
            failedCount++;
            onLog({ type: 'error', text: `✗ ${testCase.title} 失败: ${result.errorMessage}` });

            if (stopOnFailure) {
              onLog({ type: 'system', text: '配置了失败停止，终止执行' });
              break;
            }
          }
        } catch (error) {
          failedCount++;
          updateTestResult(resultId, {
            status: 'failed',
            error_message: error.message,
            finished_at: new Date().toISOString(),
          });
          onLog({ type: 'error', text: `✗ ${testCase.title} 异常: ${error.message}` });
        }

        onLog({ type: 'divider', text: '' });
      }
    } catch (error) {
      onLog({ type: 'error', text: `执行器异常: ${error.message}` });
    } finally {
      // 如果已经停止，资源可能已经被清理了
      if (!this.stopped) {
        try {
          await this.runner.close();
        } catch (e) {
          console.error('关闭执行器失败:', e);
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    // 更新报告状态
    updateReport(report.id, {
      status: wasStopped || this.stopped ? 'stopped' : 'completed',
      passed_cases: passedCount,
      failed_cases: failedCount,
      duration_ms: totalDuration,
      finished_at: new Date().toISOString(),
    });

    onLog({ type: 'divider', text: '' });
    onLog({
      type: 'system',
      text: wasStopped || this.stopped
        ? '执行已停止'
        : `执行完成: ${passedCount} 通过, ${failedCount} 失败`,
    });
    onLog({ type: 'system', text: `总耗时: ${(totalDuration / 1000).toFixed(1)}s` });
    onLog({ type: 'system', text: `报告: /api/reports/${report.id}/html` });

    return {
      reportId: report.id,
      total: cases.length,
      passed: passedCount,
      failed: failedCount,
      stopped: wasStopped || this.stopped,
      durationMs: totalDuration,
    };
  }
}

module.exports = { BatchExecutor };
