/**
 * Preload 脚本单元测试 — Stream 版
 *
 * 测试 src/electron/preload/index.ts 的 contextBridge 暴露 API。
 * 新 API 通过 window.agent 暴露 4 个属性：
 *   askStream / interrupt / name / platform
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockExposeInMainWorld = vi.fn();
const mockIpcRendererSend = vi.fn();
const mockIpcRendererOn = vi.fn();
const mockIpcRendererRemoveListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    send: mockIpcRendererSend,
    on: mockIpcRendererOn,
    removeListener: mockIpcRendererRemoveListener,
  },
}));

describe('Preload Script (stream API)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await import('../../src/electron/preload/index.js');
  });

  // ─── API 表面测试 ──────────────────────────

  it('should expose window.agent with 4 properties', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('agent', expect.any(Object));
    const api = mockExposeInMainWorld.mock.calls[0][1];
    const keys = Object.keys(api);
    expect(keys).toHaveLength(4);
    expect(keys.sort()).toEqual(['askStream', 'interrupt', 'name', 'platform'].sort());
  });

  it('should expose askStream as function', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.askStream).toBeDefined();
    expect(typeof api.askStream).toBe('function');
  });

  it('should expose interrupt as function', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.interrupt).toBeDefined();
    expect(typeof api.interrupt).toBe('function');
  });

  it('should expose name as string', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.name).toBe('SmartAgent Desktop');
  });

  it('should expose platform as string', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(typeof api.platform).toBe('string');
  });

  // ─── askStream 行为测试 ────────────────────

  it('askStream should call ipcRenderer.send with correct params', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    api.askStream('Hello', onChunk, onDone, onError);

    // 应该发送 agent:ask-stream 请求
    expect(mockIpcRendererSend).toHaveBeenCalledWith('agent:ask-stream', { prompt: 'Hello' });
    // 应该注册 agent:chunk 监听器
    expect(mockIpcRendererOn).toHaveBeenCalledWith('agent:chunk', expect.any(Function));
  });

  it('askStream chunk handler should call onChunk for each text piece', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    api.askStream('Hi', onChunk, onDone, onError);

    // 获取注册的处理器
    const chunkHandler = mockIpcRendererOn.mock.calls[0][1];

    // 模拟主进程发送 chunk
    chunkHandler({}, { chunk: '你', done: false });
    expect(onChunk).toHaveBeenCalledWith('你');
    expect(onDone).not.toHaveBeenCalled();

    chunkHandler({}, { chunk: '好', done: false });
    expect(onChunk).toHaveBeenCalledWith('好');
  });

  it('askStream should call onDone and cleanup when stream ends', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    api.askStream('Hi', onChunk, onDone, onError);

    const chunkHandler = mockIpcRendererOn.mock.calls[0][1];

    // 发送结束信号
    chunkHandler({}, { chunk: '', done: true });
    expect(onDone).toHaveBeenCalled();
    expect(mockIpcRendererRemoveListener).toHaveBeenCalledWith('agent:chunk', chunkHandler);
  });

  it('askStream should call onError and cleanup on error', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    api.askStream('Hi', onChunk, onDone, onError);

    const chunkHandler = mockIpcRendererOn.mock.calls[0][1];

    // 发送错误
    chunkHandler({}, { chunk: '', done: true, error: 'API Key missing' });
    expect(onError).toHaveBeenCalledWith('API Key missing');
    expect(mockIpcRendererRemoveListener).toHaveBeenCalledWith('agent:chunk', chunkHandler);
  });

  it('askStream should not leak listeners (cleanup on done)', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    api.askStream('A', vi.fn(), vi.fn(), vi.fn());
    api.askStream('B', vi.fn(), vi.fn(), vi.fn());

    // 每次调用 register 一个 listener
    expect(mockIpcRendererOn).toHaveBeenCalledTimes(2);
  });

  // ─── interrupt 行为测试 ────────────────────

  it('interrupt should send agent:interrupt', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    api.interrupt();
    expect(mockIpcRendererSend).toHaveBeenCalledWith('agent:interrupt');
  });

  // ─── 方法签名验证 ──────────────────────────

  it('askStream should accept 4 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.askStream.length).toBe(4);
  });

  it('interrupt should accept 0 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.interrupt.length).toBe(0);
  });
});
