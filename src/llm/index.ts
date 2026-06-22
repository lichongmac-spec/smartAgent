/**
 * index.ts - LLM 客户端层统一入口
 *
 * 使用方式：
 *   import { createLLMClient, MockLLMClient, llmLogger } from './llm/index.js';
 *   const client = await createLLMClient();  // 异步自动选择
 */

// 类型
export type {
  ILLMClient,
  Message,
  MessageRole,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  ToolCall,
  ToolResult,
  ToolDefinition,
} from './types.js';

// 客户端
export { MockLLMClient } from './mock-client.js';
export { OllamaClient } from './ollama-client.js';
export { OpenAIClient, DeepSeekClient } from './openai-client.js';

// 工厂
export { createLLMClient, createLLMClientSync, detectProvider, detectProviderAsync } from './client-factory.js';
export type { LLMClientConfig, ProviderType } from './client-factory.js';

// 日志
export { llmLogger } from './logger.js';

// 错误
export {
  LLMError,
  AuthenticationError,
  NetworkError,
  ModelUnavailableError,
  RateLimitError,
  ContentFilterError,
  isRetryableError,
  isAuthError,
} from './errors.js';
