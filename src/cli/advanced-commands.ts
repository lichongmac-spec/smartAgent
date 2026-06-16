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
import { z } from 'zod';
import { configManager, type ConfigKey } from './config-manager.js'; // ✅ 添加类型导入

export function registerAdvancedCommands(program: Command): void {
    // ============================================================
    //  config 命令组 - 配置管理
    //  子命令: set, get, list
    // ============================================================
    const configCmd = program.command('config').description('配置管理');

    // config set <key> <value> - 设置配置项
    configCmd
        .command('set <key> <value>')
        .description('设置配置项')
        .option('-g, --global', '写入全局配置')
        .option('--port <number>', '端口号', (val) => parseInt(val, 10))
        .action((key, value, options) => {
            // 使用 Zod 校验输入参数
            const schema = z.object({
                key: z.string().min(1, 'key 不能为空'),
                value: z.string().min(1, 'value 不能为空'),
                port: z.number().optional(),
            });
            const validated = schema.parse({ key, value, port: options.port });

            // 写入配置（目前写入内存，后续可持久化）
            configManager.set(validated.key as any, validated.value);

            console.log(`✅ 设置 ${validated.key}=${validated.value}`);
            if (options.global) console.log('🌍 写入全局配置');
            if (validated.port) console.log(`🔌 端口: ${validated.port}`);
        });

    // src/cli/advanced-commands.ts (config 相关部分更新)

    // config get - 使用 configManager.getValue()
    configCmd
        .command('get <key>')
        .description('获取配置项')
        .action((key: string) => {
            const config = configManager.get();
            if (key in config) {
                const value = configManager.getValue(key as ConfigKey);
                console.log(`📖 ${key} = ${JSON.stringify(value)}`);
            } else {
                console.log(`❌ 配置项 "${key}" 不存在`);
                console.log('💡 可用配置项:', Object.keys(config).join(', '));
            }
        });

    // config list - 使用 configManager.print()
    configCmd
        .command('list')
        .description('列出所有配置')
        .option('--show-secrets', '显示敏感信息（如 API Key）')
        .action((options) => {
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
    program
        .command('ask <prompt>')
        .description('向 Agent 提问')
        .option('-m, --model <model>', '指定模型')
        .action((prompt, options) => {
            const config = configManager.get();
            const model = options.model || config.model;

            console.log(`💬 提问: ${prompt}`);
            console.log(`🤖 模型: ${model}`);
            // TODO: 后续接入真实的 LLM 调用
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
}