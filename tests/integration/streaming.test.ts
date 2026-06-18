/**
 * 流式输出模块集成测试
 * 运行: pnpm test:streaming
 *
 * 测试覆盖：
 *   - streamResponse 逐字输出
 *   - printStream 缓冲/非缓冲模式
 *   - StreamHandler 的 processSSE / typewriter / interrupt
 *   - createMockSSEStream 模拟 SSE 流
 *   - [DONE] 信号处理
 *   - 中文/特殊字符流式输出
 */

import { streamResponse, printStream } from '../../src/cli/context-aware.js';
import { StreamHandler, createMockSSEStream, streamToStdout } from '../../src/cli/utils/stream-handler.js';

let testCount = 0;
let passCount = 0;
let failCount = 0;
const pendingAsync: Promise<void>[] = [];

function assertEq<T>(a: T, b: T, msg: string = ''): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error(`${msg ? msg + ': ' : ''}期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
    }
}

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertIncludes(actual: string, expected: string, msg: string = ''): void {
    if (!actual.includes(expected)) {
        throw new Error(`${msg ? msg + ': ' : ''}不包含 "${expected}"`);
    }
}

function test(name: string, fn: () => void | Promise<void>): void {
    testCount++;
    try {
        const result = fn();
        if (result instanceof Promise) {
            pendingAsync.push(
                result.then(() => {
                    passCount++;
                    console.log(`  ✅ ${name}`);
                }).catch((err) => {
                    failCount++;
                    console.log(`  ❌ ${name}: ${(err as Error).message}`);
                }),
            );
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

test('StreamHandler 实例化', () => {
    const h = new StreamHandler();
    assert(typeof h.interrupt === 'function', 'interrupt 应为函数');
    assert(typeof h.typewriter === 'function', 'typewriter 应为函数');
    assert(typeof h.processSSE === 'function', 'processSSE 应为函数');
    assert(h.interrupted === false, '初始不中断');
});

test('createMockSSEStream 返回带正确头的 Response', () => {
    const r = createMockSSEStream('Hi', 0);
    assert(r !== null, '应返回 Response');
    assertEq(r.headers.get('Content-Type'), 'text/event-stream', 'Content-Type 正确');
});

test('streamResponse 逐字产出字符', async () => {
    const chars: string[] = [];
    for await (const ch of streamResponse('Hello', 0)) {
        chars.push(ch);
    }
    assertEq(chars.join(''), 'Hello', '逐字输出应还原原文');
    assertEq(chars.length, 5, '应有 5 个字符');
});

test('streamResponse 中文逐字输出', async () => {
    const chars: string[] = [];
    const text = '你好世界';
    for await (const ch of streamResponse(text, 0)) {
        chars.push(ch);
    }
    assertEq(chars.join(''), text, '中文逐字输出应还原');
});

test('printStream 返回完整文本', async () => {
    const gen = streamResponse('Test output', 0);
    const result = await printStream(gen);
    assertEq(result, 'Test output', '应返回完整文本');
});

test('printStream buffered 模式', async () => {
    const gen = streamResponse('Buffered output', 0);
    const result = await printStream(gen, { buffered: true, bufferSize: 8 });
    assertEq(result, 'Buffered output', '缓冲模式应返回完整文本');
});

// ============================================================
//  异步测试（需要 ReadableStream 环境）
// ============================================================

async function runAsyncTests(): Promise<void> {
    console.log('  🔄 ReadableStream / SSE 异步测试...');
    testCount += 4;

    // 测试 1: processSSE 基本功能
    try {
        const response = createMockSSEStream('Hello World', 0);
        const handler = new StreamHandler();
        const tokens: string[] = [];
        const text = await handler.processSSE(response, {
            onToken: (token) => tokens.push(token),
        });
        assertIncludes(text, 'Hello', 'processSSE 应返回 Hello');
        assert(tokens.length > 0, 'onToken 应被调用');
        passCount++; console.log('  ✅ processSSE 基本功能');
    } catch (err) { failCount++; console.log(`  ❌ processSSE: ${(err as Error).message}`); }

    // 测试 2: streamToStdout
    try {
        const response = createMockSSEStream('stream test', 0);
        const result = await streamToStdout(response, { charDelay: 0 });
        assertIncludes(result, 'stream test', 'streamToStdout 应返回正确文本');
        passCount++; console.log('  ✅ streamToStdout');
    } catch (err) { failCount++; console.log(`  ❌ streamToStdout: ${(err as Error).message}`); }

    // 测试 3: 中断功能
    try {
        const response = createMockSSEStream('A'.repeat(200), 20);
        const handler = new StreamHandler();
        setTimeout(() => handler.interrupt(), 80);
        await handler.processSSE(response);
        assert(handler.interrupted, '应被中断');
        passCount++; console.log('  ✅ interrupt 中断流式输出');
    } catch (err) { failCount++; console.log(`  ❌ interrupt: ${(err as Error).message}`); }

    // 测试 4: [DONE] 空信号
    try {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(c) { c.enqueue(encoder.encode('data: [DONE]\n\n')); c.close(); },
        });
        const response = new Response(stream);
        const handler = new StreamHandler();
        const text = await handler.processSSE(response);
        assertEq(text, '', '[DONE] 信号应返回空字符串');
        passCount++; console.log('  ✅ [DONE] 空信号处理');
    } catch (err) { failCount++; console.log(`  ❌ [DONE]: ${(err as Error).message}`); }
}

await runAsyncTests();
await Promise.all(pendingAsync);

console.log(`\n=== streaming-integration: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
process.exit(failCount > 0 ? 1 : 0);
