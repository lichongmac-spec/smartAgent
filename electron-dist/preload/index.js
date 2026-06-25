import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electron', {
    // Agent 对话
    askAgent: (prompt, sessionId) => ipcRenderer.invoke('agent:ask', { prompt, sessionId }),
    askAgentStream: (prompt, onChunk, onEnd, sessionId) => {
        let cleaned = false;
        const chunkListener = (_event, chunk) => onChunk(chunk);
        const endListener = () => {
            if (cleaned)
                return;
            cleaned = true;
            ipcRenderer.off('agent:chunk', chunkListener);
            ipcRenderer.off('agent:stream-end', endListener);
            onEnd();
        };
        ipcRenderer.on('agent:chunk', chunkListener);
        ipcRenderer.on('agent:stream-end', endListener);
        return ipcRenderer.invoke('agent:ask-stream', { prompt, sessionId })
            .catch((err) => {
            // Invoke 失败时也清理监听器，防止泄漏
            endListener();
            throw err;
        });
    },
    interruptAgent: () => ipcRenderer.invoke('agent:interrupt'),
    // 工具管理
    getTools: () => ipcRenderer.invoke('tools:list'),
    // 记忆搜索
    searchMemory: (query, limit) => ipcRenderer.invoke('memory:search', { query, limit }),
    // 配置管理
    getConfig: (key) => ipcRenderer.invoke('config:get', { key }),
    setConfig: (key, value) => ipcRenderer.invoke('config:set', { key, value }),
    // 调度任务
    getScheduledTasks: () => ipcRenderer.invoke('scheduler:list'),
    addScheduledTask: (name, cron, action) => ipcRenderer.invoke('scheduler:add', { name, cron, action }),
    // 健康与队列
    getHeartbeatStatus: () => ipcRenderer.invoke('heartbeat:status'),
    getQueueStats: () => ipcRenderer.invoke('queue:stats'),
});
//# sourceMappingURL=index.js.map