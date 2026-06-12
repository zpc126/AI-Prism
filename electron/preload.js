// input: electron IPC 模块
// output: 渲染进程可用的 API (window.electronAPI)
// position: 主进程与渲染进程的安全桥梁

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  
  // 配置相关
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    getActiveProvider: () => ipcRenderer.invoke('config:getActiveProvider')
  },
  
  // 应用信息
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getName: () => ipcRenderer.invoke('app:getName')
  }
});
