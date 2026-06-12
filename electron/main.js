// input: electron 模块、server/index.js、Electron 运行时标记
// output: 应用窗口、IPC 通信
// position: Electron 主进程入口

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
process.env.SCOUT_RUNTIME = 'electron';
const { startServer } = require('../server/index');
const { loadConfig, saveConfig, getActiveProviderConfig } = require('./config-store');

// 判断是否为打包环境
const isDev = !app.isPackaged;

// 开发模式热重载
if (isDev) {
  try {
    require('electron-reload')(path.join(__dirname, '../src'), {
      electron: path.join(__dirname, '../node_modules/.bin/electron'),
      hardResetMethod: 'exit'
    });
  } catch (e) {}
}

let mainWindow;
let serverInstance;

// 获取资源路径
function getResourcePath() {
  // __dirname 在打包后会正确指向 app.asar 内的目录
  return path.join(__dirname, '..');
}

function createWindow() {
  const resourcePath = getResourcePath();
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(resourcePath, 'build/icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 18 },
    backgroundColor: '#ffffff',
    title: 'Scout'
  });

  // 加载 HTML 文件
  const htmlPath = path.join(resourcePath, 'src/index.html');
  mainWindow.loadFile(htmlPath);

  // 开发模式下打开 DevTools
  if (isDev) {
    mainWindow.webContents.openDevTools();
    // 首次加载时重置引导标记
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.executeJavaScript('localStorage.removeItem("scout_welcome_seen");');
    });
  }
}

app.whenReady().then(async () => {
  // 注册 IPC 处理函数
  ipcMain.handle('config:get', () => {
    return loadConfig();
  });
  
  ipcMain.handle('config:save', (event, config) => {
    return saveConfig(config);
  });
  
  ipcMain.handle('config:getActiveProvider', () => {
    return getActiveProviderConfig();
  });
  
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });
  
  ipcMain.handle('app:getName', () => {
    return app.getName();
  });

  // 启动后端服务
  serverInstance = await startServer(3001);
  console.log('Server running on port 3001');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 通信示例
ipcMain.handle('ping', async () => {
  return 'pong';
});
