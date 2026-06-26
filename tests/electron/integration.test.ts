/**
 * Electron 集成测试 — Stream 版
 *
 * 测试 IPC 完整链路：preload API → ipcMain handler → agent-service → 返回。
 * 新链路基于流式通信：
 *   window.agent.askStream → ipcRenderer.send('agent:ask-stream') → on('agent:chunk')
 *   window.agent.interrupt → ipcRenderer.send('agent:interrupt')
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock AgentService ────────────────────────

vi.mock('../../src/electron/main/agent-service.js', () => ({
  AgentService: {
    getInstance: () => ({
      ask: vi.fn().mockResolvedValue('[Agent] Hello World'),
      askStream: vi.fn().mockImplementation(
        async (_prompt: string, _sid: string | undefined, onChunk: (c: string) => void) => {
          onChunk('你好');
          onChunk('，');
          onChunk('世界');
        }
      ),
      interrupt: vi.fn(),
      getTools: vi.fn().mockReturnValue([
        { name: 'read_file', description: 'Read a file', enabled: true },
      ]),
      searchMemory: vi.fn().mockReturnValue([]),
      getConfig: vi.fn().mockImplementation((key: string) => {
        const store: Record<string, unknown> = { provider: 'deepseek', model: 'deepseek-v4-flash' };
        return store[key] ?? null;
      }),
      setConfig: vi.fn(),
      getScheduledTasks: vi.fn().mockReturnValue([]),
      addScheduledTask: vi.fn().mockReturnValue('task_99999'),
      getHealthStatus: vi.fn().mockReturnValue({ healthy: true, checks: {} }),
      getQueueStats: vi.fn().mockReturnValue({ pending: 0, running: 0, completed: 0 }),
    }),
  },
}));

// ─── Mock Electron — 模块级变量供 vi.mock 闭包 ──

const mockIpcRendererSend = vi.fn();
const mockIpcRendererOn = vi.fn();
const mockIpcRendererRemoveListener = vi.fn();
const mockContextBridgeExpose = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockContextBridgeExpose },
  ipcRenderer: {
    send: mockIpcRendererSend,
    on: mockIpcRendererOn,
    removeListener: mockIpcRendererRemoveListener,
  },
}));

import { registerIpcHandlers } from '../../src/electron/main/ipc-handlers.js';

describe('Electron Integration — Stream IPC Chain', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exposedAPI: any;
  // Store ipcRenderer.on callbacks per channel for event dispatching
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rendererOnHandlers: Record<string, (...args: any[]) => void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    rendererOnHandlers = {};

    // Wire ipcRenderer.on to store callbacks
    mockIpcRendererOn.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => void) => {
        rendererOnHandlers[channel] = handler;
      }
    );

    // Wire ipcRenderer.removeListener to clear callbacks
    mockIpcRendererRemoveListener.mockImplementation(
      (channel: string) => {
        delete rendererOnHandlers[channel];
      }
    );

    // Build IPC handler map from ipc-handlers.ts
    const ipcOnHandlers: Record<string, (...args: unknown[]) => void> = {};
    const ipcHandleHandlers: Record<string, (...args: unknown[]) => unknown> = {};

    const mockIpcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandleHandlers[channel] = handler;
      }),
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        ipcOnHandlers[channel] = handler;
      }),
    } as unknown as Electron.IpcMain;

    registerIpcHandlers(mockIpcMain);

    // Wire ipcRenderer.send to dispatch through main process on-handlers
    mockIpcRendererSend.mockImplementation(
      (channel: string, ...args: unknown[]) => {
        // Try on-handlers first (streaming channels)
        const onHandler = ipcOnHandlers[channel];
        if (onHandler) {
          // Create sender that dispatches back to renderer listeners
          const sender = {
            send: (respChannel: string, ...respArgs: unknown[]) => {
              const rendererHandler = rendererOnHandlers[respChannel];
              if (rendererHandler) {
                rendererHandler({}, ...respArgs);
              }
            },
          };
          const mockEvent = { sender };
          // await async handler so stream-end events dispatch
          const handlerResult = onHandler(mockEvent, args[0]);
          if (handlerResult instanceof Promise) await handlerResult;
          return;
        }
        // fallback: handle-based channels
        const handleHandler = ipcHandleHandlers[channel];
        if (handleHandler) {
          handleHandler({}, args[0]);
        }
      }
    );

    // Reload preload to capture exposed API
    vi.resetModules();
    await import('../../src/electron/preload/index.js');

    const callArgs = mockContextBridgeExpose.mock.calls.find(
      (call: unknown[]) => call[0] === 'agent'
    );
    exposedAPI = callArgs ? callArgs[1] : null;
  });

  // ─── askStream 完整链路 ─────────────────────

  it('should complete askStream IPC chain', () => {
    const chunks: string[] = [];
    const onChunk = (text: string) => chunks.push(text);
    const onDone = vi.fn();
    const onError = vi.fn();

    exposedAPI.askStream('Hello', onChunk, onDone, onError);

    // Stream is synchronous in our mock — chunks should already be received
    expect(chunks).toEqual(['你好', '，', '世界']);
  });

  it('should send correct IPC message for askStream', () => {
    exposedAPI.askStream('Test prompt', vi.fn(), vi.fn(), vi.fn());
    expect(mockIpcRendererSend).toHaveBeenCalledWith(
      'agent:ask-stream',
      { prompt: 'Test prompt' }
    );
  });

  it('should register chunk listener on askStream', () => {
    exposedAPI.askStream('Hi', vi.fn(), vi.fn(), vi.fn());
    expect(mockIpcRendererOn).toHaveBeenCalledWith('agent:chunk', expect.any(Function));
  });

  it('should clean up listener and call onDone on stream end', () => {
    const onChunk = vi.fn();
    const onDone = vi.fn();

    exposedAPI.askStream('Hi', onChunk, onDone, vi.fn());

    // onDone should be called when stream ends
    expect(onDone).toHaveBeenCalled();
    expect(mockIpcRendererRemoveListener).toHaveBeenCalledWith('agent:chunk', expect.any(Function));
  });

  // ─── error handling ─────────────────────────

  it('should call onError and cleanup on error', () => {
    // Override ipcOnHandlers for this test to simulate error
    // Actually, since our mock AgentService always succeeds, we test this
    // indirectly: if the ipc-handlers.ts returns an error, the preload's
    // chunk handler calls onError. Let's manually invoke the chunk handler
    // to verify error path.

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    exposedAPI.askStream('Error case', onChunk, onDone, onError);

    // Get the registered chunk handler
    const chunkHandler = rendererOnHandlers['agent:chunk'];
    expect(chunkHandler).toBeDefined();

    // Call it directly with error data (simulating main process error response)
    chunkHandler({}, { chunk: '', done: true, error: 'API Key missing' });

    expect(onError).toHaveBeenCalledWith('API Key missing');
  });

  // ─── interrupt 完整链路 ─────────────────────

  it('should complete interrupt IPC chain', () => {
    exposedAPI.interrupt();
    expect(mockIpcRendererSend).toHaveBeenCalledWith('agent:interrupt');
  });

  // ─── name / platform ────────────────────────

  it('should expose app name', () => {
    expect(exposedAPI.name).toBe('SmartAgent Desktop');
  });

  it('should expose platform', () => {
    expect(typeof exposedAPI.platform).toBe('string');
  });

  // ─── interrupt sends correct message ────────

  it('should call interrupt via IPC', () => {
    exposedAPI.interrupt();
    expect(mockIpcRendererSend).toHaveBeenCalledTimes(1);
    expect(mockIpcRendererSend).toHaveBeenCalledWith('agent:interrupt');
  });
});
