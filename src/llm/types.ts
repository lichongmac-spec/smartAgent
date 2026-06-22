/**
 * types.ts - LLM 客户端层核心类型定义
 *
 * 理解：这就像餐厅的"菜单规范"——规定了每道菜（消息）的格式、配料（参数）等。
 * 所有模块都遵守同一个规范，才能互相协作。
 *
 * 使用方式：
 *   import type { ILLMClient, Message, ChatOptions, ChatResponse } from './types.js';
 */

// ============================================================
//  1. 消息类型 —— 就像"订单上的每一行"
// ============================================================

/**
 * 消息角色：谁在说话？
 *
 * - system:  系统设定的"人设"（如"你是一个有用的助手"）
 * - user:    用户说的话
 * - assistant: AI 的回答
 * - tool:    工具调用的结果
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 一条聊天消息
 *
 * 理解：就像微信里的一条聊天记录
 *
 * @example
 *   { role: 'user', content: '你好' }        // 用户说的
 *   { role: 'assistant', content: '你好！' }  // AI 说的
 *   { role: 'system', content: '你是助手' }   // 系统设定的"人设"
 */
export interface Message {
  role: MessageRole;
  content: string;
}

// ============================================================
//  2. 工具调用 —— 让 AI 能"动手做事"
// ============================================================

/**
 * AI 想要调用的工具
 *
 * 理解：AI 说"我需要用 read_file 工具来读某个文件"
 */
export interface ToolCall {
  /** 工具名（如 "read_file"、"run_terminal"） */
  name: string;
  /** 工具参数（JSON 字符串） */
  arguments: string;
}

/**
 * 工具调用结果
 *
 * 理解：工具执行完的结果，要反馈给 AI
 */
export interface ToolResult {
  /** 对应的工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  name: string;
  /** 调用结果（成功的输出或错误信息） */
  output: string;
}

// ============================================================
//  3. AI 的回复类型
// ============================================================

/**
 * Token 用量统计
 *
 * 理解：就像清点"用了多少食材"
 * Token 是 LLM 的计费单位，大约 1 Token ≈ 0.75 个中文字
 */
export interface TokenUsage {
  /** 输入（你的问题）消耗的 Token */
  promptTokens: number;
  /** 输出（AI 的回答）消耗的 Token */
  completionTokens: number;
  /** 总共消耗的 Token */
  totalTokens: number;
}

/**
 * AI 的回复
 *
 * 理解：就像服务员端上来的菜，包含菜本身和相关信息
 */
export interface ChatResponse {
  /** 回复内容（菜本身） */
  content: string;
  /** 停止原因：stop=自然结束, length=达到长度上限, error=出错 */
  finishReason: 'stop' | 'length' | 'error';
  /** Token 用量统计 */
  usage?: TokenUsage;
  /** 使用的模型名 */
  model?: string;
  /** AI 想要调用的工具列表（ReAct 模式） */
  toolCalls?: ToolCall[];
}

// ============================================================
//  4. 请求选项 —— 就像"点菜时的备注"
// ============================================================

/**
 * 重试配置
 *
 * 理解：就像你告诉服务员"如果 5 分钟还没上菜，再来提醒我"
 * 网络抖动或临时故障时自动重试
 */
export interface RetryConfig {
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
  /** 初始延迟（毫秒），默认 1000ms，每次重试翻倍 */
  initialDelay?: number;
  /** 自定义判断是否应该重试，默认只重试网络/超时错误 */
  shouldRetry?: (error: Error) => boolean;
}

/**
 * 调用 AI 时的可选参数
 *
 * 理解：就像你点菜时说"微辣"、"不要香菜"
 */
export interface ChatOptions {
  /** 温度：控制 AI 的创意程度，0 = 最保守，1 = 最有创意 */
  temperature?: number;
  /** 最大回复长度（Token 数） */
  maxTokens?: number;
  /** 指定用哪个模型 */
  model?: string;
  /** 系统提示词：给 AI 设定"人设" */
  systemPrompt?: string;
  /** 可用工具定义（JSON Schema 格式），用于 Function Calling */
  tools?: ToolDefinition[];
  /**
   * 单次请求超时（毫秒），默认 60000
   *
   * 理解：简单问答可以设短一点（10s），复杂推理设长一点（120s）
   */
  timeout?: number;
  /**
   * 重试配置
   *  - true: 使用默认重试（maxRetries=2, initialDelay=1000ms）
   *  - RetryConfig: 自定义重试
   *  - undefined/void: 不重试（默认）
   */
  retry?: RetryConfig | boolean;
}

/**
 * 工具定义（JSON Schema 格式）
 *
 * 理解：就像告诉 AI"你能用什么工具，每个工具需要什么参数"
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================
//  5. 核心接口 —— 所有客户端必须遵守的"合同"
// ============================================================

/**
 * LLM 客户端接口
 *
 * 理解：这就像"餐厅的通用服务标准"
 * 不管是中餐厅还是西餐厅，都要能"点菜"和"上菜"
 *
 * 所有客户端（Ollama、OpenAI、DeepSeek、Mock）都要实现这个接口
 */
export interface ILLMClient {
  /**
   * 聊天（普通模式）—— 等待完整回复
   *
   * 理解：就像你点完菜，坐在座位上等菜全部上齐
   */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;

  /**
   * 聊天（流式模式）—— 逐字返回
   *
   * 理解：就像吃自助餐，菜一个一个上，边吃边上
   * 打字机效果就是靠这个实现的
   */
  chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;

  /**
   * 健康检查 —— 检查 AI 服务是否在线
   *
   * 理解：就像你打电话给餐厅，确认他们今天营业
   */
  healthCheck(): Promise<boolean>;

  /**
   * 获取可用模型列表
   *
   * 理解：就像问餐厅"今天有哪些招牌菜？"
   * Agent 需要知道当前可调用哪些模型
   */
  listModels(): Promise<string[]>;

  /**
   * 生成文本嵌入向量
   *
   * 理解：把一段文字转成数字向量，用于语义搜索、相似度计算
   * Agent 的 Memory 系统依赖此功能
   *
   * @param text - 要嵌入的文本
   * @returns 嵌入向量（浮点数数组，通常 768 或 1536 维）
   */
  embed(text: string): Promise<number[]>;
}
