/**
 * AgentService 单元测试 — DeepSeek 集成版
 *
 * 测试 src/electron/main/agent-service.ts 的核心逻辑。
 * LoopEngine / DeepSeekClient / ContextManager 均被 mock，
 * 不发起真实网络请求，不 mock fs（通过环境变量控制 API Key）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── vi.hoisted: 共享 mock 实例 ──
const { mockEngine, mockToolRegistry, mockContextManagerObj } = vi.hoisted(() => ({
  mockEngine: {
    run: vi.fn(),
    runStream: vi.fn(),
    interrupt: vi.fn(),
    getState: vi.fn().mockReturnValue({ status: 'idle', step: 0 }),
  },
  mockToolRegistry: {
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
    get: vi.fn(),
  },
  mockContextManagerObj: {
    append: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getSystemPrompt: vi.fn().mockReturnValue(''),
    clear: vi.fn(),
    reset: vi.fn(),
  },
}));

// Mutable engine behavior
let engineRunResult = 'Mock AI answer.';
let engineStreamChunks: string[] = ['Hello', ' ', 'World'];

function resetEngine(): void {
  engineRunResult = 'Mock AI answer.';
  engineStreamChunks = ['Hello', ' ', 'World'];
  mockEngine.run.mockReset().mockImplementation(async (): Promise<string> => engineRunResult);
  mockEngine.runStream.mockReset().mockImplementation(async function* () {
    for (const c of engineStreamChunks) yield c;
  });
  mockEngine.interrupt.mockReset();
}

// ── vi.mock ──

vi.mock('../../src/agent/llm/openai-client.js', () => ({
  DeepSeekClient: vi.fn(function (this: Record<string, unknown>, config: unknown) {
    this.chat = vi.fn();
    this.config = config;
  }),
}));

vi.mock('../../src/agent/tools/builtin/index.js', () => ({
  createDefaultToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
}));

vi.mock('../../src/agent/context/context-manager.js', () => ({
  ContextManager: vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, mockContextManagerObj);
  }),
}));

vi.mock('../../src/agent/core/loop-engine.js', () => ({
  LoopEngine: vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, mockEngine);
  }),
}));

import { AgentService } from '../../src/electron/main/agent-service.js';

describe('AgentService (DeepSeek 集成)', () => {
  let agentService: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetEngine();
    (AgentService as unknown as { instance: AgentService | null }).instance = null;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_MODEL;
    agentService = AgentService.getInstance();
  });

  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_MODEL;
  });

  // ═══════════════════════════════════════════
  // 基础属性（无需 engine）
  // ═══════════════════════════════════════════

  it('singleton', () => {
    expect(AgentService.getInstance()).toBe(AgentService.getInstance());
  });

  it('provider is deepseek', () => {
    expect(agentService.getConfig('provider')).toBe('deepseek');
  });

  it('model defaults to deepseek-v4-flash', () => {
    expect(agentService.getConfig('model')).toBe('deepseek-v4-flash');
  });

  it('model from AGENT_MODEL env', () => {
    process.env.AGENT_MODEL = 'deepseek-v4-pro';
    (AgentService as unknown as { instance: AgentService | null }).instance = null;
    expect(AgentService.getInstance().getConfig('model')).toBe('deepseek-v4-pro');
  });

  it('unknown config key → null', () => {
    expect(agentService.getConfig('nonexistent')).toBeNull();
  });

  it('unhealthy before engine init', () => {
    const s = agentService.getHealthStatus();
    expect(s.healthy).toBe(false);
  });

  it('4 tools', () => {
    const names = agentService.getTools().map(t => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['read_file', 'write_file', 'search_web', 'calculator'])
    );
    expect(agentService.getTools()).toHaveLength(4);
  });

  it('tools enabled', () => {
    for (const t of agentService.getTools()) expect(t.enabled).toBe(true);
  });

  it('empty memory', () => expect(agentService.searchMemory('x', 10)).toEqual([]));
  it('setConfig no throw', () => expect(() => agentService.setConfig('k', 'v')).not.toThrow());
  it('empty scheduled tasks', () => expect(agentService.getScheduledTasks()).toEqual([]));

  it('addScheduledTask returns id', () => {
    expect(agentService.addScheduledTask('T', '* * * * *', 'cmd')).toMatch(/^task_\d+$/);
  });

  it('zero queue stats', () => {
    expect(agentService.getQueueStats()).toEqual({ pending: 0, running: 0, completed: 0 });
  });

  // ═══════════════════════════════════════════
  // ask() — needs API key + engine
  // ═══════════════════════════════════════════

  describe('ask()', () => {
    beforeEach(() => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      agentService = AgentService.getInstance();
    });

    it('returns engine answer', async () => {
      expect(await agentService.ask('What is AI?')).toBe('Mock AI answer.');
    });

    it('throws without API key', async () => {
      delete process.env.DEEPSEEK_API_KEY;
      // Also ensure no fallback env vars
      delete process.env.AGENT_API_KEY;
      delete process.env.AGENT_MODEL;
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      await expect(AgentService.getInstance().ask('Hi')).rejects.toThrow(/API Key/);
    });

    it('becomes healthy after init', async () => {
      await agentService.ask('Hi');
      expect(agentService.getHealthStatus().healthy).toBe(true);
    });

    it('uses DEEPSEEK_API_KEY', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-env';
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      await AgentService.getInstance().ask('Hi');
      const { DeepSeekClient } = await import('../../src/agent/llm/openai-client.js');
      expect(DeepSeekClient).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-env' })
      );
    });

    it('falls back to AGENT_API_KEY', async () => {
      delete process.env.DEEPSEEK_API_KEY; // clear higher-priority var
      process.env.AGENT_API_KEY = 'sk-agent';
      delete process.env.AGENT_MODEL;
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      await AgentService.getInstance().ask('Hi');
      const { DeepSeekClient } = await import('../../src/agent/llm/openai-client.js');
      expect(DeepSeekClient).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-agent' })
      );
    });
  });

  // ═══════════════════════════════════════════
  // askStream()
  // ═══════════════════════════════════════════

  describe('askStream()', () => {
    beforeEach(() => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      agentService = AgentService.getInstance();
    });

    it('streams chunks', async () => {
      const chunks: string[] = [];
      await agentService.askStream('Hi', undefined, c => chunks.push(c));
      expect(chunks).toEqual(['Hello', ' ', 'World']);
    });

    it('handles empty stream', async () => {
      engineStreamChunks = [];
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      const chunks: string[] = [];
      await AgentService.getInstance().askStream('Hi', undefined, c => chunks.push(c));
      expect(chunks).toEqual([]);
    });

    it('interrupt calls engine.interrupt()', async () => {
      let first = true;
      await agentService.askStream('Hi', undefined, () => {
        if (first) { first = false; agentService.interrupt(); }
      });
      expect(mockEngine.interrupt).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════
  // interrupt()
  // ═══════════════════════════════════════════

  describe('interrupt()', () => {
    it('no throw before init', () => {
      expect(() => agentService.interrupt()).not.toThrow();
    });

    it('delegates to engine after init', async () => {
      process.env.DEEPSEEK_API_KEY = 'sk-test';
      (AgentService as unknown as { instance: AgentService | null }).instance = null;
      const svc = AgentService.getInstance();
      await svc.ask('Hi');
      svc.interrupt();
      expect(mockEngine.interrupt).toHaveBeenCalled();
    });
  });
});
