"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 主进程 — Electron 桌面程序入口（最小版本）
 *
 * 只做三件事：
 * 1. 创建 BrowserWindow
 * 2. 加载 HTML 界面
 * 3. 管理应用生命周期（窗口关闭 → 退出）
 */
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1000,
        height: 700,
        title: 'SmartAgent Desktop',
        webPreferences: {
            preload: path_1.default.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    // 加载界面
    const htmlPath = path_1.default.join(__dirname, '..', '..', 'electron-build', 'renderer', 'index.html');
    mainWindow.loadFile(htmlPath);
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// ── 应用生命周期 ────────────────────────────
electron_1.app.whenReady().then(() => {
    createWindow();
    // macOS: 点击 Dock 图标时如果没有窗口则新建
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// 所有窗口关闭时退出（macOS 除外，macOS 应用通常在后台保持）
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=index.js.map