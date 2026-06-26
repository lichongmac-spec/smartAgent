/**
 * 主进程 — Electron 桌面程序入口
 *
 * 职责：
 * 1. 创建 BrowserWindow
 * 2. 注册 IPC 处理器（流式提问 / 中断）
 * 3. 管理应用生命周期
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { AgentService } from './agent-service';

let mainWindow: BrowserWindow | null = null;
const agentService = AgentService.getInstance();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    title: 'SmartAgent Desktop',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, '..', '..', 'electron-build', 'renderer', 'index.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC 处理器 ────────────────────────────

function registerIpcHandlers(): void {
  // 流式提问：渲染进程发送 prompt，主进程逐 chunk 推送回复
  ipcMain.on('agent:ask-stream', async (event, params: { prompt: string }) => {
    if (!params.prompt || typeof params.prompt !== 'string') {
      event.sender.send('agent:chunk', { chunk: '', done: true, error: '请输入有效的问题' });
      return;
    }

    try {
      await agentService.askStream(
        params.prompt,
        undefined,
        (chunk: string) => {
          event.sender.send('agent:chunk', { chunk, done: false });
        }
      );
      event.sender.send('agent:chunk', { chunk: '', done: true });
    } catch (err) {
      event.sender.send('agent:chunk', {
        chunk: '',
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 中断生成
  ipcMain.on('agent:interrupt', () => {
    agentService.interrupt();
  });
}

// ── 应用生命周期 ────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
