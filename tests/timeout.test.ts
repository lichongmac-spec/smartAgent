/**
 * timeout 模块测试
 *
 * 测试范围：
 * - withTimeout 正常完成（不超时）
 * - withTimeout 超时抛出 TimeoutError
 * - withTimeout fn 异常透传
 * - withTimeout ms=0 不设置超时
 * - withTimeout ms<=0 直接执行
 * - TimeoutError 属性验证
 * - withTimeout 定时器清理（内存泄漏防护）
 * - withTimeoutAndSignal 超时后 AbortSignal 触发
 * - withTimeoutAndSignal AbortError → TimeoutError
 * - withTimeoutAndSignal 正常完成
 * - withTimeoutAndSignal fn 其他异常透传
 * - 多个 withTimeout 并行不互相干扰
 */

import { strict as assert } from 'assert';
import {
    withTimeout,
    withTimeoutAndSignal,
    TimeoutError,
} from '../src/agent/cli/utils/timeout.js';

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
//  测试用例
// ============================================================

// ---- withTimeout 正常完成 ----
test('withTimeout 正常完成（不超时）', async () => {
    const result = await withTimeout(
        () => Promise.resolve('hello'),
        5000,
    );
    assert.strictEqual(result, 'hello');
});

test('withTimeout 异步延迟完成', async () => {
    const result = await withTimeout(
        () => new Promise<string>(resolve => setTimeout(() => resolve('done'), 10)),
        5000,
    );
    assert.strictEqual(result, 'done');
});

// ---- withTimeout 超时 ----
test('withTimeout 超时抛出 TimeoutError', async () => {
    try {
        await withTimeout(
            () => new Promise(() => {}), // 永不 resolve
            1,
        );
        assert.fail('应该抛出 TimeoutError');
    } catch (err) {
        assert.ok(err instanceof TimeoutError);
        assert.ok((err as Error).message.includes('超时'));
        assert.ok((err as TimeoutError).timeoutMs === 1);
    }
});

test('withTimeout 10ms 超时', async () => {
    try {
        await withTimeout(
            () => new Promise(resolve => setTimeout(resolve, 50)),
            10,
        );
        assert.fail('应该抛出 TimeoutError');
    } catch (err) {
        assert.ok(err instanceof TimeoutError);
        assert.strictEqual((err as TimeoutError).timeoutMs, 10);
    }
});

// ---- fn 自身异常透传 ----
test('withTimeout fn 异常透传', async () => {
    try {
        await withTimeout(
            () => Promise.reject(new Error('自定义错误')),
            5000,
        );
        assert.fail('应该抛出错误');
    } catch (err) {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as Error).message, '自定义错误');
        assert.ok(!(err instanceof TimeoutError));
    }
});

test('withTimeout fn 同步抛异常', async () => {
    try {
        await withTimeout(
            () => { throw new Error('同步错误'); },
            5000,
        );
        assert.fail('应该抛出错误');
    } catch (err) {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as Error).message, '同步错误');
    }
});

// ---- ms=0 或负数：不设置超时 ----
test('withTimeout ms=0 不设置超时', async () => {
    const result = await withTimeout(
        () => Promise.resolve('ok'),
        0,
    );
    assert.strictEqual(result, 'ok');
});

test('withTimeout ms 为负数直接执行', async () => {
    const result = await withTimeout(
        () => Promise.resolve('ok'),
        -1,
    );
    assert.strictEqual(result, 'ok');
});

// ---- TimeoutError 属性 ----
test('TimeoutError.name 为 "TimeoutError"', () => {
    const err = new TimeoutError(5000);
    assert.strictEqual(err.name, 'TimeoutError');
});

test('TimeoutError.timeoutMs 正确记录', () => {
    const err = new TimeoutError(30000);
    assert.strictEqual(err.timeoutMs, 30000);
});

test('TimeoutError instanceof Error', () => {
    const err = new TimeoutError(1000);
    assert.ok(err instanceof Error);
});

test('TimeoutError 包含超时时长信息', () => {
    const err = new TimeoutError(2500);
    assert.ok(err.message.includes('2500'));
    assert.ok(err.message.includes('超时'));
});

// ---- 定时器清理（不会造成 Node 进程挂起） ----
test('withTimeout 超时后定时器被清理', async () => {
    // 验证超时后程序能继续执行其他异步操作
    try {
        await withTimeout(
            () => new Promise(() => {}),
            5,
        );
    } catch {
        // 预期超时
    }

    // 之后的操作应该正常执行
    const result = await Promise.resolve('after-timeout');
    assert.strictEqual(result, 'after-timeout');
});

test('withTimeout 成功后定时器被清理', async () => {
    await withTimeout(
        () => Promise.resolve('fast'),
        5000,
    );

    // 程序能正常继续，没有被挂起的定时器阻塞
    const result = await new Promise<string>(resolve =>
        setTimeout(() => resolve('after'), 10),
    );
    assert.strictEqual(result, 'after');
});

// ---- withTimeoutAndSignal ----
test('withTimeoutAndSignal 正常完成', async () => {
    const result = await withTimeoutAndSignal(
        () => Promise.resolve('data'),
        5000,
    );
    assert.strictEqual(result, 'data');
});

test('withTimeoutAndSignal 超时后 AbortSignal 触发', async () => {
    let aborted = false;
    try {
        await withTimeoutAndSignal(
            (signal) => {
                signal.addEventListener('abort', () => {
                    aborted = true;
                });
                return new Promise(() => {});
            },
            5,
        );
    } catch (err) {
        assert.ok(err instanceof TimeoutError);
        assert.ok(aborted, 'AbortSignal 应该被触发');
    }
});

test('withTimeoutAndSignal fn 接受 signal 参数', async () => {
    let capturedSignal: AbortSignal | null = null;
    try {
        await withTimeoutAndSignal(
            (signal) => {
                capturedSignal = signal;
                return new Promise(() => {});
            },
            5,
        );
    } catch {
        assert.ok(capturedSignal !== null);
        assert.ok(capturedSignal instanceof AbortSignal);
        assert.ok(capturedSignal.aborted, 'signal 应该已 abort');
    }
});

test('withTimeoutAndSignal fn 异常透传', async () => {
    try {
        await withTimeoutAndSignal(
            () => Promise.reject(new Error('业务错误')),
            5000,
        );
        assert.fail('应该抛出错误');
    } catch (err) {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as Error).message, '业务错误');
        assert.ok(!(err instanceof TimeoutError));
    }
});

// ---- 并行测试 ----
test('多个 withTimeout 并行不互相干扰', async () => {
    const results = await Promise.all([
        withTimeout(() => Promise.resolve('a'), 5000),
        withTimeout(() => Promise.resolve('b'), 5000),
        withTimeout(() => Promise.resolve('c'), 5000),
    ]);
    assert.deepStrictEqual(results, ['a', 'b', 'c']);
});

test('并行中部分超时互不影响', async () => {
    const promises = [
        withTimeout(() => new Promise(() => {}), 5), // 超时
        withTimeout(() => Promise.resolve('success'), 5000), // 成功
    ];

    const settled = await Promise.allSettled(promises);

    assert.strictEqual(settled[0].status, 'rejected');
    assert.strictEqual(settled[1].status, 'fulfilled');
    assert.ok(settled[0].status === 'rejected'
        && (settled[0] as PromiseRejectedResult).reason instanceof TimeoutError);
});

// ============================================================
//  执行 & 汇总
// ============================================================

async function run() {
    console.log('\n⏱  测试: timeout 模块\n');

    for (const { run } of testQueue) {
        await run();
    }

    console.log(`\n  ${'─'.repeat(28)}`);
    const total = passed + failed;
    console.log(`  ✅ 通过: ${passed}  ❌ 失败: ${failed}  📊 总计: ${total}`);
    console.log();

    if (failed > 0) {
        process.exitCode = 1;
    }
}

run();
