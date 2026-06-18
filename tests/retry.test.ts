/**
 * retry 模块测试
 *
 * 测试范围：
 * - withRetry 正常成功（无需重试）
 * - withRetry 失败重试 → 最终成功
 * - withRetry 全失败 → 抛出最后错误
 * - 指数退避时间计算
 * - RetryableError(retryable=false) 立即抛出
 * - onRetry 回调
 * - shouldRetry 自定义判定
 * - backoff 策略: exponential / linear / fixed
 * - jitter 开关
 * - AbortSignal 中止
 * - 边界：retries=0 不重试
 */

import { strict as assert } from 'assert';
import {
    withRetry,
    RetryableError,
    type RetryOptions,
} from '../src/cli/utils/retry.js';

// ============================================================
//  测试工具
// ============================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
    const run = async () => {
        try {
            const result = fn();
            if (result instanceof Promise) await result;
            passed++;
            console.log(`  \x1b[32m✅\x1b[0m ${name}`);
        } catch (err) {
            failed++;
            console.log(`  \x1b[31m❌\x1b[0m ${name}`);
            console.log(`      ${(err as Error).message}`);
        }
    };
    testQueue.push({ name, run });
}

const testQueue: { name: string; run: () => Promise<void> }[] = [];

// ============================================================
//  辅助函数
// ============================================================

/** 创建前 N-1 次失败、第 N 次成功的函数 */
function flakyFn<T>(successValue: T, failures: number): () => Promise<T> {
    let calls = 0;
    return async () => {
        calls++;
        if (calls <= failures) {
            throw new Error(`失败 #${calls}`);
        }
        return successValue;
    };
}

// ============================================================
//  测试用例
// ============================================================

// --- 基本成功 ---

test('正常成功（无需重试）', async () => {
    const result = await withRetry(
        () => Promise.resolve('ok'),
        { retries: 3, delay: 10 },
    );
    assert.equal(result, 'ok');
});

test('返回非字符串值', async () => {
    const result = await withRetry(
        () => Promise.resolve({ id: 1, name: 'test' }),
        { retries: 2, delay: 10 },
    );
    assert.deepStrictEqual(result, { id: 1, name: 'test' });
});

// --- 失败重试成功 ---

test('前 2 次失败，第 3 次成功', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
        calls++;
        if (calls < 3) throw new Error(`失败 #${calls}`);
        return 'success';
    };

    const result = await withRetry(fn, { retries: 3, delay: 10, jitter: false });
    assert.equal(result, 'success');
    assert.equal(calls, 3);
});

test('前 1 次失败，第 2 次成功', async () => {
    const fn = flakyFn('done', 1);
    const result = await withRetry(fn, { retries: 3, delay: 10, jitter: false });
    assert.equal(result, 'done');
});

// --- 全部失败 ---

test('全失败：抛出最后错误', async () => {
    let error: Error | null = null;
    try {
        await withRetry(
            () => Promise.reject(new Error('永远失败')),
            { retries: 2, delay: 10, jitter: false },
        );
    } catch (e) {
        error = e as Error;
    }
    assert.ok(error !== null, '应抛出异常');
    assert.equal(error!.message, '永远失败');
});

test('retries=3 最多执行 3 次', async () => {
    let calls = 0;
    try {
        await withRetry(
            async () => { calls++; throw new Error('fail'); },
            { retries: 3, delay: 10, jitter: false },
        );
    } catch { /* expected */ }
    assert.equal(calls, 3, 'retries=3 应执行恰好 3 次');
});

// --- 退避策略 ---

test('指数退避：delay * 2^(attempt-1)', async () => {
    const delays: number[] = [];
    const baseDelay = 100;

    // 用 flakyFn 触发 2 次重试，收集实际等待时间
    let startTime = Date.now();
    try {
        await withRetry(
            flakyFn('ok', 5), // 永不会成功（最多 3 次）
            {
                retries: 3,
                delay: baseDelay,
                backoff: 'exponential',
                jitter: false,
            },
        );
    } catch { /* expected */ }

    const elapsed = Date.now() - startTime;
    // 重试 1: 100ms, 重试 2: 200ms = 300ms 总等待
    assert.ok(elapsed >= 250, `指数退避总延迟 ≥ 250ms，实际 ${elapsed}ms`);
});

test('线性退避：delay * attempt', async () => {
    const startTime = Date.now();
    try {
        await withRetry(
            flakyFn('ok', 5),
            {
                retries: 3,
                delay: 100,
                backoff: 'linear',
                jitter: false,
            },
        );
    } catch { /* expected */ }

    const elapsed = Date.now() - startTime;
    // 重试 1: 100ms, 重试 2: 200ms = 300ms 总等待
    assert.ok(elapsed >= 250, `线性退避总延迟 ≥ 250ms，实际 ${elapsed}ms`);
});

test('固定退避：每次 delay', async () => {
    const startTime = Date.now();
    try {
        await withRetry(
            flakyFn('ok', 5),
            {
                retries: 3,
                delay: 100,
                backoff: 'fixed',
                jitter: false,
            },
        );
    } catch { /* expected */ }

    const elapsed = Date.now() - startTime;
    // 重试 1: 100ms, 重试 2: 100ms = 200ms 总等待
    assert.ok(elapsed >= 150, `固定退避总延迟 ≥ 150ms，实际 ${elapsed}ms`);
});

// --- RetryableError ---

test('RetryableError(retryable=false) 立即抛出', async () => {
    let attempts = 0;
    try {
        await withRetry(
            async () => {
                attempts++;
                throw new RetryableError('不可重试', false);
            },
            { retries: 3, delay: 10 },
        );
    } catch (e) {
        assert.ok(e instanceof RetryableError);
        assert.equal((e as RetryableError).retryable, false);
    }
    assert.equal(attempts, 1, '不可重试错误应只执行 1 次');
});

test('RetryableError(retryable=true) 会重试', async () => {
    let attempts = 0;
    try {
        await withRetry(
            async () => {
                attempts++;
                throw new RetryableError('可重试', true);
            },
            { retries: 2, delay: 10, jitter: false },
        );
    } catch { /* expected */ }
    assert.equal(attempts, 2, '可重试错误应重试');
});

// --- onRetry 回调 ---

test('onRetry 回调被调用', async () => {
    const records: { error: string; attempt: number }[] = [];
    const onRetry: RetryOptions['onRetry'] = (err, attempt) => {
        records.push({ error: err.message, attempt });
    };

    try {
        await withRetry(
            flakyFn('ok', 5),
            {
                retries: 3,
                delay: 10,
                jitter: false,
                onRetry,
            },
        );
    } catch { /* expected */ }

    assert.ok(records.length >= 2, '至少 2 次回调');
    assert.equal(records[0].attempt, 1);
    assert.equal(records[1].attempt, 2);
});

// --- shouldRetry 自定义判定 ---

test('shouldRetry 自定义：RateLimit 可重试', async () => {
    let attempts = 0;
    try {
        await withRetry(
            async () => {
                attempts++;
                const err = new Error('429 Rate Limit');
                (err as any).statusCode = 429;
                throw err;
            },
            {
                retries: 3,
                delay: 10,
                jitter: false,
                shouldRetry: (e) => (e as any).statusCode === 429,
            },
        );
    } catch { /* expected */ }
    assert.equal(attempts, 3, '429 应触发重试');
});

test('shouldRetry 自定义：401 不重试', async () => {
    let attempts = 0;
    try {
        await withRetry(
            async () => {
                attempts++;
                const err = new Error('401 Unauthorized');
                (err as any).statusCode = 401;
                throw err;
            },
            {
                retries: 3,
                delay: 10,
                jitter: false,
                shouldRetry: (e) => (e as any).statusCode === 429,
            },
        );
    } catch (e) {
        assert.equal((e as Error).message, '401 Unauthorized');
    }
    assert.equal(attempts, 1, '401 不应重试');
});

// --- AbortSignal ---

test('AbortSignal 中止重试', async () => {
    const controller = new AbortController();
    let attempts = 0;

    // 延迟 abort
    setTimeout(() => controller.abort(), 50);

    try {
        await withRetry(
            async () => {
                attempts++;
                throw new Error('fail');
            },
            { retries: 5, delay: 200, signal: controller.signal },
        );
    } catch (e) {
        assert.ok((e as Error).message.includes('中止'));
    }
    // 应只执行了 1 次（或很少），因为很快就被 abort 了
    assert.ok(attempts < 3, `abort 应在重试前终止，实际 ${attempts} 次`);
});

// --- 边界条件 ---

test('边界：retries=0 不重试', async () => {
    let calls = 0;
    try {
        await withRetry(
            async () => { calls++; throw new Error('fail'); },
            { retries: 0, delay: 10 },
        );
    } catch (e) {
        assert.equal((e as Error).message, 'fail');
    }
    assert.equal(calls, 1, 'retries=0 只执行 1 次');
});

test('边界：retries=1 只执行一次', async () => {
    let calls = 0;
    try {
        await withRetry(
            async () => { calls++; throw new Error('fail'); },
            { retries: 1, delay: 10, jitter: false },
        );
    } catch { /* expected */ }
    assert.equal(calls, 1, 'retries=1 只执行 1 次');
});

test('边界：延迟为 0', async () => {
    const result = await withRetry(
        () => Promise.resolve('fast'),
        { retries: 3, delay: 0 },
    );
    assert.equal(result, 'fast');
});

test('边界：空 options', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    assert.equal(result, 42);
});

// ============================================================
//  执行所有测试
// ============================================================

console.log('\n🧪 操作重试模块测试');
console.log('━'.repeat(46));
console.log('');

for (const { name, run } of testQueue) {
    await run();
}

console.log('\n' + '━'.repeat(46));
console.log(`\n📊 测试结果: ${passed}/${passed + failed} 通过`);

if (failed === 0) {
    console.log('🎉 所有测试通过！\n');
    process.exit(0);
} else {
    console.log(`❌ ${failed} 个测试失败\n`);
    process.exit(1);
}
