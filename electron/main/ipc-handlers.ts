import type { IpcMain } from 'electron';
import { AgentService } from './agent-service';

const agentService = AgentService.getInstance();

/**
 * 注册所有 IPC 处理器
 * 安全原则：所有参数在校验后才传入 Agent，错误统一通过 {error} 返回
 */
export function registerIpcHandlers(ipcMain: IpcMain): void {
  // ─── Agent 对话 ─────────────────────────────

  ipcMain.handle('agent:ask', async (_event, params: { prompt: string; sessionId?: string }) => {
    try {
      if (!params.prompt || typeof params.prompt !== 'string') {
        return { error: 'Invalid prompt: must be a non-empty string' };
      }
      const answer = await agentService.ask(params.prompt, params.sessionId);
      return { answer };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('agent:ask-stream', async (event, params: { prompt: string; sessionId?: string }) => {
    try {
      if (!params.prompt || typeof params.prompt !== 'string') {
        const sender = event.sender;
        sender.send('agent:chunk', 'Error: Invalid prompt');
        sender.send('agent:stream-end');
        return;
      }
      await agentService.askStream(params.prompt, params.sessionId, (chunk: string) => {
        event.sender.send('agent:chunk', chunk);
      });
      event.sender.send('agent:stream-end');
    } catch (err) {
      event.sender.send('agent:chunk', `Error: ${err instanceof Error ? err.message : String(err)}`);
      event.sender.send('agent:stream-end');
    }
  });

  ipcMain.handle('agent:interrupt', async () => {
    try {
      agentService.interrupt();
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── 工具管理 ───────────────────────────────

  ipcMain.handle('tools:list', async () => {
    try {
      const tools = agentService.getTools();
      return { tools };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── 记忆搜索 ───────────────────────────────

  ipcMain.handle('memory:search', async (_event, params: { query: string; limit?: number }) => {
    try {
      if (!params.query || typeof params.query !== 'string') {
        return { error: 'Invalid query: must be a non-empty string' };
      }
      const memories = agentService.searchMemory(params.query, params.limit ?? 10);
      return { memories };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── 配置管理 ───────────────────────────────

  ipcMain.handle('config:get', async (_event, params: { key: string }) => {
    try {
      if (!params.key) {
        return { error: 'Missing config key' };
      }
      const value = agentService.getConfig(params.key);
      return { value };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('config:set', async (_event, params: { key: string; value: unknown }) => {
    try {
      if (!params.key) {
        return { error: 'Missing config key' };
      }
      agentService.setConfig(params.key, params.value);
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── 调度任务 ───────────────────────────────

  ipcMain.handle('scheduler:list', async () => {
    try {
      const tasks = agentService.getScheduledTasks();
      return { tasks };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('scheduler:add', async (_event, params: { name: string; cron: string; action: string }) => {
    try {
      if (!params.name || !params.cron || !params.action) {
        return { error: 'Missing required fields: name, cron, action' };
      }
      const id = agentService.addScheduledTask(params.name, params.cron, params.action);
      return { id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── 健康状态 ───────────────────────────────

  ipcMain.handle('heartbeat:status', async () => {
    try {
      const status = agentService.getHealthStatus();
      return { ...status };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── 队列统计 ───────────────────────────────

  ipcMain.handle('queue:stats', async () => {
    try {
      const stats = agentService.getQueueStats();
      return { ...stats };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
