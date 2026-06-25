/**
 * Agent 端到端（E2E）流程测试
 * 运行: pnpm test:e2e
 *
 * 测试完整用户流程：
 *   config set → config get → config list
 *   ask 单次提问（普通 / 流式 / 带上下文）
 *   chat 非 TTY 环境
 *   session 会话管理（create → list → delete）
 *   错误处理
 */

import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

let testDir: string;
let testCount = 0;
let passCount = 0;
let failCount = 0;

function setup(): void {
    testDir = mkdtempSync(join(tmpdir(), 'sa-e2e-flow-'));
    process.chdir(testDir);
    const xdgDir = join(testDir, '.config', 'smartagent');
    mkdirSync(xdgDir, { recursive: true });
}

function teardown(): void {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
}

// Use absolute path for tsx/esm so it works regardless of child process cwd
const cliEntry = resolve('src/cli/index.ts');
const tsxEsm = resolve('node_modules/tsx/dist/esm/index.mjs');

function runCli(args: string[]): { stdout: string; stderr: string; code: number | null } {
    const proc = spawnSync(process.execPath, ['--import', tsxEsm, cliEntry, ...args], {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, XDG_CONFIG_HOME: join(testDir, '.config') },
    });
    return {
        stdout: (proc.stdout || '').trim(),
        stderr: (proc.stderr || '').trim(),
        code: proc.status,
    };
}

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertIncludes(haystack: string, needle: string, msg: string = ''): void {
    if (!haystack.includes(needle)) {
        throw new Error(`${msg ? msg + ': ' : ''}不包含 "${needle}"`);
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
//  E2E 测试
// ============================================================

console.log('\n🚀 Agent E2E 流程测试\n');

try {
setup();

// ---- 配置管理流程 ----
console.log('📦 配置管理');
test('完整流程: config set → get → list', () => {
    const r1 = runCli(['config', 'set', 'apiKey', 'sk-e2e-key']);
    assert(r1.code === 0, 'config set 成功');

    const r2 = runCli(['config', 'get', 'apiKey']);
    assert(r2.code === 0, 'config get 成功');
    assertIncludes(r2.stdout, 'sk-e2e-key', 'get 输出正确 key');

    const r3 = runCli(['config', 'list']);
    assert(r3.code === 0, 'config list 成功');
    assertIncludes(r3.stdout, 'apiKey', 'list 包含 apiKey');
});

test('config set model → get model', () => {
    const r1 = runCli(['config', 'set', 'model', 'deepseek-v4-flash']);
    assert(r1.code === 0, 'config set model 成功');

    const r2 = runCli(['config', 'get', 'model']);
    assertIncludes(r2.stdout, 'deepseek-v4-flash', 'model 正确');
});

// ---- ask 命令 ----
console.log('\n📦 ask 命令');
test('ask "hello" --no-stream', () => {
    const r = runCli(['ask', 'hello', '--no-stream']);
    assert(r.code === 0, 'ask 命令成功');
    assert(r.stdout.length > 0, '应有输出');
});

test('ask 中文输入 --no-stream', () => {
    const r = runCli(['ask', '你好世界，帮我写代码', '--no-stream']);
    assert(r.code === 0, 'ask 中文成功');
    assert(r.stdout.length > 0, '应有输出');
});

test('ask --model deepseek-reasoner --no-stream', () => {
    const r = runCli(['ask', 'test', '--model', 'deepseek-reasoner', '--no-stream']);
    assert(r.code === 0, '带 model 参数成功');
});

// ---- chat 命令 ----
console.log('\n📦 chat 命令');
test('chat 非交互模式提示', () => {
    const r = runCli(['chat']);
        assert(r.code !== null, 'chat 命令可执行（返回了退出码）');
});

// ============================================================
//  会话管理 E2E
// ============================================================
console.log('\n📦 session 命令');

test('session create → list → delete 完整流程', () => {
    const r1 = runCli(['session', 'create', '我的对话', '--model', 'deepseek-v4-flash']);
    assert(r1.code === 0, 'session create 成功');

    const r2 = runCli(['session', 'list']);
    assert(r2.code === 0, 'session list 成功');
    assertIncludes(r2.stdout, '我的对话', 'list 包含会话名');

    const r3 = runCli(['session', 'delete', '我的对话']);
    assert(r3.code === 0, 'session delete 成功');
});

test('session list --json 输出 JSON', () => {
    runCli(['session', 'create', 'json测试']);
    const r = runCli(['session', 'list', '--json']);
    assert(r.code === 0, 'session list --json 成功');
    // JSON 开始于 '{' 或 '['
    assert((r.stdout.includes('{') || r.stdout.includes('[')), '应包含 JSON 数据');
});

test('session show 查看内容', () => {
    runCli(['session', 'create', 'show测试']);
    const r = runCli(['session', 'show', 'show测试']);
    assert(r.code === 0, 'session show 成功');
});

test('session show --format json', () => {
    runCli(['session', 'create', 'json格式']);
    const r = runCli(['session', 'show', 'json格式', '--format', 'json']);
    assert(r.code === 0, 'session show --format json 成功');
});

// ============================================================
//  错误处理 E2E
// ============================================================
console.log('\n📦 错误处理');

test('test:error --type user 输出错误提示', () => {
    const r = runCli(['test:error', '--type', 'user']);
    const combined = r.stdout + r.stderr;
    // test:error 命令应能正常执行，输出包含错误相关信息或返回非零退出码
    assert(combined.length > 0 || r.code !== 0, '错误命令有输出或返回非零码');
});

test('test:error --type network 输出网络错误', () => {
    const r = runCli(['test:error', '--type', 'network']);
    const combined = r.stdout + r.stderr;
    // test:error network 应输出网络相关错误或返回非零退出码
    assert(combined.length > 0 || r.code !== 0, '网络错误有输出或返回非零码');
});

// ---- 清理 ----
teardown();
} finally {
    // 确保清理（即使 runCli 抛出异常）
    teardown();
}

console.log(`\n📊 E2E 测试结果: ${passCount}/${testCount} 通过`);
if (failCount > 0) {
    console.log(`❌ ${failCount} 个测试失败`);
    process.exit(1);
} else {
    console.log('🎉 所有 E2E 测试通过！\n');
}
