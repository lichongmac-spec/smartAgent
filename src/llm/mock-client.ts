/**
 * mock-client.ts - Mock LLM 客户端（测试用）
 *
 * 理解：这就像"方便面"——不用等外卖，自己泡一泡就能吃。
 * 用于测试和开发环境，不需要真实的 AI 服务。
 *
 * 支持 Function Calling 模拟：检测到关键词时自动生成 tool_calls，
 * 让完整的 ReAct 流程（Think → Act → Observe）可以在无真实 LLM 时测试。
 *
 * 使用方式：
 *   const client = new MockLLMClient();
 *   const resp = await client.chat([{ role: 'user', content: '你好' }]);
 *   // 或带工具：
 *   const resp = await client.chat([{ role: 'user', content: '帮我计算 1+1' }], {
 *     tools: calculatorToolDefinitions,
 *   });
 */

import type { ILLMClient, Message, ChatOptions, ChatResponse, ToolCall, ToolDefinition } from './types.js';
import { debug, info } from './logger.js';

/** Mock 嵌入向量维度 */
const MOCK_EMBEDDING_DIM = 768;

// ============================================================
//  Function Calling 模拟：关键词 → 工具调用
// ============================================================

/**
 * 工具调用模拟规则
 *
 * 理解：当用户消息匹配关键词时，Mock 会模拟调用对应工具，
 * 而不是直接返回预设文本。
 *
 * 每条规则按优先级匹配，匹配到第一个后停止。
 */
interface MockToolRule {
  /** 匹配关键词（用户消息中的中文关键词） */
  keywords: string[];
  /** 工具名称 */
  toolName: string;
  /** 参数构建函数（输入用户消息，输出工具参数 JSON） */
  buildArgs: (userMessage: string) => Record<string, unknown>;
}

/** 工具调用模拟规则表 */
const MOCK_TOOL_RULES: MockToolRule[] = [
  {
    keywords: ['计算', '算', '等于', '+', '-', '*', '/', '×', '÷',
               '平方', '次方', '开方', '根号', 'sin', 'cos', 'tan'],
    toolName: 'calculator',
    buildArgs: (msg) => {
      // 尝试提取数学表达式
      const mathMatch = msg.match(
        /(?:计算|算|等于|求(?:值)?)\s*[:：]?\s*([0-9+\-*/().\s×÷^]+)|([0-9]+\s*[+\-*/×÷]\s*[0-9]+)/,
      );
      const expression = mathMatch
        ? (mathMatch[1] || mathMatch[2]).trim().replace(/[×÷]/g, (c) => c === '×' ? '*' : '/')
        : '1 + 1';
      return { expression };
    },
  },
  {
    keywords: ['读取', '查看', '读文件', '打开文件', '显示文件', 'read_file', 'read file',
               '看看', '看一下', '内容是什么', '读一下', '读取文件'],
    toolName: 'read_file',
    buildArgs: (msg) => {
      // 尝试提取文件名
      const fileMatch = msg.match(/['""]([^'""]+)['""]/)
        || msg.match(/(?:读取|查看|读|打开|看)(?:\s*(?:一下|文件|这个))?\s*[:：]?\s*(\S+\.\w+)/);
      const path = fileMatch ? fileMatch[1] : 'README.md';
      return { path };
    },
  },
  {
    keywords: ['写入', '写文件', '创建文件', '保存', 'write_file', 'write file'],
    toolName: 'write_file',
    buildArgs: (msg) => {
      const fileMatch = msg.match(/['""]([^'""]+)['""]/);
      const path = fileMatch ? fileMatch[1] : 'output.txt';
      // 提取内容放在 content 里（如果有）
      const contentMatch = msg.match(/内容[:：]\s*(.+?)(?:$|，|。)/);
      const content = contentMatch ? contentMatch[1] : 'Mock 写入测试内容';
      return { path, content };
    },
  },
  {
    keywords: ['搜索', '查找', '查询', 'search', '搜一下', '搜一搜'],
    toolName: 'search_web',
    buildArgs: (msg) => {
      const queryMatch = msg.match(/['""]([^'""]+)['""]/)
        || msg.match(/(?:搜索|查找|查询|搜一下)\s*[:：]?\s*(.+?)(?:$|，|。)/);
      const query = queryMatch ? queryMatch[1].trim() : '关键词';
      return { query };
    },
  },
];

/**
 * 检查是否应该触发工具调用模拟
 */
function detectMockToolCall(
  userMessage: string,
  tools?: ToolDefinition[],
): { toolCall: ToolCall; toolName: string } | null {
  if (!tools || tools.length === 0) return null;

  const availableToolNames = new Set(tools.map((t) => t.function.name));

  for (const rule of MOCK_TOOL_RULES) {
    // 先检查规则对应的工具是否在可用的工具列表中
    if (!availableToolNames.has(rule.toolName)) continue;

    // 检查关键词匹配
    const matched = rule.keywords.some((kw) => userMessage.includes(kw));
    if (!matched) continue;

    const args = rule.buildArgs(userMessage);
    return {
      toolCall: {
        name: rule.toolName,
        arguments: JSON.stringify(args),
        id: `mock_call_${rule.toolName}_${Date.now()}`,
      },
      toolName: rule.toolName,
    };
  }

  return null;
}

// ============================================================
//  MockLLMClient
// ============================================================

/**
 * Mock LLM 客户端
 *
 * 根据用户消息中的关键词返回预设回复，模拟真实 LLM 的行为。
 * 支持延迟模拟、流式输出、工具调用模拟（Function Calling）、嵌入向量生成。
 */
export class MockLLMClient implements ILLMClient {
  private modelName = 'mock-model-v1';

  constructor() {
    info('🟡 Mock 客户端初始化（离线模式 + Function Calling 模拟）');
  }

  /** @inheritdoc */
  async healthCheck(): Promise<boolean> {
    return true; // Mock 永远健康
  }

  /** @inheritdoc */
  async listModels(): Promise<string[]> {
    return [this.modelName, 'mock-embed-v1'];
  }

  /** @inheritdoc */
  async embed(text: string): Promise<number[]> {
    // 基于文本内容生成确定性的"伪向量"（用于测试语义搜索流程）
    const vector = new Array<number>(MOCK_EMBEDDING_DIM);
    for (let i = 0; i < MOCK_EMBEDDING_DIM; i++) {
      let hash = 0;
      for (const char of text) {
        hash = ((hash << 5) - hash + char.charCodeAt(0) + i) | 0;
      }
      vector[i] = Math.sin(hash * 0.01);
    }
    // L2 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < MOCK_EMBEDDING_DIM; i++) {
        vector[i] /= norm;
      }
    }
    return vector;
  }

  /** @inheritdoc */
  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    debug(`📤 Mock 请求: ${messages.length} 条消息`);

    // 支持外部 AbortSignal
    if (options.signal?.aborted) {
      throw Object.assign(new Error('Mock 请求被取消'), { name: 'AbortError' });
    }

    // 支持 timeout 模拟
    const timeout = options.timeout ?? 60000;
    await this.simulateDelay(Math.min(50, timeout));

    const lastUserMessage = this.getLastUserMessage(messages);

    // ---- Function Calling 模拟 ----
    // 检测上一轮是否有 tool 角色消息（第二轮及之后的调用不需要工具）
    const hasToolResults = messages.some((m) => m.role === 'tool');

    if (!hasToolResults && options.tools && options.tools.length > 0) {
      const mockCall = detectMockToolCall(lastUserMessage, options.tools as ToolDefinition[]);
      if (mockCall) {
        debug(`📤 Mock 触发工具调用模拟: ${mockCall.toolName}`);
        return {
          content: `正在调用 ${mockCall.toolName} 工具...`,
          finishReason: 'tool_calls',
          toolCalls: [mockCall.toolCall],
          usage: {
            promptTokens: Math.ceil(lastUserMessage.length / 4),
            completionTokens: 20,
            totalTokens: Math.ceil(lastUserMessage.length / 4) + 20,
          },
          model: this.modelName,
        };
      }
    }

    // ---- 普通文本回复 ----
    const content = this.generateResponse(lastUserMessage, options, messages);

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

    // 流式模式不支持 tool_call 模拟（流式只返回文本块）
    const content = this.generateResponse(lastUserMessage, options, messages);

    debug(`📤 Mock 流式请求，回复长度: ${content.length} 字符`);

    for (const char of content) {
      await this.simulateDelay(10);
      yield char;
    }
  }

  // ============================================================
  //  关键词匹配
  // ============================================================

  private generateResponse(message: string, _options: ChatOptions, messages?: Message[]): string {
    const lowerMsg = message.toLowerCase();

    // 如果消息中包含工具返回结果（系统提示重试等），返回通用提示
    if (lowerMsg.includes('[系统提示]') || lowerMsg.includes('上一次操作失败')) {
      return '我理解了，让我换一种方式来处理。';
    }

    // 如果有 tool 角色消息（观测结果），返回基于观测的回答
    if (messages) {
      const lastToolMsg = messages.filter((m) => m.role === 'tool').pop();
      if (lastToolMsg) {
        return this.generateToolObservationResponse(message, lastToolMsg.content);
      }
    }

    if (lowerMsg.includes('你好') || lowerMsg.includes('hello')) {
      return '你好！我是 SmartAgent 的 Mock 模式。有什么可以帮助你的吗？';
    }
    if (lowerMsg.includes('天气') || lowerMsg.includes('weather')) {
      // 但如果有 search_web 工具，应该在 chat 层面被 tool_call 截获
      return '天气查询需要联网搜索，在 Mock 模式下这是一个模拟回复。';
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
      return 'SmartAgent 支持工具调用系统，包括文件读写、搜索等功能。';
    }
    // 如果是工具调用后的追问
    if (lowerMsg.includes('继续') || lowerMsg.includes('再') || lowerMsg.includes('下一步')) {
      const ctx = messages?.filter((m) => m.role === 'tool').length ?? 0;
      return `我已经完成了上一步的工具调用（累计 ${ctx} 次）。接下来需要做什么？`;
    }

    return `这是 Mock 客户端对 "${message.slice(0, 50)}" 的自动回复。Mock 模式用于开发和测试，不连接真实的 AI 服务。`;
  }

  /**
   * 生成基于工具观察结果的回复
   *
   * 理解：当 Mock 收到工具执行结果后，生成一个看起来合理的"分析"回复
   */
  private generateToolObservationResponse(_userMsg: string, observation: string): string {
    try {
      const data = JSON.parse(observation);

      if (data.success === false) {
        return `工具执行失败：${data.error || '未知错误'}。请检查输入参数或尝试其他方法。`;
      }

      // calculator 结果
      if (data.expression !== undefined && data.result !== undefined) {
        return `计算结果：${data.expression} = ${data.result}`;
      }

      // read_file 结果
      if (data.path && data.content !== undefined) {
        const preview = typeof data.content === 'string'
          ? data.content.slice(0, 150) + (data.content.length > 150 ? '...' : '')
          : '';
        return `已成功读取文件 ${data.path}：\n${preview}`;
      }

      // write_file 结果
      if (data.path && data.bytesWritten !== undefined) {
        return `已成功写入文件 ${data.path}（${data.bytesWritten} 字节）。`;
      }

      // search_web 结果
      if (data.query && data.results) {
        const results = Array.isArray(data.results) ? data.results : [];
        const summary = results.map((r: { title: string }) => `- ${r.title}`).join('\n');
        return `搜索 "${data.query}" 的结果：\n${summary || '未找到相关结果'}`;
      }

      // 通用成功
      return `工具执行成功，返回结果：${observation.slice(0, 200)}`;
    } catch {
      // observation 不是 JSON，作为纯文本处理
      if (observation.includes('❌') || observation.includes('错误')) {
        return `操作遇到了问题：${observation.slice(0, 200)}。让我尝试其他方法。`;
      }
      return `基于工具返回的信息：${observation.slice(0, 200)}`;
    }
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
