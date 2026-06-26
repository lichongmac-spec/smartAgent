/**
 * stream-handler.test.ts
 */

import { createMockSSEStream, StreamHandler, streamToStdout } from '../src/agent/cli/utils/stream-handler.js';

let testCount = 0;
let passCount = 0;
let failCount = 0;
const pendingAsync: Promise<void>[] = [];

function assertEq<T>(actual: T, expected: T, msg: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
    }
}

function assertIncludes(actual: string, expected: string, msg: string): void {
    if (!actual.includes(expected)) {
        throw new Error(`${msg}\n    期望包含: ${expected}`);
    }
}

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(msg);
}

function test(name: string, fn: () => void | Promise<void>): void {
    testCount++;
    try {
        const result = fn();
        if (result instanceof Promise) {
            const p = result.then(() => {
                passCount++;
                console.log(`  ✅ ${name}`);
            }).catch((err) => {
                failCount++;
                console.log(`  ❌ ${name}: ${err.message}`);
            });
            pendingAsync.push(p);
        } else {
            passCount++;
            console.log(`  ✅ ${name}`);
        }
    } catch (err) {
        failCount++;
        console.log(`  ❌ ${name}: ${(err as Error).message}`);
    }
}

// ============================================================
//  同步测试
// ============================================================

test('StreamHandler — 实例化', () => {
    const h = new StreamHandler();
    assertEq(typeof h.interrupt, 'function', 'interrupt 应为函数');
});

test('createMockSSEStream — 返回 Response', () => {
    const r = createMockSSEStream('Hi', 0);
    assert(r !== null, '应返回 Response');
    assertEq(r.headers.get('Content-Type'), 'text/event-stream', 'Content-Type 应为 text/event-stream');
});

// ============================================================
//  异步测试
// ============================================================

async function runAsyncTests(): Promise<void> {
    console.log('  🔄 异步测试...');

    // 测试 1: processSSE 基本功能
    try {
        const response = createMockSSEStream('Hello', 0);
        const handler = new StreamHandler();
        const text = await handler.processSSE(response);
        assertIncludes(text, 'Hello', 'processSSE 应返回包含 Hello 的文本');
        passCount++;
        console.log('  ✅ processSSE 基本功能');
    } catch (err) {
        failCount++;
        console.log(`  ❌ processSSE: ${(err as Error).message}`);
    }
    testCount++;

    // 测试 2: streamToStdout
    try {
        const response = createMockSSEStream('test', 0);
        const result = await streamToStdout(response, { charDelay: 0 });
        assertIncludes(result, 'test', 'streamToStdout 应返回包含 test 的文本');
        passCount++;
        console.log('  ✅ streamToStdout');
    } catch (err) {
        failCount++;
        console.log(`  ❌ streamToStdout: ${(err as Error).message}`);
    }
    testCount++;

    // 测试 3: 中断
    try {
        const response = createMockSSEStream('A'.repeat(50), 30);
        const handler = new StreamHandler();
        setTimeout(() => handler.interrupt(), 50);
        await handler.processSSE(response);
        assert(handler.interrupted, '应被中断');
        passCount++;
        console.log('  ✅ interrupt');
    } catch (err) {
        failCount++;
        console.log(`  ❌ interrupt: ${(err as Error).message}`);
    }
    testCount++;

    // 测试 4: [DONE] 信号
    try {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(c) {
                c.enqueue(encoder.encode('data: [DONE]\n\n'));
                c.close();
            },
        });
        const response = new Response(stream);
        const handler = new StreamHandler();
        const text = await handler.processSSE(response);
        assertEq(text, '', '[DONE] 信号应返回空字符串');
        passCount++;
        console.log('  ✅ [DONE] 信号处理');
    } catch (err) {
        failCount++;
        console.log(`  ❌ [DONE]: ${(err as Error).message}`);
    }
    testCount++;
}

await runAsyncTests();

console.log(`\n=== stream-handler: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
process.exit(failCount > 0 ? 1 : 0);
