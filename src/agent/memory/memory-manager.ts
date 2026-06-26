/**
 * memory/memory-manager.ts
 *
 * 记忆管理器：提供友好的 API 来添加、检索、衰减和遗忘记忆
 *
 * 结合嵌入模型和向量存储，加入以下高级功能：
 * - 记忆重要性衰减（时间越久越不重要）
 * - 自动遗忘（删除重要性低于阈值的记忆）
 */

import type { EmbeddingModel } from './embedding.js';
import { VectorStore, type MemoryItem } from './vector-store.js';

// ─────────────────────────────────────────────────────────
//  配置
// ─────────────────────────────────────────────────────────

export interface MemoryManagerConfig {
  /** 检索时默认返回数量 */
  defaultK?: number;
  /** 相似度阈值（0~1），低于此值的记忆不被检索 */
  similarityThreshold?: number;
  /** 重要性衰减率（每天），默认 0.05 */
  decayRate?: number;
  /** 遗忘阈值：重要性低于此值将被自动删除 */
  forgetThreshold?: number;
  /** 是否启用自动遗忘（在每次添加或检索时触发） */
  autoForget?: boolean;
}

type ResolvedConfig = Required<MemoryManagerConfig>;

// ─────────────────────────────────────────────────────────
//  记忆管理器
// ─────────────────────────────────────────────────────────

/**
 * 记忆管理器
 *
 * @example
 * ```ts
 * const embedder = new MockEmbeddingModel();
 * const manager = new MemoryManager(embedder, { defaultK: 3 });
 * await manager.addMemory('我喜欢编程', 0.8);
 * const results = await manager.retrieve('我有什么爱好？');
 * ```
 */
export class MemoryManager {
  private store: VectorStore;
  private embedder: EmbeddingModel;
  private config: ResolvedConfig;

  constructor(embedder: EmbeddingModel, config: MemoryManagerConfig = {}) {
    this.embedder = embedder;
    this.store = new VectorStore();
    this.config = {
      defaultK: config.defaultK ?? 5,
      similarityThreshold: config.similarityThreshold ?? 0.5,
      decayRate: config.decayRate ?? 0.05,
      forgetThreshold: config.forgetThreshold ?? 0.1,
      autoForget: config.autoForget ?? true,
    };
  }

  // ── 添加记忆 ──

  /**
   * 添加一条记忆
   *
   * @param text - 记忆内容
   * @param importance - 重要性（0~1），默认 0.5
   * @param metadata - 额外元数据
   * @returns 记忆 ID
   */
  async addMemory(
    text: string,
    importance = 0.5,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const vector = await this.embedder.embed(text);

    const id = this.store.add({
      text,
      vector,
      timestamp: new Date(),
      importance: clamp(importance, 0, 1),
      metadata,
    });

    if (this.config.autoForget) {
      this.forget();
    }

    return id;
  }

  // ── 检索记忆 ──

  /**
   * 根据查询文本检索相关记忆
   *
   * @param query - 问题或关键词
   * @param k - 返回数量（覆盖配置）
   * @param minScore - 最低相似度（覆盖配置）
   */
  async retrieve(
    query: string,
    k?: number,
    minScore?: number,
  ): Promise<MemoryItem[]> {
    const queryVector = await this.embedder.embed(query);

    const kFinal = k ?? this.config.defaultK;
    const threshold = minScore ?? this.config.similarityThreshold;
    const results = this.store.search(queryVector, kFinal, threshold);

    if (this.config.autoForget) {
      this.forget();
    }

    return results;
  }

  // ── 衰减 ──

  /**
   * 计算记忆经过衰减后的重要性
   *
   * 公式：newImportance = oldImportance × (1 - decayRate) ^ days
   */
  private decayImportance(item: MemoryItem): number {
    const now = new Date();
    const days =
      (now.getTime() - item.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 0) return item.importance;
    return item.importance * Math.pow(1 - this.config.decayRate, days);
  }

  // ── 遗忘 ──

  /**
   * 遗忘：删除重要性低于阈值的记忆
   *
   * @returns 被删除的记忆 ID 列表
   */
  forget(): string[] {
    const all = this.store.getAll();
    const toDelete: string[] = [];

    for (const mem of all) {
      const currentImportance = this.decayImportance(mem);
      if (currentImportance < this.config.forgetThreshold) {
        toDelete.push(mem.id);
      }
    }

    for (const id of toDelete) {
      this.store.delete(id);
    }

    return toDelete;
  }

  // ── 更新重要性 ──

  /**
   * 更新记忆的重要性（例如用户反馈"这条很有用"）
   */
  updateImportance(id: string, newImportance: number): boolean {
    const mem = this.store.getById(id);
    if (!mem) return false;
    mem.importance = clamp(newImportance, 0, 1);
    return true;
  }

  // ── 统计 ──

  /** 获取统计信息 */
  stats() {
    const all = this.store.getAll();
    const avgImportance =
      all.reduce((sum, m) => sum + m.importance, 0) / (all.length || 1);
    const timestamps = all.map((m) => m.timestamp.getTime());
    return {
      total: all.length,
      avgImportance,
      oldest: all.length > 0 ? new Date(Math.min(...timestamps)) : null,
      newest: all.length > 0 ? new Date(Math.max(...timestamps)) : null,
    };
  }

  // ── 清理 ──

  /** 清空所有记忆 */
  clear(): void {
    this.store.clear();
  }

  /** 获取原始存储（调试用） */
  getStore(): VectorStore {
    return this.store;
  }
}

// ─── 工具函数 ───

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
