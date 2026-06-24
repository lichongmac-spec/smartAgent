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

// ─────────────────────────────────────────────────────────
//  自动选择最优嵌入模型
// ─────────────────────────────────────────────────────────

/**
 * 创建最优嵌入模型（自动检测）
 *
 * 优先级：
 *   1. 如果 Ollama 正在运行且有 nomic-embed-text 模型 → 使用 Ollama（768 维真实向量）
 *   2. 否则 → 使用 Mock（128 维简单向量，仅用于演示）
 *
 * @example
 *   const embedder = await createEmbeddingModel();
 *   const manager = new MemoryManager(embedder);
 */
export async function createEmbeddingModel(): Promise<EmbeddingModel> {
  // 尝试 Ollama
  const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s 超时

    const response = await fetch(`${ollamaHost}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name);

      // 检查是否有 nomic-embed-text（或环境变量指定的模型）
      if (models.some((m) => m.startsWith(ollamaModel))) {
        console.log(`✅ 使用 Ollama 嵌入模型: ${ollamaModel}`);
        return new OllamaEmbeddingModel({ host: ollamaHost, model: ollamaModel });
      }

      // Ollama 可用但没有嵌入模型，尝试下载
      console.log(`⚠️ Ollama 运行中但缺少 ${ollamaModel} 模型，使用 Mock 模式`);
      console.log(`   提示: 运行 "ollama pull ${ollamaModel}" 安装，约 274MB`);
    } else {
      console.log('⚠️ Ollama 不可用，使用 Mock 嵌入模型');
    }
  } catch {
    console.log('⚠️ Ollama 连接失败，使用 Mock 嵌入模型');
  }

  // Fallback: Mock
  console.log('📦 使用 Mock 嵌入模型（128 维，仅供演示）');
  return new MockEmbeddingModel();
}
