/**
 * mock-client.ts - Mock LLM 客户端（测试用）
 *
 * 理解：这就像"方便面"——不用等外卖，自己泡一泡就能吃。
 * 用于测试和开发环境，不需要真实的 AI 服务。
 *
 * 使用方式：
 *   import { MockLLMClient } from './mock-client.js';
 *   const client = new MockLLMClient();
 *   const resp = await client.chat([{ role: 'user', content: '你好' }]);
 */

import type { ILLMClient, Message, ChatOptions, ChatResponse } from './types.js';
import { debug, info } from './logger.js';

/**
 * Mock LLM 客户端
 *
 * 根据用户消息中的关键词返回预设回复，模拟真实 LLM 的行为。
 * 支持延迟模拟和流式输出。
 */
export class MockLLMClient implements ILLMClient {
  private modelName = 'mock-model-v1';

  constructor() {
    info('🟡 Mock 客户端初始化（离线模式）');
  }

  /** @inheritdoc */
  async healthCheck(): Promise<boolean> {
    return true; // Mock 永远健康 😄
  }

  /** @inheritdoc */
  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    debug(`📤 Mock 请求: ${messages.length} 条消息`);

    await this.simulateDelay(50);

    const lastUserMessage = this.getLastUserMessage(messages);
    const content = this.generateResponse(lastUserMessage, options);

    debug(`📥 Mock 响应: ${content.slice(0, 80)}...`);

    return {
      content,
      finishReason: 'stop',
      usage: {
        promptTokens: Math.ceil(content.length / 4),
        completionTokens: content.length,
        totalTokens: Math.ceil(content.length / 4) + content.length,
      },
      model: this.modelName,
    };
  }

  /** @inheritdoc */
  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<string> {
    const lastUserMessage = this.getLastUserMessage(messages);
    const content = this.generateResponse(lastUserMessage, options);

    debug(`📤 Mock 流式请求，回复长度: ${content.length} 字符`);

    for (const char of content) {
      await this.simulateDelay(10);
      yield char;
    }
  }

  // ============================================================
  //  关键词匹配
  // ============================================================

  private generateResponse(message: string, _options: ChatOptions): string {
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes('你好') || lowerMsg.includes('hello')) {
      return '你好！我是 SmartAgent 的 Mock 模式。有什么可以帮助你的吗？';
    }
    if (lowerMsg.includes('天气') || lowerMsg.includes('weather')) {
      return '我目前无法获取实时天气信息。在 Mock 模式下，这是一个预设回复。';
    }
    if (lowerMsg.includes('代码') || lowerMsg.includes('code')) {
      return '我可以帮你分析和编写代码！请告诉我你具体需要什么？';
    }
    if (lowerMsg.includes('帮助') || lowerMsg.includes('help')) {
      return 'SmartAgent 是一个智能对话助手。在完整版中，我可以执行多种任务，包括代码分析、文件操作等。';
    }
    if (lowerMsg.includes('文件') || lowerMsg.includes('file')) {
      return '我理解你想操作文件。在 Mock 模式下，文件操作是模拟的。';
    }
    if (lowerMsg.includes('工具') || lowerMsg.includes('tool')) {
      return 'SmartAgent 支持工具调用系统，包括文件读写、终端执行等功能。';
    }

    return `这是 Mock 客户端对 "${message.slice(0, 50)}" 的自动回复。Mock 模式用于开发和测试，不连接真实的 AI 服务。`;
  }

  // ============================================================
  //  辅助方法
  // ============================================================

  private getLastUserMessage(messages: Message[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    return userMessages.length > 0
      ? userMessages[userMessages.length - 1].content
      : '';
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
