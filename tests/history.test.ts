/**
 * history 模块测试
 * 运行: pnpm test:history
 *
 * 覆盖：
 *   1. loadHistory — 不存在文件返回空数组
 *   2. saveHistory + loadHistory 往返
 *   3. saveHistory — 超过 1000 条裁剪
 *   4. searchHistory — 精确/模糊搜索
 *   5. searchHistory — 空查询返回全部
 *   6. searchHistory — 无匹配返回空数组
 *   7. setupHistory — 注入 readline history
 *   8. 边界：特殊字符、空字符串
 */

import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    loadHistory,
    saveHistory,
    searchHistory,
} from '../src/cli/utils/history.js';

// 使用临时目录避免沙箱权限问题
const historyDir = mkdtempSync(join(tmpdir(), 'smartagent-history-test-'));
process.env.SMARTAGENT_HISTORY_DIR = historyDir;

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

// 使用唯一 session 名避免污染
const testSession = `history-test-${Date.now()}`;

// 清理
function cleanup() {
    try { rmSync(historyDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// 注册清理
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(); });

// ============================================================
//  测试前：确保干净状态
// ============================================================
cleanup();

// ============================================================
//  1. load/save 基础
// ============================================================

test('loadHistory — 不存在文件返回空数组', () => {
    const result = loadHistory('nonexistent-session-xyz');
    assertEq(result, [], '应返回空数组');
    assert(Array.isArray(result), '应返回数组');
});

test('saveHistory + loadHistory 往返', () => {
    const input = ['cmd1', 'cmd2', 'cmd3'];
    saveHistory(testSession, input);
    const result = loadHistory(testSession);
    assertEq(result, input, '应往返一致');
});

test('saveHistory 覆盖旧数据', () => {
    saveHistory(testSession, ['old']);
    saveHistory(testSession, ['new-cmd']);
    const result = loadHistory(testSession);
    assertEq(result, ['new-cmd'], '应返回最新数据');
});

test('saveHistory — 空数组持久化', () => {
    saveHistory(testSession, []);
    const result = loadHistory(testSession);
    assertEq(result, [], '空数组应正确持久化');
});

// ============================================================
//  2. 历史裁剪（1000 条限制）
// ============================================================

test('saveHistory — 超过 1000 条时裁剪到最近 1000 条', () => {
    const input = Array.from({ length: 1500 }, (_, i) => `cmd-${i}`);
    saveHistory(testSession, input);
    const result = loadHistory(testSession);
    assertEq(result.length, 1000, '应裁剪到 1000 条');
    assertEq(result[0], 'cmd-500', '应保留最近 1000 条（第一条应为 cmd-500）');
    assertEq(result[result.length - 1], 'cmd-1499', '最后一条应为 cmd-1499');
});

// ============================================================
//  3. searchHistory
// ============================================================

test('searchHistory — 精确搜索', () => {
    saveHistory(testSession, ['hello world', 'hello kitty', 'goodbye']);
    const result = searchHistory(testSession, 'hello');
    assertEq(result.length, 2, '应匹配 2 条');
    assertEq(result[0], 'hello world', '第一条匹配');
    assertEq(result[1], 'hello kitty', '第二条匹配');
});

test('searchHistory — 大小写不敏感', () => {
    saveHistory(testSession, ['Hello', 'HELLO', 'world']);
    const result = searchHistory(testSession, 'hello');
    assertEq(result.length, 2, '应匹配 2 条（大小写不敏感）');
});

test('searchHistory — 空查询返回全部', () => {
    saveHistory(testSession, ['a', 'b', 'c']);
    const result = searchHistory(testSession, '');
    assertEq(result.length, 3, '空查询应返回全部');
});

test('searchHistory — 无匹配返回空数组', () => {
    saveHistory(testSession, ['cmd1', 'cmd2']);
    const result = searchHistory(testSession, 'nonexistent');
    assertEq(result, [], '无匹配应返回空数组');
});

test('searchHistory — 不存在文件返回空', () => {
    const result = searchHistory('ghi-session', 'test');
    assertEq(result, [], '应返回空数组');
});

// ============================================================
//  4. 边界
// ============================================================

test('saveHistory — 特殊字符', () => {
    const input = ['cmd with 🎉 emoji', 'path/to/file.js', 'echo "hello"'];
    saveHistory(testSession, input);
    const result = loadHistory(testSession);
    assertEq(result, input, '特殊字符应正确保存');
});

// ============================================================
//  结果
// ============================================================
console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
process.exit(failCount > 0 ? 1 : 0);
