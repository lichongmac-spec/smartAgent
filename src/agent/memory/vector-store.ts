/**
 * memory/vector-store.ts
 *
 * 向量存储：存放记忆的"仓库"
 *
 * 用内存数组模拟向量数据库。每条记忆包括：
 * - 文本内容、向量、时间戳、重要性、元数据
 */

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

export interface MemoryItem {
  /** 唯一标识 */
  id: string;
  /** 原始文本 */
  text: string;
  /** 嵌入向量 */
  vector: number[];
  /** 创建时间 */
  timestamp: Date;
  /** 重要性（0~1），用于衰减和遗忘 */
  importance: number;
  /** 额外元数据（如对话ID、用户等） */
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────
//  余弦相似度
// ─────────────────────────────────────────────────────────

/**
 * 余弦相似度
 *
 * 公式：cos(θ) = (A·B) / (|A| * |B|)
 * 值越接近 1 表示越相似，0 表示无关，-1 表示完全相反。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('向量维度必须相同');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─────────────────────────────────────────────────────────
//  向量存储
// ─────────────────────────────────────────────────────────

/**
 * 内存向量存储
 *
 * 基于数组实现，使用余弦相似度进行检索。
 * 适合演示和小规模使用；生产环境可替换为 LanceDB。
 */
export class VectorStore {
  private memories: MemoryItem[] = [];

  // ── 添加 ──

  /** 添加一条记忆，返回自动生成的 ID */
  add(item: Omit<MemoryItem, 'id'>): string {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newItem: MemoryItem = { ...item, id };
    this.memories.push(newItem);
    return id;
  }

  // ── 检索 ──

  /**
   * 根据向量检索最相似的 k 条记忆
   *
   * @param queryVector - 查询向量
   * @param k - 返回最多 k 条
   * @param minScore - 最低相似度阈值（0~1），低于此值的结果将被过滤
   */
  search(queryVector: number[], k = 5, minScore = 0.5): MemoryItem[] {
    if (this.memories.length === 0) return [];

    const scored = this.memories.map((mem) => ({
      item: mem,
      score: cosineSimilarity(queryVector, mem.vector),
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored
      .filter((s) => s.score >= minScore)
      .slice(0, k)
      .map((s) => s.item);
  }

  // ── 查询 ──

  /** 获取所有记忆（调试用） */
  getAll(): MemoryItem[] {
    return [...this.memories];
  }

  /** 按 ID 查找 */
  getById(id: string): MemoryItem | undefined {
    return this.memories.find((m) => m.id === id);
  }

  // ── 删除 ──

  /** 删除一条记忆 */
  delete(id: string): boolean {
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    return true;
  }

  /** 清空所有记忆 */
  clear(): void {
    this.memories = [];
  }

  // ── 属性 ──

  get size(): number {
    return this.memories.length;
  }
}
