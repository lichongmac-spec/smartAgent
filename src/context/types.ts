/**
 * types.ts - 上下文管理专用类型定义
 *
 * 理解：定义"聊天记录"的格式
 *
 * Message 类型从 llm 层复用（不重复定义），这里只定义上下文管理专有的类型。
 *
 * 使用方式：
 *   import type { ContextStats } from './types.js';
 */

// 从 llm 层复用 Message 定义
export type { Message, MessageRole } from '../llm/types.js';

/**
 * 上下文统计信息
 *
 * 理解：就像微信的"聊天记录统计"
 * 显示：有多少条消息、多少个字、估算多少 Token
 */
export interface ContextStats {
  /** 消息总数 */
  messageCount: number;
  /** 各角色的消息数量 */
  byRole: {
    user: number;
    assistant: number;
    system: number;
    tool: number;
  };
  /** 估算 Token 数 */
  estimatedTokens: number;
  /** 总字符数 */
  totalChars: number;
}
