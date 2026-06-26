/**
 * 超时控制模块
 *
 * 防止 Agent 执行任务（如 LLM 调用、文件读取）时卡死。
 * 通过 Promise.race 实现超时自动中断，AbortController 实现真正取消。
 *
 * 使用方式：
 *   import { withTimeoutAndSignal, TimeoutError } from './utils/timeout.js';
 *
 *   // 推荐：使用 withTimeoutAndSignal（真正可取消）
 *   const result = await withTimeoutAndSignal(
 *     (signal) => fetch(url, { signal }),
 *     5000,
 *   );
 *
 *   try {
 *       await withTimeoutAndSignal((s) => callLLM(prompt, s), 30000);
 *   } catch (err) {
 *       if (err instanceof TimeoutError) {
 *           console.error('请求超时');
 *       }
 *   }
 */

// ============================================================
//  TimeoutError — 可区分的超时错误
// ============================================================

/**
 * 超时错误
 *
 * 与普通 Error 区分，便于调用方针对性处理超时。
 */
export class TimeoutError extends Error {
    /** 超时时长（毫秒） */
    readonly timeoutMs: number;

    constructor(ms: number) {
        super(`操作超时 (${ms}ms)`);
        this.name = 'TimeoutError';
        this.timeoutMs = ms;
    }
}

// ============================================================
//  withTimeout — 核心超时包装函数
// ============================================================

/**
 * 为异步函数添加超时控制。
 *
 * 使用 Promise.race 在 fn 和定时器之间竞速：
 * - fn 先完成 → 清除定时器，返回结果
 * - 定时器先触发 → 抛出 TimeoutError
 *
 * **超时后 fn 仍在后台执行，Promise.race 不会取消 fn。**
 * 如需真正取消，请使用 {@link withTimeoutAndSignal}。
 *
 * @param fn  要包装的异步函数
 * @param ms  超时时间（毫秒）
 * @returns   fn 的成功返回值
 * @throws    TimeoutError（超时）或 fn 本身抛出的错误
 * @deprecated 使用 {@link withTimeoutAndSignal} 代替，它通过 AbortSignal 真正取消操作
 *
 * @example
 *   // ❌ 不推荐：超时后 fetch 仍在后台
 *   const reply = await withTimeout(
 *       () => fetch('https://api.openai.com/v1/chat/completions', {...}),
 *       30000,
 *   );
 *
 * @example
 *   // ✅ 推荐：使用 withTimeoutAndSignal
 *   const reply = await withTimeoutAndSignal(
 *       (signal) => fetch('https://api.openai.com/v1/chat/completions', { signal, ... }),
 *       30000,
 *   );
 */
export async function withTimeout<T>(
    fn: () => Promise<T>,
    ms: number,
): Promise<T> {
    if (ms <= 0) {
        return await fn();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new TimeoutError(ms));
        }, ms);
    });

    try {
        const result = await Promise.race([fn(), timeoutPromise]);
        return result;
    } finally {
        // 无论成功还是超时，清除定时器（避免泄漏 + 防止 Node 进程挂起）
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

// ============================================================
//  withTimeoutAndSignal — 超时 + 中止信号组合
// ============================================================

/**
 * 超时 + AbortSignal 组合包装。
 *
 * 当超时发生时，自动触发 AbortSignal 以取消 fn。
 * 这需要 fn 内部支持 AbortSignal（如 fetch）。
 *
 * @param fn     接受 AbortSignal 的异步函数
 * @param ms     超时时间（毫秒）
 * @returns      fn 的成功返回值
 * @throws       TimeoutError（超时）或 fn 本身抛出的错误
 *
 * @example
 *   const data = await withTimeoutAndSignal(
 *       (signal) => fetch(url, { signal }).then(r => r.json()),
 *       5000,
 *   );
 */
export async function withTimeoutAndSignal<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    ms: number,
): Promise<T> {
    if (ms <= 0) {
        const controller = new AbortController();
        return await fn(controller.signal);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    // 监听 abort 事件：超时 → reject TimeoutError
    // 即使 fn 不检查 signal，race 也能保证超时生效
    const abortPromise = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
            reject(new TimeoutError(ms));
        }, { once: true });
    });

    try {
        return await Promise.race([fn(controller.signal), abortPromise]);
    } finally {
        clearTimeout(timer);
    }
}
