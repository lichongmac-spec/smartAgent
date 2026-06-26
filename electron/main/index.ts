/**
 * 主进程 — Electron 桌面程序入口（最小版本）
 *
 * 只做三件事：
 * 1. 创建 BrowserWindow
 * 2. 加载 HTML 界面
 * 3. 管理应用生命周期（窗口关闭 → 退出）
 */
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'SmartAgent Desktop',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载界面
  const htmlPath = path.join(
    __dirname, '..', '..', 'electron-build', 'renderer', 'index.html'
  );
  mainWindow.loadFile(htmlPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 应用生命周期 ────────────────────────────

app.whenReady().then(() => {
  createWindow();

  // macOS: 点击 Dock 图标时如果没有窗口则新建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出（macOS 除外，macOS 应用通常在后台保持）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
