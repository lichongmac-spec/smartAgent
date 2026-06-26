"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 预加载脚本 — 安全暴露受限 API 给渲染进程
 *
 * 只通过 contextBridge 暴露封装好的业务函数，禁止直接暴露 ipcRenderer
 */
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('agent', {
    /**
     * 流式提问 — 逐字推送 Agent 回复
     * @param prompt 用户输入
     * @param onChunk 每收到一个文字块时调用
     * @param onDone 流结束时调用
     * @param onError 出错时调用
     * @returns cleanup 函数，用于取消监听
     */
    askStream: (prompt, onChunk, onDone, onError) => {
        // 注册一次性监听器
        const chunkHandler = (_event, data) => {
            if (data.error) {
                onError(data.error);
                cleanup();
                return;
            }
            if (data.done) {
                onDone();
                cleanup();
                return;
            }
            onChunk(data.chunk);
        };
        const cleanup = () => {
            electron_1.ipcRenderer.removeListener('agent:chunk', chunkHandler);
        };
        electron_1.ipcRenderer.on('agent:chunk', chunkHandler);
        // 发送流式请求到主进程
        electron_1.ipcRenderer.send('agent:ask-stream', { prompt });
    },
    /**
     * 中断正在进行的 Agent 生成
     */
    interrupt: () => {
        electron_1.ipcRenderer.send('agent:interrupt');
    },
    /** 应用名称 */
    name: 'SmartAgent Desktop',
    /** 平台信息 */
    platform: process.platform,
});
//# sourceMappingURL=index.js.map