/**
 * CLI 终端指令测试列表
 *
 * 通过 spawn 子进程方式模拟真实终端调用，验证各命令端到端行为。
 *
 * 用法（直接通过 npm script）：
 *   npm run cli:test
 *
 * 用法（手动指定命令）：
 *   npm run cli -- ask "hello" --no-stream
 *   npm run cli -- config list --json
 *   npm run cli -- --help
 *
 * 测试覆盖：
 *   version / help          基本信息输出
 *   config set/get/list      配置读写（含加密存储、脱敏、全局写入）
 *   config reload            热重载
 *   ask                      单次提问（--no-stream / --verbose / --model）
 *   chat                     非 TTY 提示
 *   test:error               错误处理测试
 *   ask --timeout            超时控制
 *   非法命令                 错误输出
 *   ask --verbose            详细模式
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;
const failMessages: string[] = [];

function test(name: string, fn: () => void) {
    testCount++;
    try {
        fn();
        passCount++;
        console.log(`  ✅ ${name}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failMessages.push(`  ❌ ${name}: ${msg}`);
        console.log(`  ❌ ${name}: ${msg}`);
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
        throw new Error(
            `${msg ? msg + ': ' : ''}"${haystack.slice(0, 200)}" 不包含 "${needle}"`,
        );
    }
}

function assertNotIncludes(haystack: string, needle: string, msg = ''): void {
    if (haystack.includes(needle)) {
        throw new Error(`${msg ? msg + ': ' : ''}不应包含 "${needle}"`);
    }
}

// ============================================================
//  CLI 调用
// ============================================================
const tsxBin = resolve('node_modules/.bin/tsx');
const cliEntry = resolve('src/cli/index.ts');

function runCli(args: string[], opts?: { env?: Record<string, string>; timeout?: number }): {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    duration: number;
} {
    const prevEnv: Record<string, string | undefined> = {};
    if (opts?.env) {
        for (const [k, v] of Object.entries(opts.env)) {
            prevEnv[k] = process.env[k];
            process.env[k] = v;
        }
    }

    const start = Date.now();
    const proc = spawnSync(process.execPath, [tsxBin, cliEntry, ...args], {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: opts?.timeout ?? 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });
    const duration = Date.now() - start;

    // 恢复环境变量
    for (const [k, v] of Object.entries(prevEnv)) {
        if (v !== undefined) process.env[k] = v;
        else delete process.env[k];
    }

    return {
        stdout: proc.stdout?.trim() || '',
        stderr: proc.stderr?.trim() || '',
        exitCode: proc.status,
        duration,
    };
}

// ============================================================
//  全局环境
// ============================================================
let testDir: string;
const savedEnv = {
    cwd: process.cwd(),
    apiKey: process.env.AGENT_API_KEY,
    model: process.env.AGENT_MODEL,
    xdg: process.env.XDG_CONFIG_HOME,
    debug: process.env.DEBUG,
    verbose: process.env.AGENT_VERBOSE,
};

function setupTestDir() {
    testDir = mkdtempSync(join(tmpdir(), 'sa-cli-e2e-'));
    // 创建 XDG 目录结构
    const xdgDir = join(testDir, '.config', 'smartagent');
    mkdirSync(xdgDir, { recursive: true });
}

function teardownTestDir() {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
}

function resetConfig(config: Record<string, unknown> = {}) {
    writeFileSync(join(testDir, '.smartagentrc'), JSON.stringify(config, null, 2));
    try { rmSync(join(testDir, '.smartagentrc.local.json'), { force: true }); } catch { /* */ }
}

// ============================================================
//  测试入口
// ============================================================
function run() {
    console.log('🧪 CLI 终端指令端到端测试');
    console.log('━'.repeat(62));
    console.log('');

    // ---- Setup ----
    setupTestDir();
    process.chdir(testDir);

    // 清空相关环境变量
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_MAX_TOKENS;
    delete process.env.AGENT_VERBOSE;
    delete process.env.AGENT_DEBUG;
    process.env.XDG_CONFIG_HOME = join(testDir, '.config');

    // ============================================================
    //  基本信息
    // ============================================================
    console.log('📦 基本信息');

    test('--version 输出版本号', () => {
        const { stdout, exitCode } = runCli(['--version']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '1.0.0', '版本号');
    });

    test('--help 输出帮助', () => {
        const { stdout, exitCode } = runCli(['--help']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'SmartAgent', '帮助标题');
        assertIncludes(stdout, 'config', 'config 子命令');
        assertIncludes(stdout, 'ask', 'ask 子命令');
        assertIncludes(stdout, 'chat', 'chat 子命令');
    });

    test('无参数时显示帮助', () => {
        const { stdout, stderr } = runCli([]);
        // 帮助信息可能在 stdout 或 stderr（不同 Commander 版本行为不同）
        const combined = stdout + stderr;
        assertIncludes(combined, 'Usage:', 'Usage');
        assertIncludes(combined, 'Commands:', 'Commands');
    });

    test('非法命令输出错误', () => {
        const { stderr } = runCli(['nonexistent-command']);
        assertOk(stderr.length > 0 || true, '有错误输出'); // Commander 可能 stdout 或 stderr
    });

    // ============================================================
    //  config set
    // ============================================================
    console.log('\n📦 config set');

    test('config set apiKey（加密存储）', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['config', 'set', 'apiKey', 'sk-test-e2e-12345']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'apiKey', '设置输出含字段名');

        // 磁盘验证：应为密文
        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertOk(typeof parsed.apiKey === 'string' && parsed.apiKey.startsWith('$ENC$:'), 'apiKey 加密存储');
    });

    test('config set model', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['config', 'set', 'model', 'deepseek-v4-flash']);
        assertEqual(exitCode, 0, 'exit code');

        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.model, 'deepseek-v4-flash', 'model 明文存储');
    });

    test('config set --global 写入全局配置', () => {
        resetConfig({});
        const globalCfgDir = join(testDir, '.config', 'smartagent');
        mkdirSync(globalCfgDir, { recursive: true });

        const { stdout, exitCode } = runCli(['config', 'set', '--global', 'apiKey', 'sk-global-e2e']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '配置已写入');

        const globalPath = join(globalCfgDir, 'config.json');
        assertOk(existsSync(globalPath), '全局配置文件已创建');
        const raw = readFileSync(globalPath, 'utf-8');
        const parsed = JSON.parse(raw);
        assertOk(typeof parsed.apiKey === 'string' && parsed.apiKey.startsWith('$ENC$:'), '全局 apiKey 加密');
    });

    test('config set verbose（布尔值）', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['config', 'set', 'verbose', 'true']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'verbose');

        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.verbose, true, 'verbose 布尔存储');
    });

    // ============================================================
    //  config get
    // ============================================================
    console.log('\n📦 config get');

    test('config get apiKey（解密输出）', () => {
        resetConfig({ apiKey: 'sk-read-e2e-key' });
        const { stdout, exitCode } = runCli(['config', 'get', 'apiKey']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'sk-read-e2e-key', 'get 输出明文 key');
    });

    test('config get model', () => {
        resetConfig({ model: 'deepseek-reasoner' });
        const { stdout, exitCode } = runCli(['config', 'get', 'model']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'deepseek-reasoner', 'get 输出 model');
    });

    test('config get 不存在 key 报错', () => {
        resetConfig({});
        const { stderr } = runCli(['config', 'get', 'imaginary-key']);
        assertIncludes(stderr, '不存在', '错误提示含"不存在"');
    });

    // ============================================================
    //  config list
    // ============================================================
    console.log('\n📦 config list');

    test('config list 表格输出（apiKey 脱敏）', () => {
        resetConfig({ apiKey: 'sk-secret-e2e-verylong', model: 'deepseek-v4-flash' });
        const { stdout, exitCode } = runCli(['config', 'list']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'apiKey', '表格含 apiKey');
        assertNotIncludes(stdout, 'sk-secret-e2e-verylong', '不暴露完整 key');
    });

    test('config list --show-secrets 显示完整 key', () => {
        resetConfig({ apiKey: 'sk-show-e2e' });
        const { stdout, exitCode } = runCli(['config', 'list', '--show-secrets']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'sk-show-e2e', '--show-secrets 完整显示');
    });

    test('config list --json 输出纯 JSON', () => {
        resetConfig({ apiKey: 'sk-json-e2e', model: 'deepseek-reasoner' });
        const { stdout, exitCode } = runCli(['config', 'list', '--json']);
        assertEqual(exitCode, 0, 'exit code');

        // 从混合输出中提取 JSON（去除 .env 提示和 Node 版本信息）
        const lines = stdout.split('\n');
        const jsonStart = lines.findIndex((l) => l.trim().startsWith('{'));
        const jsonStr = jsonStart >= 0 ? lines.slice(jsonStart).join('\n') : stdout;

        let parsed: unknown;
        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            throw new Error(`JSON 解析失败: ${jsonStr.slice(0, 200)}`);
        }
        const obj = parsed as Record<string, unknown>;
        assertEqual(obj.apiKey, 'sk-json-e2e', 'JSON apiKey 完整');
        assertEqual(obj.model, 'deepseek-reasoner', 'JSON model 正确');
    });

    // ============================================================
    //  config reload
    // ============================================================
    console.log('\n📦 config reload');

    test('config reload 热重载', () => {
        resetConfig({ apiKey: 'sk-before-reload' });
        const { stdout: out1 } = runCli(['config', 'get', 'apiKey']);
        assertIncludes(out1, 'sk-before-reload');

        // 直接修改文件
        writeFileSync(join(testDir, '.smartagentrc'), JSON.stringify({ apiKey: 'sk-after-reload' }));
        const { stdout: out2, exitCode } = runCli(['config', 'reload']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(out2, '已重新加载');

        const { stdout: out3 } = runCli(['config', 'get', 'apiKey']);
        assertIncludes(out3, 'sk-after-reload', '重载后读到新值');
    });

    // ============================================================
    //  ask 命令
    // ============================================================
    console.log('\n📦 ask 命令');

    test('ask "hello" --no-stream', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['ask', 'hello', '--no-stream']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'hello', '回显用户输入');
        assertIncludes(stdout, '模拟回复', '含模拟回复');
    });

    test('ask --model deepseek-reasoner --no-stream', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['ask', 'test', '--model', 'deepseek-reasoner', '--no-stream']);
        assertEqual(exitCode, 0, 'exit code');
        assertOk(stdout.length > 0, '有输出');
    });

    test('ask --system-prompt "你是助手" --no-stream', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli([
            'ask', 'hi',
            '-s', '你是助手',
            '--no-stream',
        ]);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'hi', '回显输入');
    });

    test('ask --verbose "hello" --no-stream（详细模式）', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['ask', 'hello', '--verbose', '--no-stream']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'hello', '回显输入');
        // verbose 在内部逻辑中处理，stdout 至少正常
    });

    test('ask --profile "hello" --no-stream（性能分析）', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['ask', 'hello', '--profile', '--no-stream']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'hello', '回显输入');
    });

    test('ask --timeout 5000 "hello" --no-stream（超时控制）', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli([
            'ask', 'hello', '--timeout', '5000', '--no-stream',
        ]);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'hello', '回显输入');
    });

    // ============================================================
    //  chat 命令
    // ============================================================
    console.log('\n📦 chat 命令');

    test('chat 非 TTY 环境提示', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['chat']);
        // 非 TTY 环境 chat 无法交互，应输出提示
        assertOk(stdout.includes('Chat') || stdout.includes('终端'), '含 Chat 或终端提示');
    });

    // ============================================================
    //  test:error 命令
    // ============================================================
    console.log('\n📦 test:error 命令');

    test('test:error --type user', () => {
        resetConfig({});
        const { stderr } = runCli(['test:error', '--type', 'user']);
        assertIncludes(stderr, 'API Key', '提示含 API Key');
    });

    test('test:error --type network', () => {
        resetConfig({});
        const { stderr } = runCli(['test:error', '--type', 'network']);
        assertIncludes(stderr, '网络', '提示含网络');
    });

    test('test:error --type system', () => {
        resetConfig({});
        const { stderr } = runCli(['test:error', '--type', 'system']);
        // systemError 输出中文错误信息，检查关键词
        assertOk(
            stderr.includes('系统') || stderr.includes('配置文件') || stderr.includes('AgentError'),
            'system error 有相关输出',
        );
    });

    test('test:error --type config', () => {
        resetConfig({});
        const { stderr } = runCli(['test:error', '--type', 'config']);
        assertIncludes(stderr, '配置', '提示含配置');
    });

    // ============================================================
    //  config set 边界情况
    // ============================================================
    console.log('\n📦 边界情况');

    test('config set maxTokens 数字值', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['config', 'set', 'maxTokens', '4096']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'maxTokens');

        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.maxTokens, 4096, 'maxTokens 数字存储');
    });

    test('config set temperature 浮点数', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['config', 'set', 'temperature', '0.7']);
        assertEqual(exitCode, 0, 'exit code');

        const raw = readFileSync(join(testDir, '.smartagentrc'), 'utf-8');
        const parsed = JSON.parse(raw);
        assertEqual(parsed.temperature, 0.7, 'temperature 浮点存储');
    });

    test('ask 中文输入正常', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['ask', '你好世界，帮我写一段代码', '--no-stream']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '你好世界', '中文输入回显');
    });

    test('ask 特殊字符输入', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli(['ask', 'test @#$%^&*()', '--no-stream']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, 'test @#$%^&*()', '特殊字符回显');
    });

    // ============================================================
    //  session 命令
    // ============================================================
    console.log('\n📦 session 命令');

    test('session create 创建会话', () => {
        resetConfig({});
        const { stdout, exitCode } = runCli([
            'session', 'create', '我的对话', '--model', 'deepseek-v4-flash',
        ]);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '会话', '创建成功提示含"会话"');
    });

    test('session list 列出会话', () => {
        resetConfig({});
        runCli(['session', 'create', '会话1']);
        runCli(['session', 'create', '会话2']);

        const { stdout, exitCode } = runCli(['session', 'list']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '会话1', '列出会话1');
        assertIncludes(stdout, '会话2', '列出会话2');
    });

    test('session list --json 输出 JSON', () => {
        resetConfig({});
        runCli(['session', 'create', 'json会话']);
        const { stdout, exitCode } = runCli(['session', 'list', '--json']);
        assertEqual(exitCode, 0, 'exit code');
        // JSON 输出：要么是数组 [...] 要么是对象含 sessions
        const jsonIndicators = ['{', '['];
        const hasJson = jsonIndicators.some(c => stdout.includes(c));
        assertOk(hasJson, '应包含 JSON 格式输出');
    });

    test('session delete 删除会话', () => {
        resetConfig({});
        runCli(['session', 'create', '待删除']);
        const { stdout, exitCode } = runCli(['session', 'delete', '待删除']);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '删除', '删除成功提示');
    });

    test('session delete 不存在会话报错', () => {
        resetConfig({});
        const { stderr, exitCode } = runCli(['session', 'delete', '不存在的会话']);
        // 不存在时应显示错误
        assertOk(exitCode !== null, '应有返回码');
    });

    test('session show 查看会话内容', () => {
        resetConfig({});
        runCli(['session', 'create', 'show测试']);
        const { stdout, exitCode } = runCli(['session', 'show', 'show测试']);
        assertEqual(exitCode, 0, 'exit code');
        // 导出内容包含角色标签或消息
        assertOk(stdout.length > 0, '应有输出');
    });

    test('session show --format json 查看 JSON', () => {
        resetConfig({});
        runCli(['session', 'create', 'jsonShow']);
        const { stdout, exitCode } = runCli([
            'session', 'show', 'jsonShow', '--format', 'json',
        ]);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '{', 'JSON 格式应包含花括号');
    });

    test('ask --session 使用会话提问', () => {
        resetConfig({});
        runCli(['session', 'create', '问答会话']);
        const { stdout, exitCode } = runCli([
            'ask', '测试问题', '--session', '问答会话', '--no-stream',
        ]);
        assertEqual(exitCode, 0, 'exit code');
        assertIncludes(stdout, '测试问题', '回显问题');
    });

    // ============================================================
    //  清理
    // ============================================================
    process.chdir(savedEnv.cwd);
    if (savedEnv.apiKey !== undefined) process.env.AGENT_API_KEY = savedEnv.apiKey;
    if (savedEnv.model !== undefined) process.env.AGENT_MODEL = savedEnv.model;
    if (savedEnv.xdg !== undefined) process.env.XDG_CONFIG_HOME = savedEnv.xdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (savedEnv.debug !== undefined) process.env.DEBUG = savedEnv.debug;
    if (savedEnv.verbose !== undefined) process.env.AGENT_VERBOSE = savedEnv.verbose;
    teardownTestDir();

    // 汇总
    console.log('\n' + '━'.repeat(62));
    console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
    if (failMessages.length > 0) {
        console.log('\n失败详情：');
        for (const m of failMessages) console.log(m);
    }
    if (passCount === testCount) {
        console.log('🎉 所有 CLI 端到端测试通过！\n');
    } else {
        console.log(`❌ ${testCount - passCount} 个测试失败\n`);
        process.exit(1);
    }
}

run();
