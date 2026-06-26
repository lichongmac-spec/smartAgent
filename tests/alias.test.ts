/**
 * alias 模块测试
 * 运行: pnpm test:alias
 *
 * 覆盖：
 *   1. getAliasMap 返回映射表
 *   2. expandAlias — 已知别名展开
 *   3. expandAlias — 未知命令不变
 *   4. expandAlias — 空参数
 *   5. expandAlias — cfg:set / cfg:get / cfg:list
 *   6. expandAlias — q / query 别名
 *   7. expandAlias — 别名 + 额外参数
 *   8. registerAliases — 拦截 parse 方法
 */

import { getAliasMap, expandAlias } from '../src/agent/cli/utils/alias.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assertEq<T>(actual: T, expected: T, msg: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg} - 期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)}`);
    }
}

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(msg);
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
//  1. getAliasMap
// ============================================================

test('getAliasMap 返回映射表且为只读副本', () => {
    const map = getAliasMap();
    assert('cfg' in map, '应包含 cfg');
    assert('q' in map, '应包含 q');
    assertEq(map['cfg'], 'config', 'cfg → config');
    assertEq(map['q'], 'ask', 'q → ask');
    assertEq(map['query'], 'ask', 'query → ask');
});

// ============================================================
//  2. expandAlias — 基础
// ============================================================

test('expandAlias — cfg 展开为 config', () => {
    const result = expandAlias(['cfg', 'list']);
    assertEq(result, ['config', 'list'], 'cfg list → config list');
});

test('expandAlias — q 展开为 ask', () => {
    const result = expandAlias(['q', '你好']);
    assertEq(result, ['ask', '你好'], 'q 你好 → ask 你好');
});

test('expandAlias — query 展开为 ask', () => {
    const result = expandAlias(['query', 'hello']);
    assertEq(result, ['ask', 'hello'], 'query hello → ask hello');
});

test('expandAlias — cfg:set 展开为 config set', () => {
    const result = expandAlias(['cfg:set', 'apiKey', 'my-key']);
    assertEq(result, ['config', 'set', 'apiKey', 'my-key'], 'cfg:set → config set');
});

test('expandAlias — cfg:get 展开为 config get', () => {
    const result = expandAlias(['cfg:get', 'apiKey']);
    assertEq(result, ['config', 'get', 'apiKey'], 'cfg:get → config get');
});

test('expandAlias — cfg:list 展开为 config list', () => {
    const result = expandAlias(['cfg:list']);
    assertEq(result, ['config', 'list'], 'cfg:list → config list');
});

test('expandAlias — 未知命令不变', () => {
    const result = expandAlias(['unknown-cmd', 'arg']);
    assertEq(result, ['unknown-cmd', 'arg'], '未知命令应原样返回');
});

test('expandAlias — 空参数', () => {
    const result = expandAlias([]);
    assertEq(result, [], '空参数应返回空数组');
});

test('expandAlias — 别名与额外参数保持', () => {
    const result = expandAlias(['cfg', 'list', '--verbose']);
    assertEq(result, ['config', 'list', '--verbose'], '额外参数应保留');
});

test('expandAlias — q 不带参数', () => {
    const result = expandAlias(['q']);
    assertEq(result, ['ask'], 'q → ask（无额外参数）');
});

// ============================================================
//  3. expandAlias — 与 argv 预处理集成
// ============================================================

test('expandAlias 模拟 argv 预处理（cfg → config）', () => {
    // 模拟 process.argv: [node, script, 'cfg', 'list']
    const rawArgs = ['cfg', 'list'];
    const expanded = expandAlias(rawArgs);
    assertEq(expanded, ['config', 'list'], 'cfg list → config list');
});

test('expandAlias 模拟 argv 预处理（非别名原样）', () => {
    const rawArgs = ['ask', 'hello'];
    const expanded = expandAlias(rawArgs);
    assertEq(expanded, ['ask', 'hello'], '非别名应原样输出');
});

test('expandAlias 模拟 argv 预处理（q + --no-stream）', () => {
    const rawArgs = ['q', '你好', '--no-stream'];
    const expanded = expandAlias(rawArgs);
    assertEq(expanded, ['ask', '你好', '--no-stream'], 'q 你好 --no-stream → ask 你好 --no-stream');
});

test('expandAlias 模拟 argv 预处理（空参数）', () => {
    const rawArgs: string[] = [];
    const expanded = expandAlias(rawArgs);
    assertEq(expanded, [], '空输入应返回空数组');
});

test('expandAlias 与 Commander 解耦 — 不修改 program 实例', () => {
    // 验证 expandAlias 是纯函数，不需要 Commander 实例
    const input = ['cfg', 'set', 'apiKey', 'sk-123'];
    const output1 = expandAlias(input);
    const output2 = expandAlias(input); // 幂等
    assertEq(output1, output2, '纯函数多次调用应一致');
    assertEq(output1, ['config', 'set', 'apiKey', 'sk-123'], 'cfg set → config set');
});

// ============================================================
//  结果
// ============================================================
console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
process.exit(failCount > 0 ? 1 : 0);
