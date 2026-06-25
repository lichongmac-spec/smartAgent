/**
 * AgentService — SmartAgent 核心能力封装
 *
 * 负责在主进程中管理 LoopEngine / ToolRegistry / MemoryManager 等模块，
 * 作为 11 个 IPC 通道的统一入口。采用单例 + 懒加载模式。
 */
export class AgentService {
    static instance;
    interrupted = false;
    static getInstance() {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }
    // ─── Agent 对话 ─────────────────────────────
    async ask(prompt, _sessionId) {
        // TODO: 接入 LoopEngine.run()
        return `[Placeholder] Agent responding to: "${prompt}"`;
    }
    async askStream(prompt, _sessionId, onChunk) {
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
    interrupt() {
        this.interrupted = true;
    }
    // ─── 工具管理 ───────────────────────────────
    getTools() {
        return [
            { name: 'read_file', description: 'Read a file from disk', enabled: true },
            { name: 'write_file', description: 'Write content to a file', enabled: true },
            { name: 'search_web', description: 'Search the web', enabled: true },
            { name: 'calculator', description: 'Evaluate math expressions', enabled: true },
        ];
    }
    // ─── 记忆搜索 ───────────────────────────────
    searchMemory(_query, _limit) {
        // TODO: 接入 MemoryManager 实现真正的记忆搜索
        return [];
    }
    // ─── 配置管理 ───────────────────────────────
    getConfig(key) {
        const store = { provider: 'mock', model: 'default' };
        return store[key] ?? null;
    }
    setConfig(_key, _value) {
        // TODO: 接入 ConfigManager
    }
    // ─── 调度任务 ───────────────────────────────
    getScheduledTasks() {
        // TODO: 接入 TaskQueue / Scheduler 实现真正的调度任务管理
        return [];
    }
    addScheduledTask(name, cron, action) {
        // TODO: 接入 TaskQueue / Scheduler 实现真正的任务调度
        const id = `task_${Date.now()}`;
        console.log(`[AgentService] Scheduled task added: ${name} (${cron}) → ${action}`);
        return id;
    }
    // ─── 健康状态 ───────────────────────────────
    getHealthStatus() {
        // TODO: 接入 HeartbeatManager 实现真正的健康监控
        return { healthy: true, checks: {} };
    }
    // ─── 队列统计 ───────────────────────────────
    getQueueStats() {
        // TODO: 接入 TaskQueue 实现真正的队列统计
        return { pending: 0, running: 0, completed: 0 };
    }
}
//# sourceMappingURL=agent-service.js.map