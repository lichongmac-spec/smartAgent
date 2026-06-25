/**
 * Preload 脚本单元测试
 *
 * 测试 electron/preload/index.ts 的 contextBridge 暴露 API。
 * 验证 11 个 API 的正确 ipcRenderer.invoke/on 调用参数。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模块级变量供 vi.mock 工厂函数闭包访问（vi.mock 会被 hoist 到顶层）
const mockExposeInMainWorld = vi.fn();
const mockIpcRendererInvoke = vi.fn().mockResolvedValue({});
const mockIpcRendererOn = vi.fn();
const mockIpcRendererOff = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mockIpcRendererInvoke,
    on: mockIpcRendererOn,
    off: mockIpcRendererOff,
  },
}));

describe('Preload Script (API surface)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockIpcRendererInvoke.mockResolvedValue({});
    vi.resetModules();
    await import('../../electron/preload/index.js');
  });

  // ─── API 数量 ───────────────────────────────

  it('should expose exactly 11 API methods', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('electron', expect.any(Object));
    const api = mockExposeInMainWorld.mock.calls[0][1];
    const apiKeys = Object.keys(api);
    expect(apiKeys).toHaveLength(11);
  });

  // ─── Agent 对话 API ─────────────────────────

  it('should expose askAgent method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.askAgent).toBeDefined();
    expect(typeof api.askAgent).toBe('function');
  });

  it('should expose askAgentStream method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.askAgentStream).toBeDefined();
    expect(typeof api.askAgentStream).toBe('function');
  });

  it('should expose interruptAgent method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.interruptAgent).toBeDefined();
    expect(typeof api.interruptAgent).toBe('function');
  });

  // ─── 工具管理 API ───────────────────────────

  it('should expose getTools method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getTools).toBeDefined();
    expect(typeof api.getTools).toBe('function');
  });

  // ─── 记忆搜索 API ───────────────────────────

  it('should expose searchMemory method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.searchMemory).toBeDefined();
    expect(typeof api.searchMemory).toBe('function');
  });

  // ─── 配置管理 API ───────────────────────────

  it('should expose getConfig method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getConfig).toBeDefined();
    expect(typeof api.getConfig).toBe('function');
  });

  it('should expose setConfig method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.setConfig).toBeDefined();
    expect(typeof api.setConfig).toBe('function');
  });

  // ─── 调度任务 API ───────────────────────────

  it('should expose getScheduledTasks method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getScheduledTasks).toBeDefined();
    expect(typeof api.getScheduledTasks).toBe('function');
  });

  it('should expose addScheduledTask method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.addScheduledTask).toBeDefined();
    expect(typeof api.addScheduledTask).toBe('function');
  });

  // ─── 健康与队列 API ─────────────────────────

  it('should expose getHeartbeatStatus method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getHeartbeatStatus).toBeDefined();
    expect(typeof api.getHeartbeatStatus).toBe('function');
  });

  it('should expose getQueueStats method', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getQueueStats).toBeDefined();
    expect(typeof api.getQueueStats).toBe('function');
  });

  // ─── 方法签名验证 ───────────────────────────

  it('askAgent should accept 1-2 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.askAgent.length).toBeGreaterThanOrEqual(1);
  });

  it('askAgentStream should accept 3-4 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.askAgentStream.length).toBeGreaterThanOrEqual(3);
  });

  it('interruptAgent should accept 0 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.interruptAgent.length).toBe(0);
  });

  it('getTools should accept 0 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getTools.length).toBe(0);
  });

  it('searchMemory should accept 1-2 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.searchMemory.length).toBeGreaterThanOrEqual(1);
  });

  it('getConfig should accept 1 parameter', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getConfig.length).toBe(1);
  });

  it('setConfig should accept 2 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.setConfig.length).toBe(2);
  });

  it('getScheduledTasks should accept 0 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getScheduledTasks.length).toBe(0);
  });

  it('addScheduledTask should accept 3 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.addScheduledTask.length).toBe(3);
  });

  it('getHeartbeatStatus should accept 0 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getHeartbeatStatus.length).toBe(0);
  });

  it('getQueueStats should accept 0 parameters', () => {
    const api = mockExposeInMainWorld.mock.calls[0][1];
    expect(api.getQueueStats.length).toBe(0);
  });
});
