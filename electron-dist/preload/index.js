"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 预加载脚本 — 最小版本
 *
 * 安全暴露受限 API 给渲染进程
 */
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('app', {
    /** 应用名称 */
    name: 'SmartAgent Desktop',
    /** 平台信息 */
    platform: process.platform,
});
//# sourceMappingURL=index.js.map