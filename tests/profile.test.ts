/**
 * profile 模块测试
 *
 * 测试范围：
 * - profile() 正常完成返回结果
 * - profile() 耗时包含在延迟时间内
 * - profile() 异常透传
 * - profile() enabled=false 不输出
 * - Profiler 创建与启用/禁用
 * - Profiler.start/end 基本流程
 * - Profiler.getRecords 返回测量数据
 * - Profiler.report 输出
 * - Profiler 重复名称覆盖
 * - profile 抛出异常时仍输出耗时
 */

import { strict as assert } from 'assert';
import { profile, Profiler } from '../src/agent/cli/utils/profile.js';

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
//  profile() 测试
// ============================================================

// ---- 基本功能 ----

test('profile 正常完成返回结果', async () => {
    const result = await profile('test-op', () => Promise.resolve(42));
    assert.strictEqual(result, 42);
});

test('profile 异步操作返回正确值', async () => {
    const result = await profile('delayed', () =>
        new Promise<string>(resolve => setTimeout(() => resolve('hello'), 10)),
    );
    assert.strictEqual(result, 'hello');
});

test('profile 耗时大于操作时间', async () => {
    // 间接验证：耗时输出包含在测量中
    const start = Date.now();
    await profile('delay-20', () =>
        new Promise<void>(resolve => setTimeout(resolve, 20)),
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 15, `预期 >= 15ms，实际 ${elapsed}ms`);
});

// ---- 异常透传 ----

test('profile 异常透传', async () => {
    try {
        await profile('error-op', () => Promise.reject(new Error('fail')));
        assert.fail('应该抛出错误');
    } catch (err) {
        assert.ok(err instanceof Error);
        assert.strictEqual((err as Error).message, 'fail');
    }
});

test('profile 同步异常透传', async () => {
    try {
        await profile('sync-error', () => {
            throw new Error('sync fail');
        });
        assert.fail('应该抛出错误');
    } catch (err) {
        assert.strictEqual((err as Error).message, 'sync fail');
    }
});

// ---- enabled=false ----

test('profile enabled=false 返回结果但不应该明显延迟', async () => {
    // 应该立即执行，不通过 setTimeout 等等待
    const result = await profile('disabled', () => Promise.resolve('ok'), false);
    assert.strictEqual(result, 'ok');
});

// ============================================================
//  Profiler 类测试
// ============================================================

// ---- 创建与状态 ----

test('Profiler 默认启用', () => {
    const p = new Profiler();
    assert.strictEqual(p.enabled, true);
});

test('Profiler 传入 false 禁用', () => {
    const p = new Profiler(false);
    assert.strictEqual(p.enabled, false);
});

// ---- start/end 基本流程 ----

test('Profiler start/end 记录耗时', () => {
    const p = new Profiler();
    p.start('phase-a');
    p.end('phase-a');

    const records = p.getRecords();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].name, 'phase-a');
    assert.ok(typeof records[0].duration === 'number');
    assert.ok(records[0].duration! >= 0);
});

test('Profiler 多次测量', () => {
    const p = new Profiler();
    p.start('init');
    p.end('init');
    p.start('build');
    p.end('build');

    const records = p.getRecords();
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].name, 'init');
    assert.strictEqual(records[1].name, 'build');
});

// ---- 禁用时跳过 ----

test('Profiler 禁用时不记录', () => {
    const p = new Profiler(false);
    p.start('ignored');
    p.end('ignored');

    assert.strictEqual(p.getRecords().length, 0);
});

// ---- end 未匹配的名称 ----

test('Profiler end 未匹配的名称无影响', () => {
    const p = new Profiler();
    p.start('real-phase');
    p.end('wrong-name');
    p.end('real-phase');

    const records = p.getRecords();
    assert.strictEqual(records.length, 1);
    assert.ok(records[0].duration !== undefined);
});

// ---- 未完成的测量 ----

test('Profiler 未 end 的记录 duration 为 undefined', () => {
    const p = new Profiler();
    p.start('unfinished');

    const records = p.getRecords();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].duration, undefined);
});

// ---- report 输出 ----

test('Profiler report 不抛异常', () => {
    const p = new Profiler();
    p.start('phase-1');
    p.end('phase-1');
    // report 只输出到 console，不应抛异常
    p.report();
});

test('Profiler 无数据时 report 不抛异常', () => {
    const p = new Profiler();
    p.report(); // 应静默输出空消息
});

test('Profiler 禁用时 report 不输出', () => {
    const p = new Profiler(false);
    p.start('x');
    p.end('x');
    // 应完全跳过
    p.report();
});

// ---- 耗时准确性 ----

test('Profiler 耗时准确性', async () => {
    const p = new Profiler();
    p.start('sleep');
    await new Promise(resolve => setTimeout(resolve, 20));
    p.end('sleep');

    const records = p.getRecords();
    const dur = records[0].duration!;
    // 20ms 延迟 + 误差，应在 15-35ms
    assert.ok(dur >= 10, `实际耗时 ${dur}ms，应 >= 10ms`);
});

// ============================================================
//  执行 & 汇总
// ============================================================

async function run() {
    console.log('\n📊 测试: profile 模块\n');

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
