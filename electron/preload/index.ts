import { contextBridge, ipcRenderer } from 'electron';

/**
 * 预加载脚本 — 安全暴露 API 给渲染进程
 *
 * 原则：
 *  - 只暴露函数，不暴露对象或类
 *  - 所有参数和返回值必须可序列化
 *  - 流式调用使用 ipcRenderer.on 监听事件
 */

export interface ElectronAPI {
  // Agent 对话
  askAgent: (prompt: string, sessionId?: string) => Promise<{ answer?: string; error?: string }>;
  askAgentStream: (
    prompt: string,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
    sessionId?: string
  ) => Promise<void>;
  interruptAgent: () => Promise<{ success?: boolean; error?: string }>;

  // 工具管理
  getTools: () => Promise<{ tools?: Array<{ name: string; description: string; enabled: boolean }>; error?: string }>;

  // 记忆搜索
  searchMemory: (query: string, limit?: number) => Promise<{ memories?: Array<{ id: string; content: string; score: number }>; error?: string }>;

  // 配置管理
  getConfig: (key: string) => Promise<{ value?: unknown; error?: string }>;
  setConfig: (key: string, value: unknown) => Promise<{ success?: boolean; error?: string }>;

  // 调度任务
  getScheduledTasks: () => Promise<{ tasks?: Array<{ id: string; name: string; cron: string; enabled: boolean }>; error?: string }>;
  addScheduledTask: (name: string, cron: string, action: string) => Promise<{ id?: string; error?: string }>;

  // 健康与队列
  getHeartbeatStatus: () => Promise<{ healthy?: boolean; checks?: Record<string, boolean>; error?: string }>;
  getQueueStats: () => Promise<{ pending?: number; running?: number; completed?: number; error?: string }>;
}

contextBridge.exposeInMainWorld('electron', {
  // Agent 对话
  askAgent: (prompt: string, sessionId?: string) =>
    ipcRenderer.invoke('agent:ask', { prompt, sessionId }),

  askAgentStream: (prompt: string, onChunk: (chunk: string) => void, onEnd: () => void, sessionId?: string) => {
    let cleaned = false;
    const chunkListener = (_event: Electron.IpcRendererEvent, chunk: string) => onChunk(chunk);
    const endListener = () => {
      if (cleaned) return;
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
  searchMemory: (query: string, limit?: number) => ipcRenderer.invoke('memory:search', { query, limit }),

  // 配置管理
  getConfig: (key: string) => ipcRenderer.invoke('config:get', { key }),
  setConfig: (key: string, value: unknown) => ipcRenderer.invoke('config:set', { key, value }),

  // 调度任务
  getScheduledTasks: () => ipcRenderer.invoke('scheduler:list'),
  addScheduledTask: (name: string, cron: string, action: string) =>
    ipcRenderer.invoke('scheduler:add', { name, cron, action }),

  // 健康与队列
  getHeartbeatStatus: () => ipcRenderer.invoke('heartbeat:status'),
  getQueueStats: () => ipcRenderer.invoke('queue:stats'),
} satisfies ElectronAPI);
