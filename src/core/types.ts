/**
 * types.ts - Loop 引擎类型定义
 *
 * 理解：就像"做菜的流程规范"——定义每个阶段的状态和配置。
 *
 * 注意：Message、ToolCall、ToolDefinition 等基础类型复用 llm 层，
 * 本文件只定义 Loop 引擎独有的类型。
 */

import type { ToolCall } from '../llm/types.js';
import type { ContextManager } from '../context/context-manager.js';

// ============================================================
//  1. Loop 引擎状态
// ============================================================

/**
 * Loop 引擎的当前状态
 *
 * 理解：就像做菜进行到哪一步了
 */
export type LoopStatus = 'idle' | 'thinking' | 'acting' | 'done' | 'error';

/**
 * 单步记录：思考 → 行动 → 观察
 *
 * 理解：每一步做了什么，都记下来，方便回顾
 */
export interface StepRecord {
  /** AI 的思考内容 */
  thought: string;
  /** AI 调用的工具（如果没有则为 undefined） */
  action?: ToolCall;
  /** 工具返回的观察结果（如果没有则为 undefined） */
  observation?: string;
  /** 此步发生的时间 */
  timestamp: Date;
}

/**
 * Loop 引擎完整状态
 *
 * 理解：就像做菜的"进度面板"
 */
export interface LoopState {
  /** 当前状态 */
  status: LoopStatus;
  /** 当前步骤数（第几步） */
  step: number;
  /** 最大步骤数（防止死循环） */
  maxSteps: number;
  /** 已消耗的 Token 数（估算） */
  tokensUsed: number;
  /** 思考-行动-观察的历史记录 */
  history: StepRecord[];
  /** 最终回答 */
  finalAnswer?: string;
  /** 循环开始时间 */
  startedAt: Date;
  /** 循环结束时间（done/error 后设置） */
  finishedAt?: Date;
}

// ============================================================
//  2. Loop 引擎配置
// ============================================================

/**
 * Loop 引擎配置
 *
 * 理解：就像做菜前设置"火候偏好"、"时间限制"
 */
export interface LoopConfig {
  /** 最大步骤数，默认 10 */
  maxSteps?: number;
  /** LLM 调用最大重试次数，默认 3 */
  maxRetries?: number;
  /** 系统提示词（AI 的"人设"和"工作方式"） */
  systemPrompt?: string;
  /** 是否在每一步打印日志 */
  verbose?: boolean;
  /** 是否在用户消息前注入历史上下文 */
  injectHistory?: boolean;
  /** 上下文管理器（可选，用于跨 run() 调用保持对话记忆） */
  contextManager?: ContextManager;
  /** Token 上限，超出后自动裁剪上下文（默认 0 = 不限制） */
  maxContextTokens?: number;
}

// ============================================================
//  3. 回调类型
// ============================================================

/**
 * 步骤回调函数
 *
 * 理解：每一步执行时通知外部（用于 UI 更新、日志等）
 */
export type StepCallback = (state: Readonly<LoopState>) => void;
