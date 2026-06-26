"use strict";
/**
 * errors.ts - LLM 客户端自定义错误类型
 *
 * 理解：就像餐厅的"投诉分类"——区分是"食材不够"还是"厨师请假"。
 * 不同错误需要不同处理方式：有些可以重试，有些必须人工介入。
 *
 * 使用方式：
 *   import { LLMError, NetworkError, isRetryableError } from './errors.js';
 *
 *   try {
 *     await client.chat(messages);
 *   } catch (err) {
 *     if (isRetryableError(err)) {
 *       // 可以自动重试
 *     } else {
 *       // 需要人工介入
 *     }
 *   }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentFilterError = exports.RateLimitError = exports.ModelUnavailableError = exports.NetworkError = exports.AuthenticationError = exports.LLMError = void 0;
exports.isRetryableError = isRetryableError;
exports.isAuthError = isAuthError;
// ============================================================
//  基础错误
// ============================================================
/**
 * 基础 LLM 错误
 *
 * 所有 LLM 相关错误都继承自这个类
 */
class LLMError extends Error {
    code;
    retryable;
    constructor(message, 
    /** 错误码，用于程序判断 */
    code, 
    /** 是否可重试（网络超时等可以重试，认证失败等不行） */
    retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.name = 'LLMError';
    }
}
exports.LLMError = LLMError;
// ============================================================
//  具体错误类型
// ============================================================
/**
 * 认证错误 —— API Key 无效或未设置
 *
 * 不可重试：需要用户更新 API Key
 */
class AuthenticationError extends LLMError {
    constructor(message = 'API Key 无效，请检查配置') {
        super(message, 'AUTH_ERROR', false);
        this.name = 'AuthenticationError';
    }
}
exports.AuthenticationError = AuthenticationError;
/**
 * 网络错误 —— 超时、连接失败等
 *
 * 可重试：网络恢复后可能成功
 */
class NetworkError extends LLMError {
    constructor(message = '网络连接失败') {
        super(message, 'NETWORK_ERROR', true);
        this.name = 'NetworkError';
    }
}
exports.NetworkError = NetworkError;
/**
 * 模型不可用 —— 模型未下载或被删除
 *
 * 不可重试：需要先下载模型
 */
class ModelUnavailableError extends LLMError {
    constructor(message = '模型未找到或不可用') {
        super(message, 'MODEL_UNAVAILABLE', false);
        this.name = 'ModelUnavailableError';
    }
}
exports.ModelUnavailableError = ModelUnavailableError;
/**
 * 速率限制 —— 请求太频繁被限流
 *
 * 可重试：等待一段时间后可能成功
 */
class RateLimitError extends LLMError {
    constructor(message = '请求过于频繁，请稍后重试') {
        super(message, 'RATE_LIMIT', true);
        this.name = 'RateLimitError';
    }
}
exports.RateLimitError = RateLimitError;
/**
 * 内容过滤 —— 敏感内容被安全策略拦截
 *
 * 不可重试：需要修改输入内容
 */
class ContentFilterError extends LLMError {
    constructor(message = '内容被安全策略拦截') {
        super(message, 'CONTENT_FILTER', false);
        this.name = 'ContentFilterError';
    }
}
exports.ContentFilterError = ContentFilterError;
// ============================================================
//  工具函数
// ============================================================
/**
 * 判断一个错误是否可重试
 *
 * @example
 *   if (isRetryableError(err)) {
 *     // 等待后重试
 *     await sleep(1000);
 *     return client.chat(messages);
 *   }
 */
function isRetryableError(error) {
    return error instanceof LLMError && error.retryable;
}
/**
 * 判断是否为认证错误
 *
 * @example
 *   if (isAuthError(err)) {
 *     console.log('请设置正确的 API Key');
 *   }
 */
function isAuthError(error) {
    return error instanceof AuthenticationError;
}
//# sourceMappingURL=errors.js.map