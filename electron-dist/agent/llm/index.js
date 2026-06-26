"use strict";
/**
 * index.ts - LLM 客户端层统一入口
 *
 * 使用方式：
 *   import { createLLMClient, MockLLMClient, TokenCounter, withRetry } from './llm/index.js';
 *   const client = await createLLMClient();  // 异步自动选择
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenCounter = exports.resolveRetryConfig = exports.withOptionalRetry = exports.withRetry = exports.isAuthError = exports.isRetryableError = exports.ContentFilterError = exports.RateLimitError = exports.ModelUnavailableError = exports.NetworkError = exports.AuthenticationError = exports.LLMError = exports.llmLogger = exports.detectProviderAsync = exports.detectProvider = exports.createLLMClientFromConfig = exports.createLLMClientSync = exports.createLLMClient = exports.DeepSeekClient = exports.OpenAIClient = exports.OllamaClient = exports.MockLLMClient = void 0;
// 客户端
var mock_client_js_1 = require("./mock-client.js");
Object.defineProperty(exports, "MockLLMClient", { enumerable: true, get: function () { return mock_client_js_1.MockLLMClient; } });
var ollama_client_js_1 = require("./ollama-client.js");
Object.defineProperty(exports, "OllamaClient", { enumerable: true, get: function () { return ollama_client_js_1.OllamaClient; } });
var openai_client_js_1 = require("./openai-client.js");
Object.defineProperty(exports, "OpenAIClient", { enumerable: true, get: function () { return openai_client_js_1.OpenAIClient; } });
Object.defineProperty(exports, "DeepSeekClient", { enumerable: true, get: function () { return openai_client_js_1.DeepSeekClient; } });
// 工厂
var client_factory_js_1 = require("./client-factory.js");
Object.defineProperty(exports, "createLLMClient", { enumerable: true, get: function () { return client_factory_js_1.createLLMClient; } });
Object.defineProperty(exports, "createLLMClientSync", { enumerable: true, get: function () { return client_factory_js_1.createLLMClientSync; } });
Object.defineProperty(exports, "createLLMClientFromConfig", { enumerable: true, get: function () { return client_factory_js_1.createLLMClientFromConfig; } });
Object.defineProperty(exports, "detectProvider", { enumerable: true, get: function () { return client_factory_js_1.detectProvider; } });
Object.defineProperty(exports, "detectProviderAsync", { enumerable: true, get: function () { return client_factory_js_1.detectProviderAsync; } });
// 日志
var logger_js_1 = require("./logger.js");
Object.defineProperty(exports, "llmLogger", { enumerable: true, get: function () { return logger_js_1.llmLogger; } });
// 错误
var errors_js_1 = require("./errors.js");
Object.defineProperty(exports, "LLMError", { enumerable: true, get: function () { return errors_js_1.LLMError; } });
Object.defineProperty(exports, "AuthenticationError", { enumerable: true, get: function () { return errors_js_1.AuthenticationError; } });
Object.defineProperty(exports, "NetworkError", { enumerable: true, get: function () { return errors_js_1.NetworkError; } });
Object.defineProperty(exports, "ModelUnavailableError", { enumerable: true, get: function () { return errors_js_1.ModelUnavailableError; } });
Object.defineProperty(exports, "RateLimitError", { enumerable: true, get: function () { return errors_js_1.RateLimitError; } });
Object.defineProperty(exports, "ContentFilterError", { enumerable: true, get: function () { return errors_js_1.ContentFilterError; } });
Object.defineProperty(exports, "isRetryableError", { enumerable: true, get: function () { return errors_js_1.isRetryableError; } });
Object.defineProperty(exports, "isAuthError", { enumerable: true, get: function () { return errors_js_1.isAuthError; } });
// 重试
var retry_js_1 = require("./retry.js");
Object.defineProperty(exports, "withRetry", { enumerable: true, get: function () { return retry_js_1.withRetry; } });
Object.defineProperty(exports, "withOptionalRetry", { enumerable: true, get: function () { return retry_js_1.withOptionalRetry; } });
Object.defineProperty(exports, "resolveRetryConfig", { enumerable: true, get: function () { return retry_js_1.resolveRetryConfig; } });
// Token 计数
var token_counter_js_1 = require("./token-counter.js");
Object.defineProperty(exports, "TokenCounter", { enumerable: true, get: function () { return token_counter_js_1.TokenCounter; } });
//# sourceMappingURL=index.js.map