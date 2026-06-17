/**
 * ConfigManager 测试
 *
 * 覆盖：构造函数、loadConfig、get、getValue、set、setGlobal、reload、reset、print
 *
 * 注意：
 *   - set/setGlobal 会写入真实文件系统，测试使用临时目录
 *   - 环境变量测试通过 mock process.env 完成
 *   - 使用动态 import() 兼容 ESM 项目
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;

function testSync(name: string, fn: () => void) {
    testCount++;
    console.log(`\n📝 测试 ${testCount}: ${name}`);
    try {
        fn();
        passCount++;
        console.log('  ✅ 通过');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ❌ 失败: ${msg}`);
    }
}

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

function assertMatch(value: string, regex: RegExp, msg = ''): void {
    if (!regex.test(value)) {
        throw new Error(`${msg ? msg + ': ' : ''}"${value}" 不匹配 ${regex}`);
    }
}

type ConfigManagerType = InstanceType<typeof import('../src/cli/config-manager.js').ConfigManager>;

// ============================================================
//  环境管理
// ============================================================
function saveEnv() {
    return {
        cwd: process.cwd(),
        apiKey: process.env.AGENT_API_KEY,
        model: process.env.AGENT_MODEL,
        maxTokens: process.env.AGENT_MAX_TOKENS,
        verbose: process.env.AGENT_VERBOSE,
        baseUrl: process.env.AGENT_BASE_URL,
        timeout: process.env.AGENT_TIMEOUT,
        xdg: process.env.XDG_CONFIG_HOME,
        debug: process.env.DEBUG,
    };
}

function restoreEnv(saved: ReturnType<typeof saveEnv>) {
    process.chdir(saved.cwd);
    if (saved.apiKey !== undefined) process.env.AGENT_API_KEY = saved.apiKey; else delete process.env.AGENT_API_KEY;
    if (saved.model !== undefined) process.env.AGENT_MODEL = saved.model; else delete process.env.AGENT_MODEL;
    if (saved.maxTokens !== undefined) process.env.AGENT_MAX_TOKENS = saved.maxTokens; else delete process.env.AGENT_MAX_TOKENS;
    if (saved.verbose !== undefined) process.env.AGENT_VERBOSE = saved.verbose; else delete process.env.AGENT_VERBOSE;
    if (saved.baseUrl !== undefined) process.env.AGENT_BASE_URL = saved.baseUrl; else delete process.env.AGENT_BASE_URL;
    if (saved.timeout !== undefined) process.env.AGENT_TIMEOUT = saved.timeout; else delete process.env.AGENT_TIMEOUT;
    if (saved.xdg !== undefined) process.env.XDG_CONFIG_HOME = saved.xdg; else delete process.env.XDG_CONFIG_HOME;
    if (saved.debug !== undefined) process.env.DEBUG = saved.debug; else delete process.env.DEBUG;
}

function cleanAgentEnv() {
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_MAX_TOKENS;
    delete process.env.AGENT_VERBOSE;
    delete process.env.AGENT_BASE_URL;
    delete process.env.AGENT_TIMEOUT;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.DEBUG;
}

function setupTempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'smartagent-test-'));
    const env = saveEnv();
    process.chdir(dir);
    cleanAgentEnv();
    return { dir, env };
}

function cleanupTempDir(dir: string, env: ReturnType<typeof saveEnv>) {
    restoreEnv(env);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ============================================================
//  测试入口
// ============================================================
async function run() {
    console.log('🧪 ConfigManager 模块测试');
    console.log('━'.repeat(62));

    // 测试 1: 默认构造
    await testAsync('默认构造 - 无配置文件返回默认值', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.model, 'deepseek-chat', 'model');
            assertEqual(config.maxTokens, 4096, 'maxTokens');
            assertEqual(config.verbose, false, 'verbose');
            assertEqual(config.timeout, 30000, 'timeout');
            assertEqual(config.apiKey, undefined, 'apiKey 默认未设置');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 2: getValue
    await testAsync('getValue - 获取存在的配置项', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            assertEqual(mgr.getValue('model'), 'deepseek-chat', 'model');
            assertEqual(mgr.getValue('maxTokens'), 4096, 'maxTokens');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    await testAsync('getValue - 默认值回退', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            assertEqual(mgr.getValue('apiKey', 'fallback-key'), 'fallback-key', '回退默认值');
            assertEqual(mgr.getValue('model', 'deepseek-chat'), 'deepseek-chat', '不覆盖已有值');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 3: 项目配置文件
    await testAsync('加载项目配置文件 .smartagentrc', async () => {
        const { dir, env } = setupTempDir();
        try {
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                apiKey: 'sk-project-key',
                model: 'deepseek-reasoner',
            }));

            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.apiKey, 'sk-project-key', '项目配置 apiKey');
            assertEqual(config.model, 'deepseek-reasoner', '项目配置 model');
            assertEqual(config.maxTokens, 4096, '未覆盖保持默认');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 4: 本地覆盖
    await testAsync('.smartagentrc.local.json 覆盖项目配置', async () => {
        const { dir, env } = setupTempDir();
        try {
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                apiKey: 'sk-project',
                timeout: 10000,
            }));
            writeFileSync(join(dir, '.smartagentrc.local.json'), JSON.stringify({
                apiKey: 'sk-local-override',
                verbose: true,
            }));

            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.apiKey, 'sk-local-override', '本地覆盖项目 apiKey');
            assertEqual(config.timeout, 10000, '项目 timeout 保留');
            assertEqual(config.verbose, true, '本地新增 verbose');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 5: 环境变量覆盖
    await testAsync('环境变量覆盖所有文件配置', async () => {
        const { dir, env } = setupTempDir();
        try {
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                apiKey: 'sk-file',
                model: 'deepseek-chat',
                timeout: 10000,
            }));

            process.env.AGENT_API_KEY = 'sk-env-override';
            process.env.AGENT_MODEL = 'deepseek-reasoner';

            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.apiKey, 'sk-env-override', '环境变量覆盖 apiKey');
            assertEqual(config.model, 'deepseek-reasoner', '环境变量覆盖 model');
            assertEqual(config.timeout, 10000, '文件 timeout 保留');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 6: set
    await testAsync('set 写入项目配置文件', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            mgr.set('apiKey', 'sk-new-key');
            mgr.set('verbose', true);

            assertEqual(mgr.getValue('apiKey'), 'sk-new-key', '内存 apiKey');
            assertEqual(mgr.getValue('verbose'), true, '内存 verbose');

            const fileContent = readFileSync(join(dir, '.smartagentrc'), 'utf-8');
            const parsed = JSON.parse(fileContent);
            assertEqual(parsed.apiKey, 'sk-new-key', '文件 apiKey');
            assertEqual(parsed.verbose, true, '文件 verbose');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 7: setGlobal
    await testAsync('setGlobal 写入全局配置文件', async () => {
        const { dir, env } = setupTempDir();
        const globalCfgDir = join(dir, '.config', 'smartagent');
        try {
            process.env.XDG_CONFIG_HOME = join(dir, '.config');

            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            mgr.setGlobal('apiKey', 'sk-global');

            const globalPath = join(globalCfgDir, 'config.json');
            assertOk(existsSync(globalPath), '全局配置文件已创建');

            const content = JSON.parse(readFileSync(globalPath, 'utf-8'));
            assertEqual(content.apiKey, 'sk-global', '全局 apiKey');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 8: reload
    await testAsync('reload 热重载配置', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            assertEqual(mgr.getValue('apiKey', undefined), undefined, '初始无 apiKey');

            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({ apiKey: 'sk-reloaded' }));

            const newConfig = mgr.reload();
            assertEqual(newConfig.apiKey, 'sk-reloaded', '重载后读到新 apiKey');
            assertEqual(mgr.getValue('apiKey'), 'sk-reloaded', 'getValue 同步更新');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 9: reset
    await testAsync('reset 重置为默认配置', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            mgr.set('apiKey', 'sk-to-reset');
            mgr.set('verbose', true);

            const config = mgr.reset();

            assertEqual(config.apiKey, undefined, 'apiKey 恢复未设置');
            assertEqual(config.model, 'deepseek-chat', 'model 恢复默认');
            assertEqual(config.verbose, false, 'verbose 恢复默认');
            assertEqual(config.maxTokens, 4096, 'maxTokens 恢复默认');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 10: print 脱敏
    await testAsync('print 脱敏输出（不暴露完整 key）', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            mgr.set('apiKey', 'sk-this-is-a-very-long-api-key-for-testing');

            let output = '';
            const origLog = console.log;
            console.log = (...args: unknown[]) => { output += args.join(' ') + '\n'; };

            try {
                mgr.print();
            } finally {
                console.log = origLog;
            }

            assertOk(!output.includes('sk-this-is-a-very-long-api-key-for-testing'), '不暴露完整 key');
            assertMatch(output, /apiKey/, '包含 apiKey 字段');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 11: print 脱敏短 key
    await testAsync('print 短 key 完全隐藏', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            mgr.set('apiKey', 'short');

            let output = '';
            const origLog = console.log;
            console.log = (...args: unknown[]) => { output += args.join(' ') + '\n'; };

            try {
                mgr.print();
            } finally {
                console.log = origLog;
            }

            assertOk(!output.includes('short'), '短 key 完全隐藏');
            assertOk(output.includes('••••'), '显示隐藏占位符');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 12: configManager 单例
    await testAsync('configManager 单例导出', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { configManager } = await import('../src/cli/config-manager.js');
            const config = configManager.get();

            assertEqual(config.model, 'deepseek-chat');
            assertOk(typeof config.maxTokens === 'number');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // ============================================================
    //  汇总
    // ============================================================
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
