/**
 * retry.ts - 请求重试工具（指数退避）
 *
 * 理解：就像你告诉外卖 App"如果配送超时，自动重新下单"
 * 网络抖动或临时故障时自动重试，提高成功率。
 *
 * 指数退避（Exponential Backoff）：
 *   第 1 次重试：等 1 秒
 *   第 2 次重试：等 2 秒
 *   第 3 次重试：等 4 秒
 *   ...依此类推，避免"雪崩"
 *
 * 使用方式：
 *   import { withRetry } from './retry.js';
 *   const result = await withRetry(() => client.chat(messages), { maxRetries: 3 });
 */

import { LLMError } from './errors.js';
import { debug, info } from './logger.js';
import type { RetryConfig } from './types.js';

/** 默认重试配置 */
const DEFAULT_RETRY: Required<Omit<RetryConfig, 'shouldRetry'>> = {
  maxRetries: 2,
  initialDelay: 1000,
};

/**
 * 默认的重试判断逻辑：只重试可重试错误
 */
function defaultShouldRetry(error: Error): boolean {
  // 只重试网络/超时/可重试错误
  if (error instanceof LLMError && error.retryable) {
    return true;
  }

  // AbortError（超时）也重试
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return true;
  }

  // 网络连接错误（fetch 抛出的 TypeError）
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  return false;
}

/**
 * 带指数退避的请求重试
 *
 * 理解：自动处理临时故障，让程序更稳定
 *
 * @param fn - 要重试的异步函数
 * @param options - 重试配置
 * @returns 函数的返回值
 * @throws 如果所有重试都失败，抛出最后一次的错误
 *
 * @example
 *   // 默认重试 2 次
 *   const resp = await withRetry(() => client.chat(messages));
 *
 *   // 自定义重试次数和延迟
 *   const resp = await withRetry(() => client.chat(messages), {
 *     maxRetries: 5,
 *     initialDelay: 500,
 *   });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryConfig = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_RETRY.maxRetries;
  const initialDelay = options.initialDelay ?? DEFAULT_RETRY.initialDelay;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        debug(`🔄 重试第 ${attempt}/${maxRetries} 次...`);
      }
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // 最后一次尝试，不再重试
      if (attempt >= maxRetries) break;

      // 判断是否应该重试
      if (!shouldRetry(lastError)) {
        debug(`⛔ 错误不可重试，停止重试: ${lastError.message}`);
        break;
      }

      // 计算延迟（指数退避 + 随机抖动 0-500ms）
      const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 500;
      info(`⏳ ${lastError.message.slice(0, 60)}... ${Math.round(delay)}ms 后重试`);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * 解析 ChatOptions 中的 retry 配置
 *
 * 将 boolean | RetryConfig 统一为 RetryConfig | null
 * 返回 null 表示不重试
 */
export function resolveRetryConfig(
  retry?: RetryConfig | boolean,
): RetryConfig | null {
  if (retry === undefined || retry === false) return null;
  if (retry === true) return {};
  return retry;
}

/**
 * 对带重试选项的函数调用进行包装
 *
 * 如果 options.retry 已配置，自动应用 withRetry
 */
export async function withOptionalRetry<T>(
  fn: () => Promise<T>,
  retry?: RetryConfig | boolean,
): Promise<T> {
  const config = resolveRetryConfig(retry);
  if (!config) return fn();
  return withRetry(fn, config);
}

/** 延迟工具 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
