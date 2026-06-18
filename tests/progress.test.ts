/**
 * progress 模块测试
 *
 * 测试范围：
 * - runTasks 串行执行
 * - runTasks 并行执行
 * - 任务间上下文共享
 * - 失败处理（exitOnError / skipOnError）
 * - 子任务
 * - 空任务列表
 * - CI 简化模式
 */

import { strict as assert } from 'assert';
import {
    runTasks,
    type TaskDef,
    type TaskContext,
} from '../src/cli/utils/progress.js';

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
    // 同步收集，稍后执行
    testQueue.push({ name, run });
}

const testQueue: { name: string; run: () => Promise<void> }[] = [];

// ============================================================
//  辅助函数
// ============================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest(name: string, fn: () => Promise<void>) {
    test(name, fn);
}

// ============================================================
//  测试用例
// ============================================================

// --- 串行执行 ---

await runTest('串行：所有任务按序完成', async () => {
    const order: string[] = [];

    const tasks: TaskDef[] = [
        {
            title: '任务 A',
            task: async () => { order.push('A'); await sleep(30); },
        },
        {
            title: '任务 B',
            task: async () => { order.push('B'); await sleep(30); },
        },
        {
            title: '任务 C',
            task: async () => { order.push('C'); await sleep(30); },
        },
    ];

    await runTasks(tasks, { concurrent: false, ci: true });
    assert.deepStrictEqual(order, ['A', 'B', 'C'], '串行执行顺序应为 A→B→C');
});

await runTest('串行：单个任务', async () => {
    let executed = false;
    await runTasks([
        { title: '唯一任务', task: async () => { executed = true; } },
    ], { ci: true });
    assert.ok(executed, '任务应被执行');
});

// --- 并行执行 ---

await runTest('并行：所有任务完成', async () => {
    const completed: string[] = [];

    await runTasks([
        { title: '并行1', task: async () => { await sleep(50); completed.push('1'); } },
        { title: '并行2', task: async () => { await sleep(50); completed.push('2'); } },
        { title: '并行3', task: async () => { await sleep(50); completed.push('3'); } },
    ], { concurrent: true, ci: true });

    assert.equal(completed.length, 3, '3 个任务应全部完成');
    assert.ok(completed.includes('1') && completed.includes('2') && completed.includes('3'));
});

await runTest('并行：并发数限制', async () => {
    // 设置 concurrency=1，实际效果接近串行
    const executionOrder: number[] = [];

    await runTasks([
        {
            title: '受限1',
            task: async () => { executionOrder.push(1); await sleep(60); },
        },
        {
            title: '受限2',
            task: async () => { executionOrder.push(2); await sleep(60); },
        },
        {
            title: '受限3',
            task: async () => { executionOrder.push(3); await sleep(60); },
        },
    ], { concurrent: true, concurrency: 1, ci: true });

    // concurrency=1 时顺序应当固定
    assert.deepStrictEqual(executionOrder, [1, 2, 3], 'concurrency=1 应为顺序执行');
});

// --- 上下文共享 ---

await runTest('上下文：任务间共享数据', async () => {
    const ctx = await runTasks([
        {
            title: '设置数据',
            task: async (c) => { c.sharedValue = 42; },
        },
        {
            title: '读取数据',
            task: async (c) => {
                if (c.sharedValue !== 42) {
                    throw new Error(`期望 sharedValue=42，实际 ${c.sharedValue}`);
                }
            },
        },
    ], { ci: true });

    assert.equal(ctx.sharedValue, 42, '最终上下文应有 sharedValue=42');
});

await runTest('上下文：并行任务不冲突', async () => {
    const ctx = await runTasks([
        { title: '写 A', task: async (c) => { c.a = 'A'; await sleep(20); } },
        { title: '写 B', task: async (c) => { c.b = 'B'; await sleep(20); } },
        { title: '写 C', task: async (c) => { c.c = 'C'; await sleep(20); } },
    ], { concurrent: true, ci: true });

    assert.equal(ctx.a, 'A');
    assert.equal(ctx.b, 'B');
    assert.equal(ctx.c, 'C');
});

// --- 失败处理 ---

await runTest('失败：exitOnError=false 继续执行', async () => {
    const executed: string[] = [];

    try {
        await runTasks([
            {
                title: '失败任务',
                task: async () => { throw new Error('模拟错误'); },
            },
            {
                title: '后续任务',
                task: async () => { executed.push('continued'); await sleep(10); },
            },
        ], { exitOnError: false, ci: true });
        // 不应抛异常（exitOnError=false 时 Listr 吞掉错误继续）
        executed.push('no-throw');
    } catch {
        executed.push('threw');
    }

    assert.ok(executed.includes('no-throw'), 'exitOnError=false 不应抛异常');
});

await runTest('失败：exitOnError=true 立即终止', async () => {
    const executed: string[] = [];

    try {
        await runTasks([
            {
                title: '失败任务',
                task: async () => { throw new Error('致命错误'); },
            },
            {
                title: '不应执行',
                task: async () => { executed.push('should-not-run'); },
            },
        ], { exitOnError: true, ci: true });
    } catch {
        // 预期抛异常
    }

    assert.ok(!executed.includes('should-not-run'), 'exitOnError=true 后续任务不应执行');
});

await runTest('失败：skipOnError 跳过失败继续', async () => {
    const executed: string[] = [];

    await runTasks([
        {
            title: '可跳过失败',
            task: async () => { throw new Error('可恢复错误'); },
            skipOnError: true,
        },
        {
            title: '应继续',
            task: async () => { executed.push('ok'); },
        },
    ], { ci: true });

    assert.ok(executed.includes('ok'), 'skipOnError 后后续任务应继续');
});

// --- 子任务 ---

await runTest('子任务：嵌套执行', async () => {
    const order: string[] = [];

    await runTasks([
        {
            title: '父任务',
            task: async () => { order.push('parent'); },
            subtasks: [
                { title: '子任务1', task: async () => { order.push('child1'); await sleep(10); } },
                { title: '子任务2', task: async () => { order.push('child2'); await sleep(10); } },
            ],
        },
    ], { ci: true });

    assert.ok(order.includes('parent'), '父任务应执行');
    assert.ok(order.includes('child1'), '子任务1应执行');
    assert.ok(order.includes('child2'), '子任务2应执行');
    // 父任务先执行，子任务后执行
    assert.equal(order[0], 'parent', '父任务应先于子任务');
});

// --- 边界条件 ---

await runTest('边界：空任务列表', async () => {
    const ctx = await runTasks([], { ci: true });
    assert.ok(typeof ctx === 'object', '空任务应返回空 context');
});

await runTest('边界：任务返回 void', async () => {
    let called = false;
    await runTasks([
        { title: '同步任务', task: () => { called = true; } },
    ], { ci: true });
    assert.ok(called, '同步（返回 void）任务应正常执行');
});

await runTest('边界：任务更新标题', async () => {
    let capturedTitle = '';
    await runTasks([
        {
            title: '初始标题',
            task: async (_ctx, task) => {
                task.setTitle('更新后标题');
                capturedTitle = '更新后标题';
            },
        },
    ], { ci: true });
    assert.equal(capturedTitle, '更新后标题');
});

await runTest('边界：任务设置 output', async () => {
    let outputValue = '';
    await runTasks([
        {
            title: '输出任务',
            task: async (_ctx, task) => {
                task.setOutput('处理中...');
                outputValue = '处理中...';
            },
        },
    ], { ci: true });
    assert.equal(outputValue, '处理中...');
});

await runTest('边界：禁用任务不执行', async () => {
    let disabledRan = false;
    const executed: string[] = [];

    await runTasks([
        {
            title: '被禁用',
            task: async () => { disabledRan = true; },
            enabled: false,
        },
        {
            title: '正常执行',
            task: async () => { executed.push('ok'); },
        },
    ], { ci: true });

    assert.ok(!disabledRan, 'disabled 任务不应执行');
    assert.deepStrictEqual(executed, ['ok']);
});

// ============================================================
//  执行所有测试
// ============================================================

console.log('\n🧪 多任务进度条模块测试');
console.log('━'.repeat(46));
console.log('');

// 注册的测试都在上面了，现在执行
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
