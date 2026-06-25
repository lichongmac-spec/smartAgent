/**
 * AgentService 单元测试
 *
 * 测试 electron/main/agent-service.ts 的核心逻辑。
 * 覆盖：单例模式、ask/askStream/interrupt、工具列表、
 * 配置读写、调度任务、健康状态、队列统计。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentService } from '../../electron/main/agent-service.js';

describe('AgentService', () => {
  let agentService: AgentService;

  beforeEach(() => {
    // AgentService 是单例，但每个测试前重置 interrupted 状态
    agentService = AgentService.getInstance();
    // 通过 interrupt + 等待 让 interrupted 复位
    // 直接通过公共方法测试，不访问私有状态
  });

  // ─── 单例模式 ─────────────────────────────

  it('should return the same instance (singleton)', () => {
    const a = AgentService.getInstance();
    const b = AgentService.getInstance();
    expect(a).toBe(b);
  });

  // ─── ask ──────────────────────────────────

  it('should return placeholder response from ask()', async () => {
    const answer = await agentService.ask('Hello');
    expect(answer).toContain('Hello');
    expect(answer).toContain('Placeholder');
  });

  it('should return placeholder even with empty prompt', async () => {
    const answer = await agentService.ask('');
    expect(answer).toContain('Placeholder');
  });

  it('should accept optional sessionId parameter', async () => {
    const answer = await agentService.ask('Test', 'session-123');
    expect(answer).toContain('Test');
  });

  // ─── askStream ─────────────────────────────

  it('should emit chunks via onChunk callback', async () => {
    const chunks: string[] = [];
    await agentService.askStream('Hello World', undefined, (chunk) => {
      chunks.push(chunk);
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.includes('Hello'))).toBe(true);
    expect(chunks.some((c) => c.includes('Done'))).toBe(true);
  });

  it('should respect interrupt during streaming', async () => {
    const chunks: string[] = [];

    // 在第一个 chunk 之后立即 interrupt
    let firstChunk = true;
    const streamPromise = agentService.askStream('Hello World', undefined, (chunk) => {
      chunks.push(chunk);
      if (firstChunk) {
        firstChunk = false;
        agentService.interrupt();
      }
    });

    await streamPromise;

    expect(chunks.some((c) => c.includes('Interrupted'))).toBe(true);
  });

  it('should reset interrupted flag after stream completes', async () => {
    // First stream: interrupt
    let interrupted = false;
    await agentService.askStream('First', undefined, () => {
      if (!interrupted) {
        interrupted = true;
        agentService.interrupt();
      }
    });

    // Second stream: should NOT be interrupted
    const chunks: string[] = [];
    await agentService.askStream('Second', undefined, (chunk) => {
      chunks.push(chunk);
    });

    expect(chunks.some((c) => c.includes('Interrupted'))).toBe(false);
    expect(chunks.some((c) => c.includes('Done'))).toBe(true);
  });

  // ─── interrupt ─────────────────────────────

  it('should set interrupted flag via interrupt()', () => {
    // Interrupt first
    agentService.interrupt();

    // Next stream should show interrupted
    // (tested above, just verify method exists and doesn't throw)
    expect(() => agentService.interrupt()).not.toThrow();
  });

  // ─── 工具管理 ───────────────────────────────

  it('should return tool list with 4 built-in tools', () => {
    const tools = agentService.getTools();
    expect(tools).toHaveLength(4);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('description');
    expect(tools[0]).toHaveProperty('enabled');
    expect(tools[0].enabled).toBe(true);
  });

  it('should include read_file, write_file, search_web, calculator', () => {
    const tools = agentService.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('search_web');
    expect(names).toContain('calculator');
  });

  // ─── 记忆搜索 ───────────────────────────────

  it('should return empty memory results', () => {
    const memories = agentService.searchMemory('anything', 10);
    expect(memories).toEqual([]);
  });

  // ─── 配置管理 ───────────────────────────────

  it('should return config value for known keys', () => {
    expect(agentService.getConfig('provider')).toBe('mock');
    expect(agentService.getConfig('model')).toBe('default');
  });

  it('should return null for unknown config keys', () => {
    expect(agentService.getConfig('nonexistent')).toBeNull();
  });

  it('should not throw on setConfig', () => {
    expect(() => agentService.setConfig('key', 'value')).not.toThrow();
  });

  // ─── 调度任务 ───────────────────────────────

  it('should return empty scheduled tasks list', () => {
    const tasks = agentService.getScheduledTasks();
    expect(tasks).toEqual([]);
  });

  it('should generate a task id on addScheduledTask', () => {
    const id = agentService.addScheduledTask('Test', '* * * * *', 'echo hi');
    expect(id).toMatch(/^task_\d+$/);
  });

  // ─── 健康状态 ───────────────────────────────

  it('should return healthy status', () => {
    const status = agentService.getHealthStatus();
    expect(status.healthy).toBe(true);
    expect(status.checks).toEqual({});
  });

  // ─── 队列统计 ───────────────────────────────

  it('should return zero queue stats', () => {
    const stats = agentService.getQueueStats();
    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
  });
});
