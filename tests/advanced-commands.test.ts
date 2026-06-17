/**
 * advanced-commands 测试
 * 
 * 覆盖：config set/get/list/reload、ask（模拟响应）、chat（启动消息）
 * 
 * 策略：单个临时目录 + ConfigManager.reload() 重置状态，避免单例污染
 */
import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;

async function testAsync(name: string, fn: () => Promise<void>) {
    testCount++;
    console.log(`\n📝 测试 ${testCount}: ${name}`);
    try {
        await fn();
        passCount++;
        console.log('  ✅ 通过');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ❌ 失败: ${msg}`);
    }
}

function assertEqual<T>(actual: T, expected: T, msg = ''): void {
    if (actual !== expected) {
        throw new Error(`${msg ? msg + ': ' : ''}期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
}

function assertOk(value: unknown, msg = ''): void {
    if (!value) throw new Error(msg || '期望 truthy 值');
}

function assertIncludes(haystack: string, needle: string, msg = ''): void {
    if (!haystack.includes(needle)) {
        throw new Error(`${msg ? msg + ': ' : ''}"${haystack.slice(0, 300)}" 不包含 "${needle}"`);
    }
}

function assertNotIncludes(haystack: string, needle: string, msg = ''): void {
    if (haystack.includes(needle)) {
        throw new Error(`${msg ? msg + ': ' : ''}不应包含 "${needle}"`);
    }
}

// ============================================================
//  全局环境
// ============================================================
let testDir: string;
const savedEnv = {
    cwd: process.cwd(),
    apiKey: process.env.AGENT_API_KEY,
    xdg: process.env.XDG_CONFIG_HOME,
    debug: process.env.DEBUG,
};

// ============================================================
//  工具：创建 Commander 程序并注册命令
// ============================================================
async function createProgram() {
    const { registerAdvancedCommands } = await import('../src/cli/advanced-commands.js');
    const program = new Command();
    program.name('agent').exitOverride();
    registerAdvancedCommands(program);
    return program;
}

async function runCommand(args: string[], extraEnv?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';

    const origLog = console.log;
    const origError = console.error;
    console.log = (...a: unknown[]) => { stdout += a.join(' ') + '\n'; };
    console.error = (...a: unknown[]) => { stderr += a.join(' ') + '\n'; };

    // 设置额外环境变量
    const prevEnv: Record<string, string | undefined> = {};
    if (extraEnv) {
        for (const [k, v] of Object.entries(extraEnv)) {
            prevEnv[k] = process.env[k];
            process.env[k] = v;
        }
    }

    try {
        const program = await createProgram();
        await program.parseAsync(['node', 'agent', ...args]);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('commander')) stderr += msg + '\n';
    } finally {
        console.log = origLog;
        console.error = origError;
        if (extraEnv) {
            for (const [k, v] of Object.entries(prevEnv)) {
                if (v !== undefined) process.env[k] = v;
                else delete process.env[k];
            }
        }
    }

    return { stdout, stderr };
}

/** 重置配置到指定状态 */
async function resetConfig(config: Record<string, unknown> = {}) {
    // 写入临时配置文件
    writeFileSync(join(testDir, '.smartagentrc'), JSON.stringify(config));
    // 确保没有本地覆盖文件
    try { rmSync(join(testDir, '.smartagentrc.local.json'), { force: true }); } catch { /* */ }
    // 重载
    const { configManager } = await import('../src/cli/config-manager.js');
    configManager.reload();
}

// ============================================================
//  测试入口
// ============================================================
async function run() {
    console.log('🧪 advanced-commands 模块测试');
    console.log('━'.repeat(62));

    // 全局 setup
    testDir = mkdtempSync(join(tmpdir(), 'sa-cmd-test-'));
    process.chdir(testDir);
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_MAX_TOKENS;
    delete process.env.AGENT_VERBOSE;
    delete process.env.AGENT_DEBUG;
    // 设置 XDG_CONFIG_HOME 到临时目录（必须在首次 import config-manager 之前）
    process.env.XDG_CONFIG_HOME = join(testDir, '.config');

    // ============================================================
    //  config set
    // ============================================================
    await testAsync('config set apiKey', async () => {
        await resetConfig({});
        const { stdout } = await runCommand(['config', 'set', 'apiKey', 'sk-test-123']);
        assertIncludes(stdout, 'apiKey');
        assertIncludes(stdout, 'sk-test-123');

        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.apiKey, 'sk-test-123');
    });

    await testAsync('config set model', async () => {
        await resetConfig({});
        await runCommand(['config', 'set', 'model', 'deepseek-reasoner']);

        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.model, 'deepseek-reasoner');
    });

    await testAsync('config set --global 写入全局配置', async () => {
        await resetConfig({});
        const globalDir = join(testDir, '.config', 'smartagent');
        // 确保目录存在（XDG_CONFIG_HOME 下的 smartagent 目录）
        mkdirSync(globalDir, { recursive: true });

        const { stdout } = await runCommand(['config', 'set', '--global', 'apiKey', 'sk-global-cmd']);

        // 验证 saveToFile 输出了正确的路径
        assertIncludes(stdout, '配置已写入');

        const globalPath = join(globalDir, 'config.json');
        assertOk(existsSync(globalPath), '全局配置文件已创建');
        const raw = readFileSync(globalPath, 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.apiKey, 'sk-global-cmd');
    });

    // ============================================================
    //  config get
    // ============================================================
    await testAsync('config get apiKey', async () => {
        await resetConfig({ apiKey: 'sk-read-test' });
        const { stdout } = await runCommand(['config', 'get', 'apiKey']);
        assertIncludes(stdout, 'sk-read-test');
    });

    await testAsync('config get 不存在的 key 抛出错误', async () => {
        await resetConfig({});
        const { stderr } = await runCommand(['config', 'get', 'nonexistent']);
        assertIncludes(stderr, '不存在');
    });

    // ============================================================
    //  config list
    // ============================================================
    await testAsync('config list 表格输出（脱敏 apiKey）', async () => {
        await resetConfig({ apiKey: 'sk-very-long-secret-key-here' });
        const { stdout } = await runCommand(['config', 'list']);
        assertNotIncludes(stdout, 'sk-very-long-secret-key-here', '脱敏后不暴露完整 key');
        assertIncludes(stdout, 'apiKey', '含 apiKey 字段');
    });

    await testAsync('config list --show-secrets 显示完整 key', async () => {
        await resetConfig({ apiKey: 'sk-full-key' });
        const { stdout } = await runCommand(['config', 'list', '--show-secrets']);
        assertIncludes(stdout, 'sk-full-key', '--show-secrets 显示完整 key');
    });

    await testAsync('config list --json 输出纯 JSON', async () => {
        await resetConfig({ apiKey: 'sk-json-test' });
        const { stdout } = await runCommand(['config', 'list', '--json']);

        const trimmed = stdout.trim();
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            throw new Error(`JSON 解析失败: ${trimmed.slice(0, 100)}`);
        }
        const obj = parsed as Record<string, unknown>;
        assertEqual(obj.apiKey, 'sk-json-test', 'JSON 中 apiKey 完整');
    });

    // ============================================================
    //  config reload
    // ============================================================
    await testAsync('config reload', async () => {
        await resetConfig({});
        const { stdout } = await runCommand(['config', 'reload']);
        assertIncludes(stdout, '已重新加载');
    });

    // ============================================================
    //  ask 命令
    // ============================================================
    await testAsync('ask "你好" --no-stream', async () => {
        await resetConfig({});
        const { stdout } = await runCommand(['ask', '你好', '--no-stream']);
        assertIncludes(stdout, '你好');
        assertIncludes(stdout, '模拟回复');
    });

    await testAsync('ask --system-prompt "你是助手" --no-stream', async () => {
        await resetConfig({});
        const { stdout } = await runCommand([
            'ask', 'hello',
            '-s', '你是助手',
            '--no-stream',
        ]);
        assertIncludes(stdout, 'hello');
    });

    // ============================================================
    //  chat 命令
    // ============================================================
    await testAsync('chat 非 TTY 环境提示', async () => {
        await resetConfig({});
        // 模拟非 TTY 环境（测试环境下 chat 不能真正交互）
        const origIsTTY = process.stdin.isTTY;
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
        try {
            const { stdout } = await runCommand(['chat']);
            assertIncludes(stdout, 'Chat 模式');
            assertIncludes(stdout, '交互式终端');
        } finally {
            Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
        }
    });

    // ============================================================
    //  test:error 命令
    // ============================================================
    await testAsync('test:error --type user', async () => {
        await resetConfig({});
        const { stderr } = await runCommand(['test:error', '--type', 'user']);
        assertIncludes(stderr, 'API Key');
    });

    // ============================================================
    //  清理
    // ============================================================
    process.chdir(savedEnv.cwd);
    if (savedEnv.apiKey !== undefined) process.env.AGENT_API_KEY = savedEnv.apiKey;
    if (savedEnv.xdg !== undefined) process.env.XDG_CONFIG_HOME = savedEnv.xdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (savedEnv.debug !== undefined) process.env.DEBUG = savedEnv.debug;
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }

    // 汇总
    console.log('\n' + '━'.repeat(62));
    console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
    if (passCount === testCount) {
        console.log('🎉 所有测试通过！\n');
    } else {
        console.log(`❌ ${testCount - passCount} 个测试失败\n`);
        process.exit(1);
    }
}

run();
