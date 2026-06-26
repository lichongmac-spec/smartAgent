"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 主进程 — Electron 桌面程序入口
 *
 * 职责：
 * 1. 创建 BrowserWindow
 * 2. 注册 IPC 处理器（流式提问 / 中断）
 * 3. 管理应用生命周期
 */
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const agent_service_1 = require("./agent-service");
let mainWindow = null;
const agentService = agent_service_1.AgentService.getInstance();
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 500,
        minHeight: 400,
        title: 'SmartAgent Desktop',
        webPreferences: {
            preload: path_1.default.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const htmlPath = path_1.default.join(__dirname, '..', '..', 'electron-build', 'renderer', 'index.html');
    mainWindow.loadFile(htmlPath);
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// ── IPC 处理器 ────────────────────────────
function registerIpcHandlers() {
    // 流式提问：渲染进程发送 prompt，主进程逐 chunk 推送回复
    electron_1.ipcMain.on('agent:ask-stream', async (event, params) => {
        if (!params.prompt || typeof params.prompt !== 'string') {
            event.sender.send('agent:chunk', { chunk: '', done: true, error: '请输入有效的问题' });
            return;
        }
        try {
            await agentService.askStream(params.prompt, undefined, (chunk) => {
                event.sender.send('agent:chunk', { chunk, done: false });
            });
            event.sender.send('agent:chunk', { chunk: '', done: true });
        }
        catch (err) {
            event.sender.send('agent:chunk', {
                chunk: '',
                done: true,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });
    // 中断生成
    electron_1.ipcMain.on('agent:interrupt', () => {
        agentService.interrupt();
    });
}
// ── 应用生命周期 ────────────────────────────
electron_1.app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=index.js.map