/**
 * memory/embedding.ts
 *
 * 嵌入模型：将文本转换为向量（数字数组）
 *
 * 为什么需要嵌入？
 * 计算机看不懂文字，但能计算数字。把文字变成向量后，我们就可以
 * 计算两段文字的相似度（比如"你好"和"您好"的向量很接近）。
 */

export interface EmbeddingModel {
  /** 将单个文本转为向量 */
  embed(text: string): Promise<number[]>;
  /** 批量嵌入 */
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ─────────────────────────────────────────────────────────
//  Mock 嵌入模型
// ─────────────────────────────────────────────────────────

/**
 * Mock 嵌入模型（用于演示，不依赖外部服务）
 *
 * 使用固定散列：将文本中每个字符的 charCode 分散到 128 维向量中。
 * 虽然不准确，但足够演示检索/衰减/遗忘的完整流程。
 */
export class MockEmbeddingModel implements EmbeddingModel {
  private dimension = 128;

  async embed(text: string): Promise<number[]> {
    const vec = new Float32Array(this.dimension);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const idx = i % this.dimension;
      vec[idx] += code / 65535;
    }
    return Array.from(vec);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ─────────────────────────────────────────────────────────
//  Ollama 嵌入模型
// ─────────────────────────────────────────────────────────

/**
 * 真实 Ollama 嵌入模型（需要本地 Ollama 服务）
 *
 * 使用：new OllamaEmbeddingModel({ model: 'nomic-embed-text' })
 * 推荐模型：nomic-embed-text（约 274MB，支持中英文）
 */
export class OllamaEmbeddingModel implements EmbeddingModel {
  private host: string;
  private model: string;

  constructor(options: { host?: string; model?: string } = {}) {
    this.host = options.host || 'http://localhost:11434';
    this.model = options.model || 'nomic-embed-text';
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) {
      throw new Error(`Ollama 嵌入失败: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await this.embed(t));
    }
    return results;
  }
}
