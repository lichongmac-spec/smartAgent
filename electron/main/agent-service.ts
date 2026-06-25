/**
 * AgentService — SmartAgent 核心能力封装
 *
 * 负责在主进程中管理 LoopEngine / ToolRegistry / MemoryManager 等模块，
 * 作为 11 个 IPC 通道的统一入口。采用单例 + 懒加载模式。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export class AgentService {
  private static instance: AgentService;
  private interrupted = false;

  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  // ─── Agent 对话 ─────────────────────────────

  async ask(prompt: string, _sessionId?: string): Promise<string> {
    // TODO: 接入 LoopEngine.run()
    return `[Placeholder] Agent responding to: "${prompt}"`;
  }

  async askStream(
    prompt: string,
    _sessionId: string | undefined,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const words = `Processing: "${prompt}"`.split(' ');
    for (const word of words) {
      if (this.interrupted) {
        onChunk('\n[Interrupted]');
        this.interrupted = false;
        return;
      }
      onChunk(word + ' ');
      await new Promise((r) => setTimeout(r, 100));
    }
    onChunk('\n✅ Done (placeholder stream mode)');
  }

  interrupt(): void {
    this.interrupted = true;
  }

  // ─── 工具管理 ───────────────────────────────

  getTools(): Array<{ name: string; description: string; enabled: boolean }> {
    return [
      { name: 'read_file', description: 'Read a file from disk', enabled: true },
      { name: 'write_file', description: 'Write content to a file', enabled: true },
      { name: 'search_web', description: 'Search the web', enabled: true },
      { name: 'calculator', description: 'Evaluate math expressions', enabled: true },
    ];
  }

  // ─── 记忆搜索 ───────────────────────────────

  searchMemory(_query: string, _limit: number): Array<{ id: string; content: string; score: number }> {
    // TODO: 接入 MemoryManager 实现真正的记忆搜索
    return [];
  }

  // ─── 配置管理 ───────────────────────────────

  getConfig(key: string): unknown {
    const store: AnyRecord = { provider: 'mock', model: 'default' };
    return store[key] ?? null;
  }

  setConfig(_key: string, _value: unknown): void {
    // TODO: 接入 ConfigManager
  }

  // ─── 调度任务 ───────────────────────────────

  getScheduledTasks(): Array<{ id: string; name: string; cron: string; enabled: boolean }> {
    // TODO: 接入 TaskQueue / Scheduler 实现真正的调度任务管理
    return [];
  }

  addScheduledTask(name: string, cron: string, action: string): string {
    // TODO: 接入 TaskQueue / Scheduler 实现真正的任务调度
    const id = `task_${Date.now()}`;
    console.log(`[AgentService] Scheduled task added: ${name} (${cron}) → ${action}`);
    return id;
  }

  // ─── 健康状态 ───────────────────────────────

  getHealthStatus(): { healthy: boolean; checks: AnyRecord } {
    // TODO: 接入 HeartbeatManager 实现真正的健康监控
    return { healthy: true, checks: {} };
  }

  // ─── 队列统计 ───────────────────────────────

  getQueueStats(): { pending: number; running: number; completed: number } {
    // TODO: 接入 TaskQueue 实现真正的队列统计
    return { pending: 0, running: 0, completed: 0 };
  }
}
