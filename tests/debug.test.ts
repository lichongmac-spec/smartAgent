/**
 * debug 模块测试
 * 运行: pnpm test:debug
 *
 * 覆盖：
 *   1. setVerbose 切换状态
 *   2. isVerbose 查询
 *   3. debug 单参数（string / Error / object）
 *   4. debug 多参数合并
 *   5. debug verbose=false 时不输出
 *   6. setVerbose 联动 configureLogger
 *   7. 边界：空参数、null/undefined、循环引用对象
 */

import {
    setVerbose,
    isVerbose,
    debug,
} from '../src/cli/utils/debug.js';
import { getLoggerConfig } from '../src/cli/logger.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
let failCount = 0;

function captureConsole(fn: () => void): { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (msg: string) => stdout.push(msg);
    console.error = (msg: string) => stderr.push(msg);
    try {
        fn();
    } finally {
        console.log = origLog;
        console.error = origErr;
    }
    return { stdout, stderr };
}

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
    if (actual !== expected) {
        throw new Error(`${msg} - 期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)}`);
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
//  测试前：重置 verbose 为 false
// ============================================================
setVerbose(false);

// ============================================================
//  1. setVerbose / isVerbose 状态测试
// ============================================================

test('isVerbose 初始为 false', () => {
    setVerbose(false);
    assert(isVerbose() === false, '应返回 false');
});

test('setVerbose(true) 后 isVerbose 为 true', () => {
    setVerbose(true);
    assert(isVerbose() === true, '应返回 true');
});

test('setVerbose(false) 后 isVerbose 为 false', () => {
    setVerbose(true);
    setVerbose(false);
    assert(isVerbose() === false, '应返回 false');
});

// ============================================================
//  2. setVerbose 联动 configureLogger
// ============================================================

test('setVerbose(true) 同步配置 logger', () => {
    setVerbose(true);
    const cfg = getLoggerConfig();
    assert(cfg.verbose === true, 'logger 的 verbose 应为 true');
});

test('setVerbose(false) 同步配置 logger', () => {
    setVerbose(false);
    const cfg = getLoggerConfig();
    assert(cfg.verbose === false, 'logger 的 verbose 应为 false');
});

// ============================================================
//  3. debug 单参数测试（verbose=true）
// ============================================================

test('debug 单参数 string（verbose=true）', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug('hello world');
    });
    assert(stdout.length > 0, '应有输出');
    assert(stdout.some(line => line.includes('hello world')), '输出应包含消息');
});

test('debug 单参数 Error（verbose=true）', () => {
    setVerbose(true);
    const err = new Error('test error');
    const { stdout } = captureConsole(() => {
        debug(err);
    });
    assert(stdout.length > 0, '应有输出');
    assert(stdout.some(line => line.includes('test error')), '输出应包含错误消息');
});

test('debug 单参数 object（verbose=true）', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug({ key: 'value', count: 42 });
    });
    assert(stdout.length > 0, '应有输出');
    assert(stdout.some(line => line.includes('key')), '输出应包含对象键');
    assert(stdout.some(line => line.includes('value')), '输出应包含对象值');
});

test('debug 单参数 number（verbose=true）', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug(42);
    });
    assert(stdout.length > 0, '应有输出');
});

// ============================================================
//  4. debug 多参数测试
// ============================================================

test('debug 多参数合并输出', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug('模型:', 'deepseek-chat', 'tokens:', 4096);
    });
    assert(stdout.length > 0, '应有输出');
    assert(stdout.some(line => line.includes('deepseek-chat') && line.includes('4096')), '输出应包含所有参数');
});

test('debug 混合类型多参数', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug('配置:', { model: 'deepseek-chat', maxTokens: 4096 });
    });
    assert(stdout.length > 0, '应有输出');
    // 对象应该被序列化为 JSON
    assert(stdout.some(line => line.includes('model') && line.includes('maxTokens')), '输出应包含序列化后的对象');
});

// ============================================================
//  5. debug verbose=false 时不输出
// ============================================================

test('debug verbose=false 时不输出', () => {
    setVerbose(false);
    const { stdout } = captureConsole(() => {
        debug('这条不应出现');
    });
    assert(stdout.length === 0, 'verbose=false 时不该有输出');
});

test('debug 多参数 verbose=false 时不输出', () => {
    setVerbose(false);
    const { stdout } = captureConsole(() => {
        debug('a', 'b', 'c');
    });
    assert(stdout.length === 0, 'verbose=false 时不该有输出');
});

// ============================================================
//  6. 边界测试
// ============================================================

test('debug 空参数不崩溃', () => {
    setVerbose(true);
    // 空调用不应崩溃
    try {
        debug();
        assert(true, '空参数调用成功');
    } catch {
        assert(false, '空参数不应崩溃');
    }
});

test('debug null 参数', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug(null);
    });
    assert(stdout.length > 0, 'null 参数应有输出');
});

test('debug undefined 参数', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug(undefined);
    });
    assert(stdout.length > 0, 'undefined 参数应有输出');
});

test('debug 循环引用对象不崩溃', () => {
    setVerbose(true);
    const obj: any = { name: 'circular' };
    obj.self = obj;
    try {
        const { stdout } = captureConsole(() => {
            debug(obj);
        });
        // logger.debug 会通过 JSON.stringify 尝试序列化，但循环引用会失败
        // 应降级为 String() 或输出原始信息
        assert(stdout.length > 0, '循环引用对象应有输出（降级为字符串）');
    } catch {
        assert(false, '循环引用不应导致崩溃');
    }
});

test('debug 包含特殊字符的消息', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug('路径: /usr/local/bin\n换行测试\t制表符');
    });
    assert(stdout.length > 0, '特殊字符消息不应崩溃');
});

test('debug 空字符串参数', () => {
    setVerbose(true);
    const { stdout } = captureConsole(() => {
        debug('');
    });
    assert(stdout.length > 0, '空字符串参数应有输出');
});

test('debug 非常大的消息', () => {
    setVerbose(true);
    const bigMsg = 'x'.repeat(10000);
    const { stdout } = captureConsole(() => {
        debug(bigMsg);
    });
    assert(stdout.length > 0, '大消息应有输出');
});

// ============================================================
//  7. setVerbose 幂等性测试
// ============================================================

test('setVerbose 多次调用同一值不异常', () => {
    setVerbose(true);
    assert(isVerbose() === true, '第一次应为 true');
    setVerbose(true); // 再次设置 true
    assert(isVerbose() === true, '第二次仍应为 true');
    setVerbose(false);
    setVerbose(false); // 再次设置 false
    assert(isVerbose() === false, '两次 false 后应为 false');
});

// ============================================================
//  测试结果汇总
// ============================================================

console.log('');
console.log(`\x1b[1m测试结果：${passCount}/${testCount} 通过\x1b[0m`);
if (failCount > 0) {
    console.log(`\x1b[31m${failCount} 个失败\x1b[0m`);
    process.exit(1);
} else {
    console.log('\x1b[32m全部通过 ✅\x1b[0m');
}
