/**
 * Electron 集成测试
 *
 * 测试 IPC 完整链路：preload API → ipcMain.handle → agent-service → 返回。
 * 模拟真实的 Electron IPC 调用流程。
 *
 * 注意：由于 vi.mock 的 hoisting 特性，所有 mock 对象必须在模块顶层创建。
 * 集成测试通过直接调用 registerIpcHandlers 并手动调用 handler 来验证链路。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock AgentService ────────────────────────

vi.mock('../../electron/main/agent-service.js', () => ({
  AgentService: {
    getInstance: () => ({
      ask: vi.fn().mockResolvedValue('[Agent] Hello World'),
      askStream: vi.fn().mockImplementation(
        async (_prompt: string, _sid: string | undefined, onChunk: (c: string) => void) => {
          onChunk('Streaming ');
          onChunk('response');
        }
      ),
      interrupt: vi.fn(),
      getTools: vi.fn().mockReturnValue([
        { name: 'read_file', description: 'Read a file', enabled: true },
        { name: 'write_file', description: 'Write a file', enabled: true },
      ]),
      searchMemory: vi.fn().mockReturnValue([
        { id: 'm1', content: 'Remember this', score: 0.95 },
      ]),
      getConfig: vi.fn().mockImplementation((key: string) => {
        const store: Record<string, unknown> = { provider: 'deepseek', model: 'deepseek-v4-flash' };
        return store[key] ?? null;
      }),
      setConfig: vi.fn(),
      getScheduledTasks: vi.fn().mockReturnValue([
        { id: 't1', name: 'Daily Report', cron: '0 9 * * *', enabled: true },
      ]),
      addScheduledTask: vi.fn().mockReturnValue('task_99999'),
      getHealthStatus: vi.fn().mockReturnValue({
        healthy: true,
        checks: { llm: true, disk: true, memory: true },
      }),
      getQueueStats: vi.fn().mockReturnValue({
        pending: 2,
        running: 1,
        completed: 100,
      }),
    }),
  },
}));

// ─── Mock Electron — 模块级变量供 vi.mock 闭包 ──

const mockIpcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

const mockContextBridgeExpose = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockContextBridgeExpose },
  ipcRenderer: mockIpcRenderer,
}));

import { registerIpcHandlers } from '../../electron/main/ipc-handlers.js';

describe('Electron Integration — IPC Full Chain', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exposedAPI: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Build handlers map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Record<string, (...args: any[]) => Promise<any>> = {};

    const mockIpcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
      }),
    };

    registerIpcHandlers(mockIpcMain);

    // Wire invoke to dispatch through handlers
    mockIpcRenderer.invoke.mockImplementation(
      async (channel: string, ...args: unknown[]) => {
        const handler = handlers[channel];
        if (!handler) throw new Error(`No handler for: ${channel}`);
        const mockEvent = { sender: { send: vi.fn() } };
        return handler(mockEvent, ...args);
      }
    );

    // Reload preload to capture exposed API
    vi.resetModules();
    await import('../../electron/preload/index.js');

    // Extract the exposed API
    const callArgs = mockContextBridgeExpose.mock.calls.find(
      (call: unknown[]) => call[0] === 'electron'
    );
    exposedAPI = callArgs ? callArgs[1] : null;
  });

  // ─── agent:ask 完整链路 ──────────────────────

  it('should complete askAgent IPC chain', async () => {
    expect(exposedAPI).not.toBeNull();
    const result = await exposedAPI.askAgent('Hello');
    expect(result).toEqual({ answer: '[Agent] Hello World' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      'agent:ask',
      { prompt: 'Hello', sessionId: undefined }
    );
  });

  it('should pass sessionId through askAgent', async () => {
    await exposedAPI.askAgent('Hi', 'session-abc');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      'agent:ask',
      { prompt: 'Hi', sessionId: 'session-abc' }
    );
  });

  it('should return error for empty prompt via IPC chain', async () => {
    const result = await exposedAPI.askAgent('');
    expect(result).toHaveProperty('error');
    expect(result.error).toContain('Invalid prompt');
  });

  // ─── agent:ask-stream 完整链路 ───────────────

  it('should complete askAgentStream IPC chain', async () => {
    const onChunk = vi.fn();
    const onEnd = vi.fn();

    await exposedAPI.askAgentStream('Stream test', onChunk, onEnd);

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      'agent:ask-stream',
      { prompt: 'Stream test', sessionId: undefined }
    );
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('agent:chunk', expect.any(Function));
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('agent:stream-end', expect.any(Function));
  });

  it('should clean up listeners on stream end', () => {
    const onChunk = vi.fn();
    const onEnd = vi.fn();

    exposedAPI.askAgentStream('test', onChunk, onEnd);

    const endListenerCalls = mockIpcRenderer.on.mock.calls.filter(
      (call: unknown[]) => call[0] === 'agent:stream-end'
    );
    expect(endListenerCalls.length).toBeGreaterThan(0);
    const endListener = endListenerCalls[0][1];

    endListener();
    expect(mockIpcRenderer.off).toHaveBeenCalledWith('agent:chunk', expect.any(Function));
    expect(mockIpcRenderer.off).toHaveBeenCalledWith('agent:stream-end', expect.any(Function));
    expect(onEnd).toHaveBeenCalled();
  });

  // ─── agent:interrupt ────────────────────────

  it('should complete interruptAgent IPC chain', async () => {
    const result = await exposedAPI.interruptAgent();
    expect(result).toEqual({ success: true });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('agent:interrupt');
  });

  // ─── tools:list ─────────────────────────────

  it('should complete getTools IPC chain', async () => {
    const result = await exposedAPI.getTools();
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe('read_file');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('tools:list');
  });

  // ─── memory:search ──────────────────────────

  it('should complete searchMemory IPC chain', async () => {
    const result = await exposedAPI.searchMemory('keyword', 5);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].id).toBe('m1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      'memory:search',
      { query: 'keyword', limit: 5 }
    );
  });

  it('should return error for empty memory query', async () => {
    const result = await exposedAPI.searchMemory('');
    expect(result).toHaveProperty('error');
  });

  // ─── config:get/set ─────────────────────────

  it('should complete getConfig IPC chain', async () => {
    const result = await exposedAPI.getConfig('provider');
    expect(result).toEqual({ value: 'deepseek' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('config:get', { key: 'provider' });
  });

  it('should return null for unknown config key', async () => {
    const result = await exposedAPI.getConfig('unknown_key');
    expect(result).toEqual({ value: null });
  });

  it('should complete setConfig IPC chain', async () => {
    const result = await exposedAPI.setConfig('theme', 'dark');
    expect(result).toEqual({ success: true });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      'config:set',
      { key: 'theme', value: 'dark' }
    );
  });

  // ─── scheduler:list/add ─────────────────────

  it('should complete getScheduledTasks IPC chain', async () => {
    const result = await exposedAPI.getScheduledTasks();
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].name).toBe('Daily Report');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('scheduler:list');
  });

  it('should complete addScheduledTask IPC chain', async () => {
    const result = await exposedAPI.addScheduledTask('New Task', '*/5 * * * *', 'echo run');
    expect(result).toEqual({ id: 'task_99999' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('scheduler:add', {
      name: 'New Task',
      cron: '*/5 * * * *',
      action: 'echo run',
    });
  });

  it('should reject scheduler:add with missing fields', async () => {
    const result = await exposedAPI.addScheduledTask('', '', '');
    expect(result).toHaveProperty('error');
  });

  // ─── heartbeat:status ───────────────────────

  it('should complete getHeartbeatStatus IPC chain', async () => {
    const result = await exposedAPI.getHeartbeatStatus();
    expect(result.healthy).toBe(true);
    expect(result.checks).toEqual({ llm: true, disk: true, memory: true });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('heartbeat:status');
  });

  // ─── queue:stats ────────────────────────────

  it('should complete getQueueStats IPC chain', async () => {
    const result = await exposedAPI.getQueueStats();
    expect(result.pending).toBe(2);
    expect(result.running).toBe(1);
    expect(result.completed).toBe(100);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('queue:stats');
  });
});
