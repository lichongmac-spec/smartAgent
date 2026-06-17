/**
 * 命令注册模块
 * 
 * 职责：
 * 1. 注册所有 CLI 命令（config、ask、chat 等）
 * 2. 每个命令的 action 只做参数接收和调用 service
 * 3. 不包含业务逻辑（业务逻辑放在 service 层）
 * 
 * 扩展方式：在此文件中添加新的 .command() 链
 */

import { Command } from 'commander';
import { configManager, type ConfigKey } from './config-manager.js'; // ✅ 添加类型导入
import { configError } from './error-handler.js';

export function registerAdvancedCommands(program: Command): void {
    // ============================================================
    //  config 命令组 - 配置管理
    //  子命令: set, get, list
    // ============================================================
    const configCmd = program.command('config').description('配置管理');

    // config set <key> <value> - 设置配置项

    configCmd
        .command('set <key> <value>')
        .description('设置配置项（value 支持 JSON 格式）')
        .option('-g, --global', '写入全局配置')
        .action((key: string, value: string, options: { global?: boolean }) => {
            // ✅ 尝试解析 JSON
            let parsedValue: any = value;
            try {
                parsedValue = JSON.parse(value);
            } catch {
                // 不是 JSON，保持原样
            }

            // 校验 key
            if (!key || key.trim().length === 0) {
                throw configError('key 不能为空');
            }

            // 写入配置
            configManager.set(key as ConfigKey, parsedValue);
            console.log(`✅ 设置 ${key}=${JSON.stringify(parsedValue)}`);
            if (options.global) console.log('🌍 写入全局配置');
        });

    // src/cli/advanced-commands.ts (config 相关部分更新)

    // 在 config get 中验证配置
    configCmd
        .command('get <key>')
        .description('获取配置项')
        .action((key: string) => {
            const config = configManager.get();
            if (key in config) {
                const value = configManager.getValue(key as ConfigKey);
                console.log(`📖 ${key} = ${JSON.stringify(value)}`);
            } else {
                // 使用配置错误
                throw configError(`配置项 "${key}" 不存在`, {
                    showStack: false,
                });
            }
        });

    // config list - 使用 configManager.print()
    configCmd
        .command('list')
        .description('列出所有配置')
        .option('--show-secrets', '显示敏感信息（如 API Key）')
        .option('--json', '以 JSON 格式输出（便于脚本解析）')  // ✅ 新增
        .action((options) => {
            const config = configManager.get();

            if (options.json) {
                console.log(JSON.stringify(config, null, 2));
                return;
            }
            if (options.showSecrets) {
                const config = configManager.get();
                console.log('📋 当前配置:');
                Object.entries(config).forEach(([key, value]) => {
                    console.log(`  ${key}: ${JSON.stringify(value)}`);
                });
            } else {
                configManager.print();
            }
        });

    // config reload - 新增热重载命令
    configCmd
        .command('reload')
        .description('热重载配置文件')
        .action(() => {
            configManager.reload();
            console.log('✅ 配置已重新加载');
        });

    // ============================================================
    //  ask 命令 - 向 Agent 提问（核心命令）
    // ============================================================
    // 在 ask 命令中处理网络错误
    program
        .command('ask <prompt>')
        .description('向 Agent 提问')
        .option('-m, --model <model>', '指定模型')
        .option('-v, --verbose', '显示详细信息')
        .action(async (prompt: string, options: { model?: string; verbose?: boolean }) => {
            try {
                const config = configManager.get();
                const model = options.model || config.model;

                console.log(`💬 提问: ${prompt}`);
                console.log(`🤖 模型: ${model}`);
                // TODO: 替换为真实的 API 调用
                // 模拟 API 调用（不要真的使用 fetch 去请求，因为配置不完整）
                await new Promise(resolve => setTimeout(resolve, 1000));

                console.log('✅ 模拟响应完成');
                // 实际使用时，取消注释下面的代码并完善 fetch 配置
                /*
                const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                    }),
                });
    
                if (!response.ok) {
                    if (response.status === 401) {
                        throw userError('API Key 无效或已过期');
                    }
                    if (response.status === 429) {
                        throw networkError('请求频率过高，请稍后重试');
                    }
                    throw networkError(`API 请求失败: ${response.status}`);
                }
    
                const data = await response.json();
                console.log('🤖 Agent:', data.choices[0].message.content);
                */
            } catch (error) {
                // 统一错误处理
                const { handleError } = await import('./error-handler.js');
                handleError(error);
            }
        });

    // ============================================================
    //  chat 命令 - 交互式对话模式
    // ============================================================
    program
        .command('chat')
        .description('进入交互式对话模式')
        .option('-m, --model <model>', '指定模型')
        .action(async (options) => {
            const config = configManager.get();
            const model = options.model || config.model;

            console.log(`💬 进入 Chat 模式 (模型: ${model})`);
            console.log('   输入 /exit 退出，/clear 清屏');
            // TODO: 后续接入 readline 循环 + LLM 调用
        });

    // src/cli/advanced-commands.ts

    // ============ 隐藏的测试命令 ============
    program
        .command('test:error')
        .description('测试错误处理模块（隐藏命令）')
        .option('--type <type>', '错误类型: user, network, system, config')
        .option('--show-stack', '显示堆栈信息')
        .action(async (options) => {
            // ✅ 动态导入错误处理模块
            const { userError, networkError, systemError, configError } = await import('./error-handler.js');

            // ✅ 使用类型映射，避免大量 switch-case
            const errorMap: Record<string, () => Error> = {
                user: () => userError('API Key 无效，请检查你的 API Key 是否正确配置'),
                network: () => networkError('连接超时，无法访问 API 服务，请检查网络连接'),
                system: () => systemError('读取配置文件失败，请检查文件权限或路径是否正确'),
                config: () => configError('缺少必要的配置项: apiKey，请运行 agent config set apiKey <your-key>'),
            };
            const errorFn = errorMap[options.type];
            if (!errorFn) {
                console.log('❌ 未知错误类型，请使用: user, network, system, config');
                console.log('示例: pnpm cli -- test:error --type network');
                return;
            }

            // ✅ 抛出错误，由全局错误处理器捕获
            throw errorFn();
        });
}