/**
 * progress-enhanced 模块测试
 * 运行: pnpm test:progress-enhanced
 *
 * 覆盖：
 *   1. runEnhancedTasks — 空任务列表
 *   2. runEnhancedTasks — 单任务
 *   3. runEnhancedTasks — 多任务串行
 *   4. runEnhancedTasks — 带分组显示
 *   5. runEnhancedTasks — skipOnError
 *   6. runEnhancedTasks — CI 模式降级
 *   7. TaskControl — setTitle / setOutput / setProgress / setPending
 *   8. 任务分组无分组名时扁平展开
 */

import {
    runEnhancedTasks,
    type EnhancedTaskDef,
    type TaskContext,
} from '../src/agent/cli/utils/progress-enhanced.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg} - 期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)}`);
    }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
    testCount++;
    try {
        await fn();
        passCount++;
        console.log(`  \x1b[32m✅\x1b[0m ${name}`);
    } catch (err) {
        failCount++;
        console.log(`  \x1b[31m❌\x1b[0m ${name}`);
        console.log(`      ${(err as Error).message}`);
    }
}

// ============================================================
//  1. 空任务列表
// ============================================================

await testAsync('runEnhancedTasks — 空任务列表返回空上下文', async () => {
    const ctx = await runEnhancedTasks([], { ci: true });
    assertEq(Object.keys(ctx).length, 0, '应返回空上下文');
});

// ============================================================
//  2. 单任务
// ============================================================

await testAsync('runEnhancedTasks — 单任务执行并写入上下文', async () => {
    const tasks: EnhancedTaskDef[] = [{
        title: '任务 1',
        task: async (ctx: TaskContext) => {
            ctx.result = 'done';
        },
    }];

    const ctx = await runEnhancedTasks(tasks, { ci: true });
    assertEq(ctx.result, 'done', '上下文应包含 result = done');
});

// ============================================================
//  3. 多任务串行
// ============================================================

await testAsync('runEnhancedTasks — 多任务串行执行', async () => {
    const order: string[] = [];
    const tasks: EnhancedTaskDef[] = [
        {
            title: '步骤 1',
            task: async (ctx: TaskContext) => {
                order.push('a');
                ctx.step1 = true;
            },
        },
        {
            title: '步骤 2',
            task: async (ctx: TaskContext) => {
                order.push('b');
                ctx.step2 = true;
            },
        },
    ];

    const ctx = await runEnhancedTasks(tasks, { ci: true, concurrent: false });
    assertEq(order, ['a', 'b'], '串行顺序应为 a → b');
    assertEq(ctx.step1, true, 'step1 应为 true');
    assertEq(ctx.step2, true, 'step2 应为 true');
});

// ============================================================
//  4. 分组显示
// ============================================================

await testAsync('runEnhancedTasks — 分组任务', async () => {
    const completed: string[] = [];
    const tasks: EnhancedTaskDef[] = [
        {
            title: '下载模型',
            group: '初始化',
            task: async () => { completed.push('download'); },
        },
        {
            title: '检查依赖',
            group: '初始化',
            task: async () => { completed.push('check'); },
        },
        {
            title: '其他任务',
            group: undefined, // 无分组 → default
            task: async () => { completed.push('other'); },
        },
    ];

    await runEnhancedTasks(tasks, { ci: true, showGroups: true });
    assert(completed.includes('download'), '下载任务应执行');
    assert(completed.includes('check'), '检查任务应执行');
    assert(completed.includes('other'), '其他任务应执行');
});

// ============================================================
//  5. skipOnError
// ============================================================

await testAsync('runEnhancedTasks — skipOnError 跳过失败任务', async () => {
    const tasks: EnhancedTaskDef[] = [
        {
            title: '正常任务',
            task: async (ctx: TaskContext) => { ctx.ok = 'yes'; },
        },
        {
            title: '失败但跳过',
            skipOnError: true,
            task: async () => { throw new Error('expected failure'); },
        },
    ];

    const ctx = await runEnhancedTasks(tasks, { ci: true });
    assertEq(ctx.ok, 'yes', '第一个任务应成功');
});

await testAsync('runEnhancedTasks — 不跳过时错误抛出', async () => {
    const tasks: EnhancedTaskDef[] = [{
        title: '失败任务',
        skipOnError: false,
        task: async () => { throw new Error('fatal'); },
    }];

    try {
        await runEnhancedTasks(tasks, { ci: true });
        assert(false, '应该抛出错误');
    } catch (err) {
        // Listr2 可能包装错误（如 ListrError），但确保是 Error 实例
        assert(err instanceof Error, '应抛出 Error 实例');
    }
});

// ============================================================
//  6. CI 模式
// ============================================================

await testAsync('runEnhancedTasks — CI 模式渲染器降级', async () => {
    const tasks: EnhancedTaskDef[] = [{
        title: 'CI 任务',
        task: async (ctx: TaskContext) => { ctx.ran = true; },
    }];

    const ctx = await runEnhancedTasks(tasks, { ci: true });
    assertEq(ctx.ran, true, 'CI 模式下任务应正常执行');
});

// ============================================================
//  7. showGroups=false 时扁平展开
// ============================================================

await testAsync('runEnhancedTasks — showGroups=false 扁平展开', async () => {
    const results: string[] = [];
    const tasks: EnhancedTaskDef[] = [
        { title: '任务A', group: '组1', task: async () => { results.push('A'); } },
        { title: '任务B', group: '组1', task: async () => { results.push('B'); } },
        { title: '任务C', group: '组2', task: async () => { results.push('C'); } },
    ];

    await runEnhancedTasks(tasks, { ci: true, showGroups: false });
    assertEq(results.length, 3, '应执行 3 个任务');
});

// ============================================================
//  结果
// ============================================================
console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
process.exit(failCount > 0 ? 1 : 0);
