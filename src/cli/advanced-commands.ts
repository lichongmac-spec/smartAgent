// src/cli/advanced-commands.ts
import { Command } from 'commander';
import { z } from 'zod';

export function registerAdvancedCommands(program: Command): void {
    // ============ config 命令组 ============
    // 注意：只调用一次 .command('config')，用多个子命令
    const configCmd = program.command('config').description('配置管理');

    // config set
    configCmd
        .command('set <key> <value>')
        .description('设置配置项')
        .option('-g, --global', '写入全局配置')
        .option('--port <number>', '端口号', (val) => parseInt(val, 10))
        .action((key, value, options) => {
            const schema = z.object({
                key: z.string().min(1),
                value: z.string().min(1),
                port: z.number().optional(),
            });
            const validated = schema.parse({ key, value, port: options.port });
            console.log(`✅ 设置 ${validated.key}=${validated.value}`);
            if (options.global) console.log('🌍 写入全局配置');
            if (options.port) console.log(`🔌 端口: ${options.port}`);
        });

    // config get
    configCmd
        .command('get <key>')
        .description('获取配置项')
        .action((key) => {
            console.log(`📖 配置 ${key} = (模拟值)`);
        });

    // config list
    configCmd
        .command('list')
        .description('列出所有配置')
        .action(() => {
            console.log('📋 配置列表:');
            console.log('  model: deepseek-chat');
            console.log('  maxTokens: 4096');
        });

    // ============ ask 命令 ============
    program
        .command('ask <prompt>')
        .description('向 Agent 提问')
        .option('-m, --model <model>', '指定模型')
        .action((prompt, options) => {
            console.log(`💬 提问: ${prompt}`);
            console.log(`🤖 模型: ${options.model || 'default'}`);
        });
}