// input: HTTP server
// output: WebSocket 实时推送评估日志
// position: server/evaluation/ws.js

const { WebSocketServer } = require('ws');

let wss;
const clients = new Set();

function initWs(server) {
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (!request.url || !request.url.startsWith('/ws/eval')) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
  
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });
  
  return wss;
}

// 向所有客户端广播
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

// 便捷方法
function log(runId, level, message, meta) {
  broadcast('log', { runId, level, message, meta });
}

function progress(runId, step, total, detail) {
  broadcast('progress', { runId, step, total, detail });
}

function done(runId, report) {
  broadcast('done', { runId, report });
}

function error(runId, err) {
  broadcast('error', { runId, message: err.message || err });
}

module.exports = { initWs, broadcast, log, progress, done, error };
