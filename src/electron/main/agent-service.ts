/**
 * AgentService — SmartAgent 核心能力封装
 *
 * 负责在主进程中管理 LoopEngine / DeepSeek LLM / ToolRegistry / ContextManager，
 * 作为 IPC 通道的统一入口。采用单例 + 懒加载模式。
 *
 * 与 LoopEngine 的集成：
 *   - ask()        → engine.run()       非流式
 *   - askStream()  → engine.runStream()  流式（AsyncGenerator）
 *   - interrupt()  → engine.interrupt()  中断
 */

import * as fs from 'fs';
import * as path from 'path';
import { LoopEngine } from '../../agent/core/loop-engine.js';
import { DeepSeekClient } from '../../agent/llm/openai-client.js';
import { createDefaultToolRegistry } from '../../agent/tools/builtin/index.js';
import { ContextManager } from '../../agent/context/context-manager.js';
import type { ILLMClient } from '../../agent/llm/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** 读取 DeepSeek API Key：优先环境变量 → .smartagentrc.local.json */
function resolveApiKey(): string {
  // 1. 环境变量
  const envKey = process.env.DEEPSEEK_API_KEY || process.env.AGENT_API_KEY;
  if (envKey) return envKey;

  // 2. 本地配置文件
  try {
    const rcPath = path.resolve(process.cwd(), '.smartagentrc.local.json');
    if (fs.existsSync(rcPath)) {
      const raw = fs.readFileSync(rcPath, 'utf-8');
      const parsed = JSON.parse(raw) as AnyRecord;
      if (parsed.apiKey && typeof parsed.apiKey === 'string' && parsed.apiKey !== 'YOUR_DEEPSEEK_API_KEY') {
        return parsed.apiKey;
      }
    }
  } catch {
    // 配置读取失败，继续降级
  }

  return '';
}

export class AgentService {
  private static instance: AgentService;
  private engine: LoopEngine | null = null;
  private llm: ILLMClient | null = null;
  private contextManager: ContextManager;
  private ready = false;
  private initError: string | null = null;

  static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  private constructor() {
    this.contextManager = new ContextManager('你是一个智能桌面助手。请用中文回答用户的问题。');
  }

  /** 延迟初始化 LoopEngine（首次调用 ask/askStream 时触发） */
  private async initEngine(): Promise<LoopEngine> {
    if (this.engine) return this.engine;

    try {
      const apiKey = resolveApiKey();
      if (!apiKey) {
        this.initError = '未找到 DeepSeek API Key。请设置环境变量 DEEPSEEK_API_KEY 或在 .smartagentrc.local.json 中配置 apiKey。';
        throw new Error(this.initError);
      }

      console.log('[AgentService] 初始化 DeepSeek 客户端...');
      this.llm = new DeepSeekClient({
        apiKey,
        model: process.env.AGENT_MODEL || 'deepseek-v4-flash',
      });

      const tools = createDefaultToolRegistry(false);
      this.engine = new LoopEngine(this.llm, tools, {
        maxSteps: 10,
        verbose: false,
        contextManager: this.contextManager,
        injectHistory: true, // 交互模式：保留多轮对话历史
        maxContextTokens: 8000,
      });

      this.ready = true;
      console.log('[AgentService] LoopEngine 初始化完成 ✓');
      return this.engine;
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      console.error('[AgentService] 初始化失败:', this.initError);
      throw err;
    }
  }

  // ─── Agent 对话 ─────────────────────────────

  async ask(prompt: string, _sessionId?: string): Promise<string> {
    const engine = await this.initEngine();
    const answer = await engine.run(prompt);
    return answer;
  }

  async askStream(
    prompt: string,
    _sessionId: string | undefined,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const engine = await this.initEngine();

    // 使用 AsyncGenerator 流式输出
    for await (const chunk of engine.runStream(prompt)) {
      onChunk(chunk);
    }
  }

  interrupt(): void {
    if (this.engine) {
      this.engine.interrupt();
    }
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
    // TODO: 接入 MemoryManager
    return [];
  }

  // ─── 配置管理 ───────────────────────────────

  getConfig(key: string): unknown {
    const store: AnyRecord = { provider: 'deepseek', model: process.env.AGENT_MODEL || 'deepseek-v4-flash' };
    return store[key] ?? null;
  }

  setConfig(_key: string, _value: unknown): void {
    // TODO: 接入 ConfigManager
  }

  // ─── 调度任务 ───────────────────────────────

  getScheduledTasks(): Array<{ id: string; name: string; cron: string; enabled: boolean }> {
    return [];
  }

  addScheduledTask(name: string, cron: string, action: string): string {
    const id = `task_${Date.now()}`;
    console.log(`[AgentService] Scheduled task added: ${name} (${cron}) → ${action}`);
    return id;
  }

  // ─── 健康状态 ───────────────────────────────

  getHealthStatus(): { healthy: boolean; checks: AnyRecord } {
    return {
      healthy: this.ready,
      checks: {
        engine: this.ready ? 'ready' : (this.initError || 'not initialized'),
      },
    };
  }

  // ─── 队列统计 ───────────────────────────────

  getQueueStats(): { pending: number; running: number; completed: number } {
    return { pending: 0, running: 0, completed: 0 };
  }
}
