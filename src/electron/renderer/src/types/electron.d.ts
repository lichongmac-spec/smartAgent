/**
 * window.electron 全局类型声明
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

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
