/**
 * ollama-client.ts - 本地 AI 模型客户端
 *
 * 理解：这就像"小区门口的小饭馆"——不用排队（不用 API Key），想用就用。
 *
 * 前提条件：电脑上要安装并启动 Ollama
 *   brew install ollama
 *   ollama serve
 *   ollama pull qwen2.5:7b
 *
 * 使用方式：
 *   import { OllamaClient } from './ollama-client.js';
 *   const client = new OllamaClient({ model: 'qwen2.5:7b' });
 *   const resp = await client.chat([{ role: 'user', content: '你好' }]);
 */

import type { ILLMClient, Message, ChatOptions, ChatResponse, ToolCall } from './types.js';
import { debug, info, error as logError } from './logger.js';
import {
  LLMError,
  NetworkError,
  ModelUnavailableError,
  RateLimitError,
} from './errors.js';
import { withOptionalRetry } from './retry.js';

/** Ollama 默认服务地址 */
const DEFAULT_HOST = 'http://localhost:11434';

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT = 60000;

/**
 * Ollama 客户端
 *
 * 理解：这个类就是"小饭馆的服务员"——你告诉它你想吃什么（发消息），
 * 它帮你跟后厨（本地模型）沟通。
 */
export class OllamaClient implements ILLMClient {
  private host: string;
  private model: string;
  private timeout: number;

  /**
   * 创建 Ollama 客户端实例
   *
   * @param config.host - Ollama 服务地址
   * @param config.model - 模型名
   * @param config.timeout - 默认请求超时（毫秒），默认 60s
   */
  constructor(config: { model?: string; host?: string; timeout?: number } = {}) {
    this.host = config.host ?? DEFAULT_HOST;
    this.model = config.model ?? 'qwen2.5:7b';
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    info(`📡 Ollama 客户端初始化: ${this.host}, 模型: ${this.model}`);
  }

  /** @inheritdoc */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      return (data.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /** @inheritdoc */
  async embed(text: string): Promise<number[]> {
    debug(`📤 Ollama embed 请求: ${text.slice(0, 50)}...`);

    try {
      const response = await fetch(`${this.host}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new LLMError(
          `Ollama embed 失败 (${response.status})`,
          'OLLAMA_EMBED_ERROR',
          response.status >= 500,
        );
      }

      const data = (await response.json()) as { embedding?: number[] };
      return data.embedding ?? [];
    } catch (err) {
      if (err instanceof LLMError) throw err;
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new NetworkError(`Ollama embed 请求超时 (${this.timeout}ms)`);
      }
      throw new LLMError(
        `Ollama embed 失败: ${(err as Error).message}`,
        'OLLAMA_EMBED_ERROR',
        true,
      );
    }
  }

  /**
   * 聊天（非流式）—— 一次返回完整回答
   *
   * 支持 options.timeout 独立超时、options.retry 重试
   */
  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    return withOptionalRetry(
      () => this._chatImpl(messages, options),
      options.retry,
    );
  }

  /**
   * 聊天（流式）—— 逐字返回，实现"打字机效果"
   *
   * 注意：流式模式不支持重试（无法恢复已输出的 Token）
   */
  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<string> {
    const model = options.model ?? this.model;
    const timeout = options.timeout ?? this.timeout;
    debug(`📤 Ollama 流式请求: ${model}`);

    const body = {
      model,
      messages: this.buildMessages(messages, options.systemPrompt),
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens,
        num_gpu: 1,
        main_gpu: 0,
      },
    };

    // 工具支持
    if (options.tools && options.tools.length > 0) {
      (body as Record<string, unknown>).tools = options.tools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new NetworkError(`Ollama 流式请求超时 (${timeout}ms)`);
      }
      throw new LLMError(
        `Ollama 流式连接失败: ${(err as Error).message}`,
        'OLLAMA_STREAM_CONNECTION',
        true,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new ModelUnavailableError(`模型 "${model}" 未找到，请先运行: ollama pull ${model}`);
      }
      if (response.status === 429) {
        throw new RateLimitError('Ollama 流式请求过于频繁');
      }
      throw new LLMError(
        `Ollama 流式错误 (${response.status}): ${errorText}`,
        'OLLAMA_STREAM_ERROR',
        response.status >= 500,
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const chunk = JSON.parse(trimmed);
            const token = chunk.message?.content ?? '';
            if (token) {
              yield token;
            }
            if (chunk.done) return;
          } catch {
            // 跳过非 JSON 行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ============================================================
  //  内部实现
  // ============================================================

  /**
   * chat 的内部实现（不含重试逻辑）
   */
  private async _chatImpl(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    const model = options.model ?? this.model;
    const timeout = options.timeout ?? this.timeout;

    debug(`📤 Ollama 请求: ${model}, ${messages.length} 条消息`);

    try {
      const body: Record<string, unknown> = {
        model,
        messages: this.buildMessages(messages, options.systemPrompt),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens,
          // 🔥 M1/M2 Mac GPU 加速
          num_gpu: 1,
          main_gpu: 0,
        },
      };

      // 工具支持
      if (options.tools && options.tools.length > 0) {
        body.tools = options.tools;
      }

      const startTime = Date.now();
      const response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      const elapsed = Date.now() - startTime;
      debug(`⏱️ Ollama 响应耗时: ${elapsed}ms`);

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 404) {
          throw new ModelUnavailableError(
            `模型 "${model}" 未找到，请先运行: ollama pull ${model}`,
          );
        }
        if (response.status === 429) {
          throw new RateLimitError('Ollama 请求过于频繁');
        }

        throw new LLMError(
          `Ollama 错误 (${response.status}): ${errorText}`,
          'OLLAMA_ERROR',
          response.status >= 500,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;

      const message = data.message as Record<string, unknown> | undefined;
      const content = (message?.content as string) ?? '';
      debug(`📥 Ollama 响应: ${content.slice(0, 100)}...`);

      // 解析工具调用（Ollama 0.3+ 支持）
      const toolCalls = this.parseOllamaToolCalls(message);

      return {
        content,
        finishReason: data.done_reason === 'load' ? 'length' : 'stop',
        usage: {
          promptTokens: (data.prompt_eval_count as number) ?? 0,
          completionTokens: (data.eval_count as number) ?? 0,
          totalTokens: ((data.prompt_eval_count as number) ?? 0) + ((data.eval_count as number) ?? 0),
        },
        model: data.model as string ?? model,
        toolCalls,
      };
    } catch (err) {
      // 超时错误
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new NetworkError(`Ollama 请求超时 (${timeout}ms)`);
      }

      // 已经是 LLMError 的直接抛出
      if (err instanceof LLMError) {
        throw err;
      }

      // 其他网络错误
      logError(`Ollama 请求失败: ${err}`);
      throw new LLMError(
        `Ollama 通信失败: ${(err as Error).message}`,
        'OLLAMA_CONNECTION',
        true,
      );
    }
  }

  /**
   * 解析 Ollama 响应中的工具调用
   */
  private parseOllamaToolCalls(
    message: Record<string, unknown> | undefined,
  ): ToolCall[] | undefined {
    if (!message) return undefined;

    const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls || toolCalls.length === 0) return undefined;

    return toolCalls.map((tc) => {
      const fn = tc.function as Record<string, string> | undefined;
      return {
        name: fn?.name ?? '',
        arguments: fn?.arguments ?? '{}',
      };
    });
  }

  /**
   * 构建 Ollama 格式的消息列表
   */
  private buildMessages(messages: Message[], systemPrompt?: string): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }
}
