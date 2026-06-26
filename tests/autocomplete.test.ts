/**
 * autocomplete 模块测试
 *
 * 测试范围：
 * - commonPrefix() — 公共前缀计算
 * - chatCompleter() — chat 命令补全
 * - filePathCompleter() — 文件路径补全
 * - configKeyCompleter() — 配置 key 补全
 * - setupAutocomplete() — readline 注册
 */

import { strict as assert } from 'assert';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import {
    setupAutocomplete,
    chatCompleter,
    filePathCompleter,
    configKeyCompleter,
    commonPrefix,
} from '../src/agent/cli/utils/autocomplete.js';

// ============================================================
//  测试工具
// ============================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        passed++;
        console.log(`  ✅ 通过: ${name}`);
    } catch (err) {
        failed++;
        console.log(`  ❌ 失败: ${name}`);
        console.log(`      ${(err as Error).message}`);
    }
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
    assert.equal(actual, expected, msg);
}

function assertOk(value: unknown, msg?: string) {
    assert.ok(value, msg);
}


// ============================================================
//  测试 — commonPrefix
// ============================================================

console.log('\n📝 commonPrefix（公共前缀计算）\n');

test('空数组返回空串', () => {
    assertEqual(commonPrefix([]), '');
});

test('单元素返回自身', () => {
    assertEqual(commonPrefix(['hello']), 'hello');
});

test('有公共前缀', () => {
    assertEqual(commonPrefix(['hello', 'help', 'helicopter']), 'hel');
});

test('无公共前缀返回空串', () => {
    assertEqual(commonPrefix(['abc', 'def', 'ghi']), '');
});

test('全部相同', () => {
    assertEqual(commonPrefix(['test', 'test', 'test']), 'test');
});

test('含空字符串', () => {
    assertEqual(commonPrefix(['', 'abc']), '');
});

// ============================================================
//  测试 — chatCompleter
// ============================================================

console.log('\n💬 chatCompleter（Chat 命令补全）\n');

test('空行无补全', () => {
    const result = chatCompleter('');
    assertEqual(result.length, 0);
});

test('普通文本无补全', () => {
    const result = chatCompleter('你好');
    assertEqual(result.length, 0);
});

test('/exit 完整匹配', () => {
    const result = chatCompleter('/exit');
    assertEqual(result.length, 1);
    assertEqual(result[0].value, '/exit');
});

test('/ 开头列出所有命令', () => {
    const result = chatCompleter('/');
    assertOk(result.length >= 4, `应有至少 4 个命令，实际 ${result.length}`);
    // 验证去重：所有 value 唯一
    const values = result.map((i) => i.value);
    assertEqual(values.length, new Set(values).size);
});

test('/cle 部分匹配', () => {
    const result = chatCompleter('/cle');
    assertEqual(result.length, 1);
    assertEqual(result[0].value, '/clear');
});

test('/h 匹配多个', () => {
    const result = chatCompleter('/h');
    // /help 肯定匹配
    assertOk(result.some((i) => i.value === '/help'), '应包含 /help');
});

test('前置空格不影响', () => {
    const result = chatCompleter('   /exit');
    assertEqual(result.length, 1);
    assertEqual(result[0].value, '/exit');
});

test('/unknown 无匹配', () => {
    const result = chatCompleter('/unknown');
    assertEqual(result.length, 0);
});

test('所有命令有 description', () => {
    const result = chatCompleter('/');
    for (const item of result) {
        assertOk(item.value.startsWith('/'), `${item.value} 应以 / 开头`);
        assertOk(typeof item.description === 'string', `${item.value} 应有描述`);
    }
});

// ============================================================
//  测试 — filePathCompleter
// ============================================================

console.log('\n📂 filePathCompleter（文件路径补全）\n');

let tmpDir: string;

{
    // 创建临时目录和测试文件
    tmpDir = mkdtempSync(join(tmpdir(), 'sa-autocomplete-'));
    mkdirSync(join(tmpDir, 'subdir'), { recursive: true });
    writeFileSync(join(tmpDir, 'hello.txt'), 'test');
    writeFileSync(join(tmpDir, 'help.md'), 'test');
    writeFileSync(join(tmpDir, 'world.json'), 'test');

    const savedCwd = process.cwd();
    process.chdir(tmpDir);

    test('空字符串列出当前目录文件', () => {
        const result = filePathCompleter('');
        const names = result.map((i) => i.value);
        assertOk(names.includes('hello.txt'), '应包含 hello.txt');
        assertOk(names.includes('help.md'), '应包含 help.md');
        assertOk(names.includes('world.json'), '应包含 world.json');
        assertOk(names.includes('subdir/'), '应包含 subdir/');
        // 隐藏文件不应出现（.开头）
        assertOk(!names.some((n) => n.startsWith('.')), '不应包含隐藏文件');
    });

    test('前缀匹配', () => {
        const result = filePathCompleter('hel');
        const names = result.map((i) => i.value);
        assertEqual(names.length, 2, `应匹配 2 个文件，实际 ${names.length}: ${names.join(', ')}`);
        assertOk(names.includes('hello.txt'));
        assertOk(names.includes('help.md'));
    });

    test('目录后缀有 /', () => {
        const result = filePathCompleter('sub');
        const sub = result.find((i) => i.value === 'subdir/');
        assertOk(sub, 'subdir 应以 / 结尾');
        assertEqual(sub?.description, '目录');
    });

    test('无匹配前缀返回空', () => {
        const result = filePathCompleter('nonexistent_xyz');
        assertEqual(result.length, 0);
    });

    process.chdir(savedCwd);
    rmSync(tmpDir, { recursive: true, force: true });
}

// ============================================================
//  测试 — configKeyCompleter
// ============================================================

console.log('\n🔑 configKeyCompleter（配置 key 补全）\n');

const configKeys = ['apiKey', 'model', 'maxTokens', 'temperature', 'baseURL'];

test('空输入返回空', () => {
    const completer = configKeyCompleter(configKeys);
    const result = completer('');
    assertEqual(result.length, 0);
});

test('部分匹配 apiKey', () => {
    const completer = configKeyCompleter(configKeys);
    const result = completer('api');
    assertEqual(result.length, 1);
    assertEqual(result[0].value, 'apiKey');
});

test('m 匹配多个', () => {
    const completer = configKeyCompleter(configKeys);
    const result = completer('m');
    // model, maxTokens
    assertEqual(result.length, 2);
    assertOk(result.some((i) => i.value === 'model'));
    assertOk(result.some((i) => i.value === 'maxTokens'));
});

test('无匹配返回空', () => {
    const completer = configKeyCompleter(configKeys);
    const result = completer('unknown');
    assertEqual(result.length, 0);
});

test('完整命令取最后一个 token', () => {
    const completer = configKeyCompleter(configKeys);
    const result = completer('config set api');
    // 最后一个 token 是 'api'，应匹配 apiKey
    assertEqual(result.length, 1);
    assertEqual(result[0].value, 'apiKey');
});

test('自定义 keys 列表', () => {
    const custom = ['foo', 'bar', 'baz', 'foobar'];
    const completer = configKeyCompleter(custom);
    const result = completer('ba');
    assertEqual(result.length, 2);
    assertOk(result.some((i) => i.value === 'bar'));
    assertOk(result.some((i) => i.value === 'baz'));
});

// ============================================================
//  测试 — setupAutocomplete
// ============================================================

console.log('\n🔌 setupAutocomplete（readline 注册）\n');

test('注册后 rl 有 completer 属性', () => {
    // 用假对象模拟 readline.Interface
    const fakeRL: any = {
        getPrompt: () => '> ',
        completer: undefined,
    };

    setupAutocomplete(fakeRL as any, chatCompleter);

    assertOk(typeof fakeRL.completer === 'function', 'completer 应为函数');
});

test('completer 回调机制 — 单匹配', () => {
    const fakeRL: any = {
        getPrompt: () => '> ',
    };

    setupAutocomplete(fakeRL as any, chatCompleter);

    let captured!: [string[], string];
    fakeRL.completer('/exit', (_err: null, result: [string[], string]) => {
        captured = result;
    });

    assertOk(captured, '回调应被调用');
    const [hits, line] = captured;
    assertOk(hits.length > 0, '应有补全结果');
    assertEqual(line, '/exit');
});

test('completer 回调机制 — 无匹配', () => {
    const fakeRL: any = {
        getPrompt: () => '> ',
    };

    setupAutocomplete(fakeRL as any, chatCompleter);

    let captured!: [string[], string];
    fakeRL.completer('/unknown', (_err: null, result: [string[], string]) => {
        captured = result;
    });

    const [hits] = captured;
    assertEqual(hits.length, 0, '无匹配应返回空');
});

test('completer 抛异常时优雅降级', () => {
    const fakeRL: any = {
        getPrompt: () => '> ',
    };

    // 故意传一个会崩的 completer
    setupAutocomplete(fakeRL as any, () => {
        throw new Error('mock error');
    });

    let captured!: [string[], string];
    fakeRL.completer('anything', (_err: null, result: [string[], string]) => {
        captured = result;
    });

    // 不应崩溃，返回空
    assertOk(captured, '回调应被调用（降级）');
    assertEqual(captured[0].length, 0);
});

// ============================================================
//  测试总结
// ============================================================

console.log('\n' + '━'.repeat(50));
console.log(`\n📊 测试结果: ${passed}/${passed + failed} 通过`);

if (failed === 0) {
    console.log('🎉 所有测试通过！\n');
    process.exit(0);
} else {
    console.log(`❌ ${failed} 个测试失败\n`);
    process.exit(1);
}
