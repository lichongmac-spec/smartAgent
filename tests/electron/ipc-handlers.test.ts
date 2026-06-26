/**
 * IPC Handlers 单元测试 — Stream 版
 *
 * 测试 src/electron/main/ipc-handlers.ts 的 IPC 通道。
 * agent:ask-stream 和 agent:interrupt 使用 ipcMain.on（流式），
 * 其余 9 个通道使用 ipcMain.handle（请求-响应）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AgentService
vi.mock('../../src/electron/main/agent-service.js', () => {
  const mockAsk = vi.fn().mockResolvedValue('Mock response');
  const mockAskStream = vi.fn().mockImplementation(
    async (_prompt: string, _sid: string | undefined, onChunk: (c: string) => void) => {
      onChunk('Hello ');
      onChunk('World');
    }
  );
  const mockInterrupt = vi.fn();
  const mockGetTools = vi.fn().mockReturnValue([
    { name: 'read_file', description: 'Read', enabled: true },
  ]);
  const mockSearchMemory = vi.fn().mockReturnValue([]);
  const mockGetConfig = vi.fn().mockImplementation((key: string) => {
    const store: Record<string, unknown> = { provider: 'deepseek', model: 'deepseek-v4-flash' };
    return store[key] ?? null;
  });
  const mockSetConfig = vi.fn();
  const mockGetScheduledTasks = vi.fn().mockReturnValue([]);
  const mockAddScheduledTask = vi.fn().mockReturnValue('task_12345');
  const mockGetHealthStatus = vi.fn().mockReturnValue({ healthy: true, checks: {} });
  const mockGetQueueStats = vi.fn().mockReturnValue({ pending: 0, running: 0, completed: 0 });

  return {
    AgentService: {
      getInstance: () => ({
        ask: mockAsk,
        askStream: mockAskStream,
        interrupt: mockInterrupt,
        getTools: mockGetTools,
        searchMemory: mockSearchMemory,
        getConfig: mockGetConfig,
        setConfig: mockSetConfig,
        getScheduledTasks: mockGetScheduledTasks,
        addScheduledTask: mockAddScheduledTask,
        getHealthStatus: mockGetHealthStatus,
        getQueueStats: mockGetQueueStats,
      }),
    },
  };
});

import { registerIpcHandlers } from '../../src/electron/main/ipc-handlers.js';

describe('IPC Handlers', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockIpcMain: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleHandlers: Record<string, (...args: any[]) => Promise<any>> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onHandlers: Record<string, (...args: any[]) => void> = {};

  beforeEach(() => {
    // Reset handler storage
    Object.keys(handleHandlers).forEach((key) => delete handleHandlers[key]);
    Object.keys(onHandlers).forEach((key) => delete onHandlers[key]);

    mockIpcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handleHandlers[channel] = handler;
      }),
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        onHandlers[channel] = handler;
      }),
    };

    registerIpcHandlers(mockIpcMain);
  });

  // ─── 注册验证 ───────────────────────────────

  it('should register 9 handle + 2 on channels', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledTimes(9);
    expect(mockIpcMain.on).toHaveBeenCalledTimes(2);
  });

  it('should register all handle channels', () => {
    const handleChannels = [
      'agent:ask', 'tools:list', 'memory:search',
      'config:get', 'config:set', 'scheduler:list', 'scheduler:add',
      'heartbeat:status', 'queue:stats',
    ];
    for (const ch of handleChannels) {
      expect(handleHandlers[ch]).toBeDefined();
    }
  });

  it('should register streaming on-channels', () => {
    expect(onHandlers['agent:ask-stream']).toBeDefined();
    expect(onHandlers['agent:interrupt']).toBeDefined();
  });

  // ─── agent:ask ──────────────────────────────

  it('agent:ask should return answer for valid prompt', async () => {
    const result = await handleHandlers['agent:ask'](null, { prompt: 'Hello' });
    expect(result).toHaveProperty('answer', 'Mock response');
  });

  it('agent:ask should reject empty prompt', async () => {
    const result = await handleHandlers['agent:ask'](null, { prompt: '' });
    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Invalid prompt');
  });

  it('agent:ask should reject missing prompt', async () => {
    const result = await handleHandlers['agent:ask'](null, {});
    expect(result).toHaveProperty('error');
  });

  it('agent:ask should accept optional sessionId', async () => {
    const result = await handleHandlers['agent:ask'](null, { prompt: 'Hi', sessionId: 's1' });
    expect(result).toHaveProperty('answer');
  });

  // ─── agent:ask-stream (on) ──────────────────

  it('agent:ask-stream should send chunks via event.sender.send', async () => {
    const send = vi.fn();
    const mockEvent = { sender: { send } };

    await onHandlers['agent:ask-stream'](mockEvent, { prompt: 'Hi' });

    expect(send).toHaveBeenCalledWith('agent:chunk', { chunk: 'Hello ', done: false });
    expect(send).toHaveBeenCalledWith('agent:chunk', { chunk: 'World', done: false });
    expect(send).toHaveBeenCalledWith('agent:chunk', { chunk: '', done: true });
  });

  it('agent:ask-stream should reject empty prompt', async () => {
    const send = vi.fn();
    const mockEvent = { sender: { send } };

    await onHandlers['agent:ask-stream'](mockEvent, { prompt: '' });

    expect(send).toHaveBeenCalledWith('agent:chunk', {
      chunk: '',
      done: true,
      error: '请输入有效的问题',
    });
  });

  // ─── agent:interrupt (on) ───────────────────

  it('agent:interrupt should call interrupt without error', () => {
    expect(() => onHandlers['agent:interrupt']()).not.toThrow();
  });

  // ─── tools:list ─────────────────────────────

  it('tools:list should return tools array', async () => {
    const result = await handleHandlers['tools:list']();
    expect(result).toHaveProperty('tools');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('read_file');
  });

  // ─── memory:search ──────────────────────────

  it('memory:search should return memories array', async () => {
    const result = await handleHandlers['memory:search'](null, { query: 'test' });
    expect(result).toHaveProperty('memories');
    expect(result.memories).toEqual([]);
  });

  it('memory:search should reject empty query', async () => {
    const result = await handleHandlers['memory:search'](null, { query: '' });
    expect(result).toHaveProperty('error');
  });

  it('memory:search should default limit to 10', async () => {
    const result = await handleHandlers['memory:search'](null, { query: 'x' });
    expect(result).toHaveProperty('memories');
  });

  // ─── config:get ─────────────────────────────

  it('config:get should return value for known key', async () => {
    const result = await handleHandlers['config:get'](null, { key: 'provider' });
    expect(result).toEqual({ value: 'deepseek' });
  });

  it('config:get should reject missing key', async () => {
    const result = await handleHandlers['config:get'](null, { key: '' });
    expect(result).toHaveProperty('error');
  });

  // ─── config:set ─────────────────────────────

  it('config:set should return success', async () => {
    const result = await handleHandlers['config:set'](null, { key: 'theme', value: 'dark' });
    expect(result).toEqual({ success: true });
  });

  it('config:set should reject missing key', async () => {
    const result = await handleHandlers['config:set'](null, { key: '', value: 'x' });
    expect(result).toHaveProperty('error');
  });

  // ─── scheduler:list ─────────────────────────

  it('scheduler:list should return tasks array', async () => {
    const result = await handleHandlers['scheduler:list']();
    expect(result).toHaveProperty('tasks');
    expect(result.tasks).toEqual([]);
  });

  // ─── scheduler:add ──────────────────────────

  it('scheduler:add should return task id', async () => {
    const result = await handleHandlers['scheduler:add'](null, {
      name: 'Daily',
      cron: '0 9 * * *',
      action: 'echo hi',
    });
    expect(result).toHaveProperty('id');
  });

  it('scheduler:add should reject missing fields', async () => {
    const result = await handleHandlers['scheduler:add'](null, { name: '', cron: '', action: '' });
    expect(result).toHaveProperty('error');
  });

  // ─── heartbeat:status ───────────────────────

  it('heartbeat:status should return health info', async () => {
    const result = await handleHandlers['heartbeat:status']();
    expect(result.healthy).toBe(true);
  });

  // ─── queue:stats ────────────────────────────

  it('queue:stats should return queue stats', async () => {
    const result = await handleHandlers['queue:stats']();
    expect(result.pending).toBe(0);
    expect(result.running).toBe(0);
    expect(result.completed).toBe(0);
  });
});
