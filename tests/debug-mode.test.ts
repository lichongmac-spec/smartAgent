/**
 * debug-mode.test.ts - 基础测试
 */

import { InteractiveDebugger, dumpContext, dumpToolCalls } from '../src/cli/utils/debug-mode.js';
import { ContextManager } from '../src/cli/context-aware.js';

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
        assert(typeof InteractiveDebugger === 'function', 'InteractiveDebugger 应是类');
        assert(typeof dumpContext === 'function', 'dumpContext 应是函数');
        passCount++;
        console.log('  ✅ 模块导入');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 2: dumpContext 不抛异常
    testCount++;
    try {
        const ctx = new ContextManager('sys');
        ctx.addUserMessage('hello');
        dumpContext(ctx);
        passCount++;
        console.log('  ✅ dumpContext');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 3: dumpToolCalls 不抛异常
    testCount++;
    try {
        dumpToolCalls([]);
        passCount++;
        console.log('  ✅ dumpToolCalls');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    // 测试 4: InteractiveDebugger 实例化
    testCount++;
    try {
        const dbg = new InteractiveDebugger();
        assert(dbg !== null, '应实例化');
        passCount++;
        console.log('  ✅ InteractiveDebugger 实例化');
    } catch (e) { failCount++; console.log(`  ❌ ${e}`); }

    console.log(`\n=== debug-mode: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
    process.exit(failCount > 0 ? 1 : 0);
}

main();
