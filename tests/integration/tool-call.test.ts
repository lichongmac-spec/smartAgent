/**
 * 工具调用可视化集成测试
 * 运行: pnpm test:tool-call
 *
 * 测试覆盖：
 *   - start/complete/fail 基本功能
 *   - 嵌套调用追踪
 *   - clear 清空记录
 *   - getStats 统计
 *   - formatToolCallSummary 格式化
 *   - parseToolCallFromChunk 解析 SSE chunk
 */

import {
    ToolDisplay,
    formatToolCallSummary,
    parseToolCallFromChunk,
    type ToolCall,
} from '../../src/cli/utils/tool-display.js';

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertEq<T>(a: T, b: T, msg: string = ''): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error(`${msg ? msg + ': ' : ''}期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
    }
}

function test(name: string, fn: () => void): void {
    testCount++;
    try {
        fn();
        passCount++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failCount++;
        console.log(`  ❌ ${name}: ${(err as Error).message}`);
    }
}

// ============================================================
//  基本功能
// ============================================================

test('start — 创建调用记录并返回 ID', () => {
    const d = new ToolDisplay();
    const id = d.start('read_file', { path: '/tmp/test.txt' });
    assert(typeof id === 'number', '应返回数字 ID');
    assert(id === 0, '第一个调用 ID 应为 0');
});

test('complete — 记录成功结果', () => {
    const d = new ToolDisplay();
    d.start('read_file', { path: '/tmp/test.txt' });
    d.complete('文件内容...');
    const calls = d.getCalls();
    assertEq(calls.length, 1, '应有 1 条记录');
    assertEq(calls[0].name, 'read_file', '工具名称正确');
    assertEq(calls[0].result, '文件内容...', '结果正确');
});

test('fail — 记录错误', () => {
    const d = new ToolDisplay();
    const error = new Error('File not found');
    d.start('read_file', { path: '/tmp/missing.txt' });
    d.fail(error);
    const calls = d.getCalls();
    assertEq(calls.length, 1, '应有 1 条记录');
    assert(calls[0].error instanceof Error, '错误已记录');
    assertEq(calls[0].error?.message, 'File not found', '错误消息正确');
});

// ============================================================
//  高级功能
// ============================================================

test('嵌套调用 — 多层级追踪', () => {
    const d = new ToolDisplay();
    d.start('outer', {});
    d.start('inner', {});
    d.complete('inner result');
    d.complete('outer result');
    const calls = d.getCalls();
    assertEq(calls.length, 2, '应有 2 条记录');
    assertEq(calls[0].name, 'outer', '外部调用名称');
    assertEq(calls[1].name, 'inner', '内部调用名称');
});

test('clear — 清空记录', () => {
    const d = new ToolDisplay();
    d.start('test_tool', {});
    d.complete('done');
    assertEq(d.getCalls().length, 1, '应有 1 条记录');
    d.clear();
    assertEq(d.getCalls().length, 0, '清空后应为 0 条');
});

test('getStats — 统计信息', () => {
    const d = new ToolDisplay();
    d.start('tool_a', {});
    d.complete('ok');
    d.start('tool_b', {});
    d.fail(new Error('fail'));
    d.start('tool_c', {});
    d.complete('ok');

    const stats = d.getStats();
    assertEq(stats.total, 3, '总共 3 次调用');
    assertEq(stats.success, 2, '2 次成功');
    assertEq(stats.failed, 1, '1 次失败');
});

test('formatToolCallSummary — 空列表', () => {
    const summary = formatToolCallSummary([]);
    assert(summary.includes('无工具调用'), '空列表应显示无工具调用');
});

test('formatToolCallSummary — 有内容的列表', () => {
    const calls: ToolCall[] = [
        { name: 'read_file', parameters: {}, timestamp: Date.now(), result: 'content' },
    ];
    const summary = formatToolCallSummary(calls);
    assert(summary.includes('read_file'), '应包含工具名称');
    assert(summary.includes('✓'), '应显示成功标记');
});

test('formatToolCallSummary — 显示错误', () => {
    const calls: ToolCall[] = [
        { name: 'fail_tool', parameters: {}, timestamp: Date.now(), error: new Error('bad') },
    ];
    const summary = formatToolCallSummary(calls);
    assert(summary.includes('✗'), '应显示失败标记');
    assert(summary.includes('bad'), '应包含错误消息');
});

// ============================================================
//  SSE chunk 解析
// ============================================================

test('parseToolCallFromChunk — 解析 tool_calls delta', () => {
    const chunk = {
        raw: {
            choices: [{
                delta: {
                    tool_calls: [{
                        id: 'call_123',
                        function: { name: 'read_file', arguments: '{"path":"test.txt"}' },
                        index: 0,
                    }],
                },
            }],
        },
    };
    const result = parseToolCallFromChunk(chunk);
    assert(result !== null, '应解析出结果');
    assertEq(result!.id, 'call_123', 'ID 正确');
    assertEq(result!.name, 'read_file', '工具名正确');
    assertEq(result!.arguments, '{"path":"test.txt"}', '参数正确');
});

test('parseToolCallFromChunk — 无 tool_calls 返回 null', () => {
    const chunk = { raw: { choices: [{ delta: { content: 'hello' } }] } };
    const result = parseToolCallFromChunk(chunk);
    assertEq(result, null, '无 tool_calls 应返回 null');
});

test('parseToolCallFromChunk — 无 raw 返回 null', () => {
    const chunk = {};
    const result = parseToolCallFromChunk(chunk);
    assertEq(result, null, '无 raw 应返回 null');
});

console.log(`\n=== tool-call-integration: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
process.exit(failCount > 0 ? 1 : 0);
