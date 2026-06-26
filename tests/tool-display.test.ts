/**
 * tool-display.test.ts - 基础测试
 */

import { ToolDisplay, formatToolCallSummary } from '../src/agent/cli/utils/tool-display.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

async function main() {
    // 测试 1: 导入
    testCount++;
    try {
        assert(typeof ToolDisplay === 'function', 'ToolDisplay 应是类');
        passCount++;
        console.log('  ✅ 模块导入');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 2: 实例化
    testCount++;
    try {
        const d = new ToolDisplay();
        assert(d !== null, '应实例化');
        passCount++;
        console.log('  ✅ 实例化');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 3: start/complete
    testCount++;
    try {
        const d = new ToolDisplay();
        d.start('readFile', { path: 'test.txt' });
        d.complete('content here');
        const stats = d.getStats();
        assert(stats.total === 1, '应有 1 次调用');
        assert(stats.success === 1, '应成功');
        passCount++;
        console.log('  ✅ start/complete');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 4: fail
    testCount++;
    try {
        const d = new ToolDisplay();
        d.start('failTool', {});
        d.fail(new Error('oops'));
        const stats = d.getStats();
        assert(stats.failed === 1, '应失败 1 次');
        passCount++;
        console.log('  ✅ fail');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 5: formatToolCallSummary
    testCount++;
    try {
        const summary = formatToolCallSummary([]);
        assert(summary.includes('无工具调用'), '空列表应显示无工具调用');
        passCount++;
        console.log('  ✅ formatToolCallSummary');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    console.log(`\n=== tool-display: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
    process.exit(failCount > 0 ? 1 : 0);
}

main();
