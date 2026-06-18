/**
 * 操作重试模块
 *
 * 当网络请求、文件操作等因临时故障失败时，自动重试。
 * 支持指数退避、随机抖动、可重试错误判定、回调钩子。
 *
 * 使用方式：
 *   import { withRetry, RetryableError } from './utils/retry.js';
 *
 *   // 基本用法
 *   const result = await withRetry(() => fetch('https://api.example.com'));
 *
 *   // 自定义选项
 *   const result = await withRetry(() => callLLM(prompt), {
 *       retries: 5,
 *       delay: 2000,
 *       onRetry: (err, attempt) => logger.warn(`第 ${attempt} 次重试: ${err.message}`),
 *   });
 *
 *   // 标记不可重试错误
 *   throw new RetryableError('API Key 无效', false);
 */

// ============================================================
//  类型定义
// ============================================================

/** 退避策略 */
export type BackoffStrategy = 'fixed' | 'exponential' | 'linear';

/** withRetry 选项 */
export interface RetryOptions {
    /** 最大重试次数，默认 3 */
    retries?: number;
    /** 基础延迟（毫秒），默认 1000 */
    delay?: number;
    /** 退避策略，默认 'exponential' */
    backoff?: BackoffStrategy;
    /** 是否添加随机抖动（±30%），默认 true */
    jitter?: boolean;
    /** 重试回调 */
    onRetry?: (error: Error, attempt: number, delay: number) => void;
    /** 判定是否可重试，默认所有 Error 可重试 */
    shouldRetry?: (error: Error) => boolean;
    /** 中止信号 */
    signal?: AbortSignal;
    /** 总超时时间（毫秒），超过后放弃重试。默认不限制 */
    maxTotalTimeout?: number;
}

// ============================================================
//  RetryableError — 可控制重试行为的错误
// ============================================================

/**
 * 可重试错误
 *
 * 通过 `retryable` 属性明确标记错误是否值得重试。
 * 例如：429 Rate Limit → 可重试；401 Unauthorized → 不可重试。
 *
 * @example
 *   // 标记为不可重试（withRetry 会直接抛出，不等待）
 *   throw new RetryableError('API Key 无效', false);
 *
 *   // 标记为可重试（与普通 Error 等价，但语义更清晰）
 *   throw new RetryableError('服务暂时不可用', true);
 */
export class RetryableError extends Error {
    /** 该错误是否可重试 */
    readonly retryable: boolean;

    constructor(message: string, retryable = true) {
        super(message);
        this.name = 'RetryableError';
        this.retryable = retryable;
    }
}

// ============================================================
//  withRetry — 核心重试函数
// ============================================================

/**
 * 为异步函数添加自动重试能力。
 *
 * 每次重试前按策略计算等待时间：
 * - fixed:   delay × 1（固定）
 * - linear:  delay × attempt（线性增长）
 * - exponential: delay × 2^(attempt-1)（指数退避）
 *
 * 所有策略默认开启 ±30% 随机抖动，避免「惊群效应」。
 *
 * @param fn      要重试的异步函数
 * @param options 重试选项
 * @returns fn 的成功返回值
 * @throws  最后一次失败的错误（或标记为不可重试的 RetryableError）
 *
 * @example
 *   // 网络请求自动重试
 *   const data = await withRetry(
 *       () => fetch('https://api.example.com/data').then(r => r.json()),
 *       { retries: 3, delay: 500 },
 *   );
 *
 * @example
 *   // 配合 AbortSignal 使用
 *   const controller = new AbortController();
 *   setTimeout(() => controller.abort(), 10000);
 *   await withRetry(() => upload(file), { signal: controller.signal });
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
): Promise<T> {
    const {
        retries = 3,
        delay = 1000,
        backoff = 'exponential',
        jitter = true,
        onRetry,
        shouldRetry,
        signal,
        maxTotalTimeout,
    } = options;

    // retries=0：不重试，直接执行
    if (retries <= 0) {
        return await fn();
    }

    let lastError: unknown;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= retries; attempt++) {
        // 检查是否已中止
        if (signal?.aborted) {
            throw new Error('操作已中止');
        }

        // 检查总超时
        if (maxTotalTimeout && Date.now() - startTime >= maxTotalTimeout) {
            throw lastError ?? new Error(`总重试时间超过限制 (${maxTotalTimeout}ms)`);
        }

        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // ---- 不可重试检查 ----
            if (isNonRetryable(error, shouldRetry)) {
                throw error;
            }

            // ---- 达到最大次数 ----
            if (attempt >= retries) break;

            // ---- 计算等待时间 ----
            let waitTime: number;
            switch (backoff) {
                case 'linear':
                    waitTime = delay * attempt;
                    break;
                case 'fixed':
                    waitTime = delay;
                    break;
                case 'exponential':
                default:
                    waitTime = delay * Math.pow(2, attempt - 1);
                    break;
            }

            // 添加 ±30% 随机抖动
            if (jitter) {
                const jitterFactor = 0.7 + Math.random() * 0.6; // 0.7 ~ 1.3
                waitTime = Math.round(waitTime * jitterFactor);
            }

            // ---- 通知回调 ----
            onRetry?.(error as Error, attempt, waitTime);

            // ---- 等待 ----
            await sleep(waitTime, signal);
        }
    }

    throw lastError;
}

// ============================================================
//  内部工具
// ============================================================

/** 判断错误是否不应重试 */
function isNonRetryable(
    error: unknown,
    shouldRetry?: (error: Error) => boolean,
): boolean {
    // 用户自定义判定
    if (shouldRetry && error instanceof Error) {
        return !shouldRetry(error);
    }

    // RetryableError(retryable=false) → 不可重试
    if (error instanceof RetryableError && !error.retryable) {
        return true;
    }

    // 默认：所有错误都可重试
    return false;
}

/** 带中止信号的 sleep */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('操作已中止'));
            return;
        }

        const timer = setTimeout(resolve, ms);

        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('操作已中止'));
            }, { once: true });
        }
    });
}
