/**
 * types.ts — LoopEngine 核心类型定义
 */

import type { ContextManager } from '../context/context-manager.js';
import type { ToolCall } from '../llm/types.js';

// ── LoopConfig ──────────────────────────────

export interface LoopConfig {
  /** 最大思考-行动步数（默认 10） */
  maxSteps?: number;
  /** 最大 LLM 调用重试次数（默认 3） */
  maxRetries?: number;
  /** 自定义系统提示词，可用 {tools_description} 占位 */
  systemPrompt?: string;
  /** 是否打印日志（默认 true） */
  verbose?: boolean;
  /**
   * 交互模式：true 只注入历史对话（不含系统消息），
   * false（默认）恢复完整上下文
   */
  injectHistory?: boolean;
  /** 上下文 Token 上限，0 = 不裁剪 */
  maxContextTokens?: number;
  /** 可选：上下文管理器实例（用于多轮对话） */
  contextManager?: ContextManager;
}

// ── LoopState ───────────────────────────────

export type LoopStatus = 'idle' | 'thinking' | 'acting' | 'done' | 'error';

/** 一次 ReAct 步骤的历史记录 */
export interface StepRecord {
  thought: string;
  action?: ToolCall;
  observation?: string;
  timestamp: Date;
}

export interface LoopState {
  status: LoopStatus;
  step: number;
  maxSteps: number;
  tokensUsed: number;
  history: StepRecord[];
  startedAt: Date;
  finishedAt?: Date;
  finalAnswer?: string;
}

// ── StepCallback ────────────────────────────

export type StepCallback = (state: Readonly<LoopState>) => void;
