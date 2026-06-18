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

import { getAliasMap, expandAlias, registerAliases } from '../src/cli/utils/alias.js';
import { Command } from 'commander';

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
//  3. registerAliases — Commander 集成
// ============================================================

test('registerAliases 注入 parse 拦截器', () => {
    const program = new Command();
    const origParse = program.parse.bind(program);

    registerAliases(program);

    // 验证 parse 已被替换（不是原始引用）
    assert(program.parse !== origParse, 'parse 方法应被替换');
});

test('registerAliases — cfg 别名通过 parse 拦截 argv', () => {
    const program = new Command();
    // 注册一个 config 命令，防止 Commander 报错
    program.command('config <action>').action(() => {});

    registerAliases(program);

    const argv = ['node', 'script.js', 'cfg', 'list'];
    program.parse(argv);

    // 验证 argv 已被修改：cfg 变为 config
    assertEq(argv[2], 'config', 'argv[2] 应变为 config');
    assertEq(argv[3], 'list', 'argv[3] 应保持 list');
    assertEq(argv.length, 4, 'argv 长度应为 4');
});

test('registerAliases — 非别名命令不影响 argv', () => {
    const program = new Command();
    // 注册 ask 命令
    program.command('ask <query>').action(() => {});

    registerAliases(program);

    const argv = ['node', 'script.js', 'ask', 'hello'];
    program.parse(argv);

    assertEq(argv[2], 'ask', 'ask 命令应保持不变');
    assertEq(argv[3], 'hello', '参数应保持不变');
});

test('registerAliases — q 别名展开带参数', () => {
    const program = new Command();
    // 注册 ask 命令
    program.command('ask <query>').option('--no-stream').action(() => {});

    registerAliases(program);

    const argv = ['node', 'script.js', 'q', '你好', '--no-stream'];
    program.parse(argv);

    assertEq(argv[2], 'ask', 'argv[2] 应变为 ask');
    assertEq(argv[3], '你好', 'argv[3] 应保持');
    assertEq(argv[4], '--no-stream', 'argv[4] 应保持');
});

// ============================================================
//  结果
// ============================================================
console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
process.exit(failCount > 0 ? 1 : 0);
