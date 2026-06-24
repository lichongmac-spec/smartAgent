/**
 * skills/types.ts — Skills 可插拔技能包接口定义
 *
 * 理解：一个 Skill 就是一个"功能包"，包含工具、钩子、元数据。
 * 就像手机 App —— 独立开发，放到指定文件夹即可自动加载。
 */

import type { ToolDefinition } from '../llm/types.js';
import type { ToolExecutor } from '../tools/registry.js';

// ============================================================
//  钩子接口
// ============================================================

/**
 * Skill 提供的生命周期钩子
 *
 * 理解：钩子是"自动触发的事件处理器"。
 * 比如 beforeChat 在每次对话前自动执行，可以用来记录日志或修改上下文。
 */
export interface IHook {
  /** 钩子名称（用于调试） */
  name: string;
  /** Agent 启动时执行一次 */
  onInit?: () => Promise<void>;
  /** Agent 关闭时执行一次 */
  onDestroy?: () => Promise<void>;
  /** 每次用户对话前执行（可以修改并返回上下文） */
  beforeChat?: (context: SkillContext) => Promise<SkillContext>;
  /** 每次对话结束后执行 */
  afterChat?: (context: SkillContext) => Promise<SkillContext>;
}

/**
 * 传递给钩子的上下文信息
 */
export interface SkillContext {
  /** 用户 ID（可空） */
  userId?: string;
  /** 对话 ID（可空） */
  conversationId?: string;
  /** 用户输入 */
  input: string;
  /** AI 响应（afterChat 时有值） */
  response?: string;
  /** 自定义数据（钩子可自由读写） */
  metadata?: Record<string, unknown>;
}

// ============================================================
//  Skill 接口
// ============================================================

/**
 * 每个 Skill 都必须实现 ISkill 接口
 *
 * 理解：这是"技能包的合同"——所有 Skill 都必须遵守同一套接口。
 */
export interface ISkill {
  /** 技能名称（全局唯一，如 "email"） */
  name: string;
  /** 版本号（语义化版本，如 "1.0.0"） */
  version: string;
  /** 简短描述 */
  description?: string;
  /** 依赖的其他 Skill 名称列表（需先加载） */
  dependencies?: string[];
  /** 初始化（加载资源、建立连接等） */
  init?: () => Promise<void>;
  /** 销毁（释放资源、关闭连接等） */
  destroy?: () => Promise<void>;
  /** 返回此 Skill 提供的工具列表 */
  getTools?: () => Array<{ definition: ToolDefinition; executor: ToolExecutor }>;
  /** 返回此 Skill 提供的钩子列表 */
  getHooks?: () => IHook[];
  /** 可选的配置（Skill 自定义配置） */
  config?: Record<string, unknown>;
}

// ============================================================
//  工具类型（复用现有定义）
// ============================================================

/** Skill 提供的工具项（与 ToolRegistry.ToolEntry 兼容） */
export type SkillToolEntry = {
  definition: ToolDefinition;
  executor: ToolExecutor;
};
