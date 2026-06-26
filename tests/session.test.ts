/**
 * session.test.ts - 基础测试
 */

import { sessionManager } from '../src/agent/cli/utils/session.js';
import { ContextManager } from '../src/agent/cli/context-aware.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertEq<T>(a: T, b: T): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`期望 ${b}, 实际 ${a}`);
}

async function main() {
    // 测试 1: 模块导入
    testCount++;
    try {
        assert(sessionManager !== null, 'sessionManager 应存在');
        assert(typeof sessionManager.create === 'function', 'create 方法');
        passCount++;
        console.log('  ✅ 模块导入');
    } catch (e) {
        failCount++;
        console.log(`  ❌ 模块导入: ${(e as Error).message}`);
    }

    // 测试 2: create
    testCount++;
    try {
        const id = sessionManager.create('测试会话');
        assert(typeof id === 'string', '应返回 ID');
        passCount++;
        console.log('  ✅ create');
    } catch (e) {
        failCount++;
        console.log(`  ❌ create: ${(e as Error).message}`);
    }

    // 测试 3: list
    testCount++;
    try {
        const list = sessionManager.list();
        assert(Array.isArray(list), '应返回数组');
        passCount++;
        console.log('  ✅ list');
    } catch (e) {
        failCount++;
        console.log(`  ❌ list: ${(e as Error).message}`);
    }

    // 测试 4: ContextManager 序列化
    testCount++;
    try {
        const ctx = new ContextManager('sys');
        ctx.addUserMessage('hi');
        const json = ctx.toJSON();
        const restored = ContextManager.fromJSON(json);
        assertEq(restored.length, 2); // system + user
        passCount++;
        console.log('  ✅ ContextManager 序列化');
    } catch (e) {
        failCount++;
        console.log(`  ❌ ContextManager 序列化: ${(e as Error).message}`);
    }

    console.log(`\n=== session: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
    process.exit(failCount > 0 ? 1 : 0);
}

main();
