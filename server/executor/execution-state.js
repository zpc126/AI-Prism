// input: 当前自动化执行器
// output: 跨路由共享的执行状态
// position: 自动化任务生命周期管理

let currentExecutor = null;

function setCurrentExecutor(executor) {
  currentExecutor = executor;
}

function getCurrentExecutor() {
  return currentExecutor;
}

function clearCurrentExecutor(executor) {
  if (!executor || currentExecutor === executor) {
    currentExecutor = null;
  }
}

module.exports = {
  setCurrentExecutor,
  getCurrentExecutor,
  clearCurrentExecutor,
};
