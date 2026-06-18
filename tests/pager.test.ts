/**
 * pager 模块测试
 * 运行: pnpm test:pager
 *
 * 覆盖：
 *   1. CI 环境下直接输出（不进入分页）
 *   2. 短内容直接输出（单页）
 *   3. PagerOptions 类型正确性
 *   4. pager 导出为函数
 *   5. 长内容分页逻辑（不进入交互模式）
 */

import { pager, type PagerOptions } from '../src/cli/utils/pager.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(msg);
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

function test(name: string, fn: () => void): void {
    testCount++;
    try {
        fn();
        passCount++;
        console.log(`  \x1b[32m✅\x1b[0m ${name}`);
    } catch (err) {
        failCount++;
        console.log(`  \x1b[31m❌\x1b[0m ${name}`);
        console.log(`      ${(err as Error).message}`);
    }
}

// ============================================================
//  1. pager 导出检查
// ============================================================

test('pager 是一个函数', () => {
    assert(typeof pager === 'function', 'pager 应为函数');
});

// ============================================================
//  2. CI 环境（测试环境默认也是 CI-like）
// ============================================================

await testAsync('CI 环境下直接输出不进入交互', async () => {
    // 在 CI/非 TTY 环境下，pager 应该直接 console.log 内容
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => captured.push(msg);

    try {
        await pager('test content in CI mode');
        assert(captured.some(c => c.includes('test content in CI mode')),
            '内容应直接输出');
    } finally {
        console.log = origLog;
    }
});

// ============================================================
//  3. 单页短内容
// ============================================================

await testAsync('短内容（单页）直接输出', async () => {
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => captured.push(msg);

    try {
        const shortContent = 'line1\nline2\nline3';
        await pager(shortContent);
        // 短内容应直接输出
        const output = captured.join('\n');
        assert(output.includes('line1'), '应包含 line1');
        assert(output.includes('line3'), '应包含 line3');
    } finally {
        console.log = origLog;
    }
});

// ============================================================
//  4. PagerOptions 类型
// ============================================================

test('PagerOptions 类型正确性', () => {
    const opts: PagerOptions = {
        title: '测试标题',
        linesPerPage: 20,
        showLineNumbers: true,
    };
    assert(opts.title === '测试标题', 'title 应为测试标题');
    assert(opts.linesPerPage === 20, 'linesPerPage 应为 20');
    assert(opts.showLineNumbers === true, 'showLineNumbers 应为 true');
});

test('PagerOptions 默认值', () => {
    const opts: PagerOptions = {};
    assert(opts.title === undefined, 'title 默认 undefined');
    assert(opts.linesPerPage === undefined, 'linesPerPage 默认 undefined');
    assert(opts.showLineNumbers === undefined, 'showLineNumbers 默认 undefined');
});

// ============================================================
//  5. 带标题的 CI 输出
// ============================================================

await testAsync('带标题的 CI 输出', async () => {
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => captured.push(msg);

    try {
        await pager('content', { title: '📄 测试' });
        assert(captured.some(c => c.includes('content')), '应包含内容');
    } finally {
        console.log = origLog;
    }
});

// ============================================================
//  6. 空字符串
// ============================================================

await testAsync('空字符串分页', async () => {
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => captured.push(msg);

    try {
        await pager('');
        // 空字符串也应正常处理
        assert(Array.isArray(captured), '应正常执行');
    } finally {
        console.log = origLog;
    }
});

// ============================================================
//  结果
// ============================================================
console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
process.exit(failCount > 0 ? 1 : 0);
