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
import { encrypt, isEncrypted } from '../src/cli/utils/encrypt.js';

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

function assertMatch(value: string, regex: RegExp, msg = ''): void {
    if (!regex.test(value)) {
        throw new Error(`${msg ? msg + ': ' : ''}"${value}" 不匹配 ${regex}`);
    }
}


// ============================================================
//  环境管理
// ============================================================
function saveEnv() {
    return {
        cwd: process.cwd(),
        apiKey: process.env.AGENT_API_KEY,
        provider: process.env.AGENT_PROVIDER,
        model: process.env.AGENT_MODEL,
        maxTokens: process.env.AGENT_MAX_TOKENS,
        verbose: process.env.AGENT_VERBOSE,
        baseUrl: process.env.AGENT_BASE_URL,
        timeout: process.env.AGENT_TIMEOUT,
        ollamaHost: process.env.AGENT_OLLAMA_HOST,
        ollamaModel: process.env.AGENT_OLLAMA_MODEL,
        deepseek: process.env.DEEPSEEK_API_KEY,
        openai: process.env.OPENAI_API_KEY,
        smartagent: process.env.SMARTAGENT_PROVIDER,
        xdg: process.env.XDG_CONFIG_HOME,
        debug: process.env.DEBUG,
    };
}

function restoreEnv(saved: ReturnType<typeof saveEnv>) {
    process.chdir(saved.cwd);
    const vars: (keyof typeof saved)[] = [
        'apiKey', 'provider', 'model', 'maxTokens', 'verbose',
        'baseUrl', 'timeout', 'ollamaHost', 'ollamaModel',
        'deepseek', 'openai', 'smartagent', 'xdg', 'debug',
    ];
    const envMap: Record<string, string> = {
        apiKey: 'AGENT_API_KEY',
        provider: 'AGENT_PROVIDER',
        model: 'AGENT_MODEL',
        maxTokens: 'AGENT_MAX_TOKENS',
        verbose: 'AGENT_VERBOSE',
        baseUrl: 'AGENT_BASE_URL',
        timeout: 'AGENT_TIMEOUT',
        ollamaHost: 'AGENT_OLLAMA_HOST',
        ollamaModel: 'AGENT_OLLAMA_MODEL',
        deepseek: 'DEEPSEEK_API_KEY',
        openai: 'OPENAI_API_KEY',
        smartagent: 'SMARTAGENT_PROVIDER',
        xdg: 'XDG_CONFIG_HOME',
        debug: 'DEBUG',
    };
    for (const key of vars) {
        const envName = envMap[key];
        if (saved[key] !== undefined) {
            process.env[envName] = saved[key]!;
        } else {
            delete process.env[envName];
        }
    }
}

function cleanAgentEnv() {
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_MAX_TOKENS;
    delete process.env.AGENT_VERBOSE;
    delete process.env.AGENT_BASE_URL;
    delete process.env.AGENT_TIMEOUT;
    delete process.env.AGENT_OLLAMA_HOST;
    delete process.env.AGENT_OLLAMA_MODEL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SMARTAGENT_PROVIDER;
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

            assertEqual(config.model, 'deepseek-v4-flash', 'model');
            assertEqual(config.maxTokens, 4096, 'maxTokens');
            assertEqual(config.verbose, false, 'verbose');
            assertEqual(config.timeout, 30000, 'timeout');
            assertEqual(config.apiKey, undefined, 'apiKey 默认未设置');
            assertEqual(config.provider, 'ollama', 'provider 默认 ollama');
            assertEqual(config.ollamaHost, 'http://localhost:11434', 'ollamaHost');
            assertEqual(config.ollamaModel, 'qwen2.5:7b', 'ollamaModel');
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

            assertEqual(mgr.getValue('model'), 'deepseek-v4-flash', 'model');
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
            assertEqual(mgr.getValue('model', 'deepseek-v4-flash'), 'deepseek-v4-flash', '不覆盖已有值');
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
                model: 'deepseek-v4-flash',
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

    // 测试 6: set - 加密存储
    await testAsync('set 写入时 apiKey 加密存储', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            mgr.set('apiKey', 'sk-new-key');
            mgr.set('verbose', true);

            // 内存中的值应为明文
            assertEqual(mgr.getValue('apiKey'), 'sk-new-key', '内存 apiKey 明文');
            assertEqual(mgr.getValue('verbose'), true, '内存 verbose');

            // 磁盘文件中的 apiKey 应为密文
            const fileContent = readFileSync(join(dir, '.smartagentrc'), 'utf-8');
            const parsed = JSON.parse(fileContent);
            assertOk(isEncrypted(parsed.apiKey), '磁盘 apiKey 已加密');
            assertOk(!parsed.apiKey.includes('sk-new-key'), '磁盘不包含明文 key');
            assertEqual(parsed.verbose, true, '非敏感字段仍为明文');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 7: setGlobal - 加密存储
    await testAsync('setGlobal 写入时 apiKey 加密存储', async () => {
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
            assertOk(isEncrypted(content.apiKey), '全局 apiKey 已加密');
            assertEqual(mgr.getValue('apiKey'), 'sk-global', '内存 apiKey 明文');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 8: reload
    await testAsync('reload 热重载配置（明文文件向后兼容）', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();

            assertEqual(mgr.getValue('apiKey', undefined), undefined, '初始无 apiKey');

            // 写入明文 apiKey（模拟旧版配置文件）
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({ apiKey: 'sk-reloaded' }));

            const newConfig = mgr.reload();
            assertEqual(newConfig.apiKey, 'sk-reloaded', '重载后读到旧版明文 apiKey');
            assertEqual(mgr.getValue('apiKey'), 'sk-reloaded', 'getValue 同步更新');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 8b: 加载加密配置文件
    await testAsync('加载预加密的配置文件', async () => {
        const { dir, env } = setupTempDir();
        try {
            const encryptedKey = encrypt('sk-encrypted');

            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                apiKey: encryptedKey,
                model: 'deepseek-reasoner',
            }));

            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.apiKey, 'sk-encrypted', '加密 apiKey 正确解密');
            assertEqual(config.model, 'deepseek-reasoner', '非敏感字段不受影响');
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
            assertEqual(config.model, 'deepseek-v4-flash', 'model 恢复默认');
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

            assertEqual(config.model, 'deepseek-v4-flash');
            assertOk(typeof config.maxTokens === 'number');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // ============================================================
    //  🆕 测试 13: 新增字段默认值
    // ============================================================
    await testAsync('默认字段 - provider/ollamaHost/ollamaModel', async () => {
        const { dir, env } = setupTempDir();
        try {
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.provider, 'ollama', 'provider 默认 ollama');
            assertEqual(config.ollamaHost, 'http://localhost:11434', 'ollamaHost 默认值');
            assertEqual(config.ollamaModel, 'qwen2.5:7b', 'ollamaModel 默认值');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 14: 环境变量 AGENT_PROVIDER
    await testAsync('环境变量 AGENT_PROVIDER 覆盖 provider', async () => {
        const { dir, env } = setupTempDir();
        try {
            process.env.AGENT_PROVIDER = 'mock';
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.provider, 'mock', 'AGENT_PROVIDER 覆盖默认值');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 15: 环境变量 AGENT_OLLAMA_HOST / AGENT_OLLAMA_MODEL
    await testAsync('环境变量 AGENT_OLLAMA_HOST/MODEL 覆盖 Ollama 配置', async () => {
        const { dir, env } = setupTempDir();
        try {
            process.env.AGENT_OLLAMA_HOST = 'http://192.168.1.100:11434';
            process.env.AGENT_OLLAMA_MODEL = 'llama3.2:3b';
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.ollamaHost, 'http://192.168.1.100:11434', 'ollamaHost 被环境变量覆盖');
            assertEqual(config.ollamaModel, 'llama3.2:3b', 'ollamaModel 被环境变量覆盖');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 16: model 字段支持字符串（非枚举）
    await testAsync('model 字段支持非 DeepSeek 模型名', async () => {
        const { dir, env } = setupTempDir();
        try {
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                provider: 'openai',
                model: 'gpt-4o-mini',
            }));
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const mgr = new ConfigManager();
            const config = mgr.get();

            assertEqual(config.provider, 'openai', 'provider 从文件读取');
            assertEqual(config.model, 'gpt-4o-mini', 'model 支持任意字符串');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 17: createLLMClientFromConfig 冒烟测试（用新 ConfigManager 避免单例缓存）
    await testAsync('createLLMClientFromConfig 从配置读取 provider', async () => {
        const { dir, env } = setupTempDir();
        try {
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                provider: 'mock',
                model: 'gpt-4o-mini',
            }));

            // 使用新 ConfigManager 实例，避免单例缓存导致读取旧 cwd 的配置
            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const freshMgr = new ConfigManager();
            const cfg = freshMgr.get();
            assertEqual(cfg.provider, 'mock', 'provider 从文件读取');
            assertEqual(cfg.model, 'gpt-4o-mini', 'model 从文件读取');

            // 用配置值手动创建客户端（等价于 createLLMClientFromConfig 的逻辑）
            const { createLLMClient } = await import('../src/llm/client-factory.js');
            const client = await createLLMClient({
                provider: cfg.provider as any,
                model: cfg.model,
            });
            assertOk(await client.healthCheck(), 'Mock 客户端健康');
            const resp = await client.chat([{ role: 'user', content: 'test' }]);
            assertOk(resp.content.length > 0, '有回复内容');
        } finally {
            cleanupTempDir(dir, env);
        }
    });

    // 测试 18: createLLMClientFromConfig 支持 overrides（测试 ConfigManager + override 组合）
    await testAsync('createLLMClientFromConfig overrides 覆盖配置', async () => {
        const { dir, env } = setupTempDir();
        try {
            writeFileSync(join(dir, '.smartagentrc'), JSON.stringify({
                provider: 'mock',
            }));

            const { ConfigManager } = await import('../src/cli/config-manager.js');
            const freshMgr = new ConfigManager();
            const cfg = freshMgr.get();
            assertEqual(cfg.provider, 'mock', '配置读取为 mock');

            // overrides 模拟 provider 和 model 的覆盖
            const { createLLMClient } = await import('../src/llm/client-factory.js');
            const client = await createLLMClient({
                provider: cfg.provider as any,
                model: 'custom-override-model',
            });

            assertOk(await client.healthCheck(), 'override 客户端健康');
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
