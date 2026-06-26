/**
 * registry.ts - 工具注册表
 *
 * 理解：这就像"厨师的工具箱"——里面有各种工具，需要什么用什么。
 * 所有工具都注册在这里，AI 通过 ToolDefinition 知道有哪些工具可用。
 *
 * 使用方式：
 *   import { ToolRegistry } from './tools/registry.js';
 *   const registry = new ToolRegistry();
 *   registry.register({ definition, executor });
 *   const result = await registry.execute('read_file', { path: 'test.txt' });
 */

import type { ToolDefinition } from '../llm/types.js';

// ============================================================
//  1. 类型定义
// ============================================================

/**
 * 工具执行函数类型
 *
 * 理解：每个工具都是一个函数，接收参数，返回结果
 */
export type ToolExecutor = (
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * 工具注册项：定义 + 执行函数
 */
export interface ToolEntry {
  /** 工具定义（告诉 AI 这个工具怎么用） */
  definition: ToolDefinition;
  /** 工具执行函数 */
  executor: ToolExecutor;
}

// ============================================================
//  2. 工具注册表
// ============================================================

/**
 * 工具注册表
 *
 * 理解：就像一个"工具箱"，所有工具都放在这里，按名字查找
 *
 * 特性：
 *   - 按名称注册/查找工具
 *   - 批量导出 ToolDefinition（给 LLM 用）
 *   - 执行工具并返回结果
 *   - 列出所有工具名
 */
export class ToolRegistry {
  /** 工具名 → 工具项的映射 */
  private tools: Map<string, ToolEntry> = new Map();

  /** 是否打印日志（默认 true） */
  verbose: boolean = true;

  /**
   * 注册一个工具
   *
   * @param entry - 工具定义 + 执行函数
   * @throws 如果工具名已存在
   *
   * @example
   *   registry.register({
   *     definition: {
   *       type: 'function',
   *       function: { name: 'read_file', description: '...', parameters: {} }
   *     },
   *     executor: async (args) => { ... }
   *   });
   */
  register(entry: ToolEntry): void {
    const name = entry.definition.function.name;
    if (this.tools.has(name)) {
      throw new Error(`工具 "${name}" 已注册，不能重复注册`);
    }
    this.tools.set(name, entry);
    if (this.verbose) {
      console.log(`🔧 注册工具: ${name} - ${entry.definition.function.description}`);
    }
  }

  /**
   * 注销一个工具
   *
   * @param name - 工具名
   * @returns 是否成功注销
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 执行一个工具
   *
   * @param name - 工具名
   * @param args - 参数（JSON 解析后的对象）
   * @returns 执行结果
   * @throws 如果工具未注册或执行失败
   *
   * @example
   *   const result = await registry.execute('read_file', { path: '/tmp/test.txt' });
   */
  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(
        `工具 "${name}" 未注册。可用工具: ${this.listNames().join(', ')}`
      );
    }

    if (this.verbose) {
      const argsStr = JSON.stringify(args, null, 2);
      console.log(`🔧 执行工具: ${name}(${argsStr.length > 100 ? argsStr.slice(0, 100) + '...' : argsStr})`);
    }

    try {
      const result = await entry.executor(args);
      return result;
    } catch (error) {
      throw new Error(
        `工具 "${name}" 执行失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 获取所有工具定义（用于告诉 AI 有哪些工具可用）
   *
   * 理解：就像给 AI 一份"工具清单"
   *
   * @returns 工具定义数组
   *
   * @example
   *   const definitions = registry.getDefinitions();
   *   // 传给 LLM:
   *   await llm.chat(messages, { tools: definitions });
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.definition);
  }

  /**
   * 获取所有工具名
   *
   * @returns 工具名列表（按字母排序）
   */
  listNames(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具详情
   */
  get(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }
}
