#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { registerAdvancedCommands } from './advanced-commands.js';
// import { configManager } from './config-manager.js';
// import { checkNodeVersion } from './env-check.js';
// import { setupGracefulShutdown } from './error-handler.js';
// ============ 1. 环境检查 ============
// checkNodeVersion();
// setupGracefulShutdown();

// ============ 2. 创建 CLI 主程序 ============
const program = new Command();
program
    .name('agent')
    .description('SmartAgent CLI - 智能编程助手')
    .version('1.0.0');

// ============ 3. 注册所有命令 ============
registerAdvancedCommands(program);

// ============ 4. 额外的交互式命令：chat ============
program
    .command('chat')
    .description('进入交互式对话模式')
    .option('-m, --model <model>', '指定模型')
    .action(async (options) => {
        console.log('💬 进入 Chat 模式 (按 Ctrl+C 退出)');
        // TODO: 实现 chat 逻辑
    });

// ============ 5. 额外命令：config list ============
// program
//     .command('config list')
//     .description('列出当前所有配置')
//     .action(() => {
//         const config = configManager.get();
//         console.log('📋 当前配置:');
//         Object.entries(config).forEach(([key, value]) => {
//             console.log(`  ${key}: ${value}`);
//         });
//     });
// ============ 6. 解析参数 ============
program.parse(process.argv);

// ============ 7. 如果没有参数，显示帮助 ============
if (!process.argv.slice(2).length) {
    program.outputHelp();
}

// ============ 类型定义 ============
interface Config {
    name?: string;
    verbose?: boolean;
}

// ============ 配置读取 ============
function loadConfig(): Config {
    try {
        const configPath = resolve(process.cwd(), '.myclirc');
        const content = readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return { name: 'World', verbose: false };
    }
}

// ============ 参数解析 ============
function parseArgs(): { command: string; args: string[]; options: Record<string, string | boolean> } {
    const args = process.argv.slice(2);
    const options: Record<string, string | boolean> = {};
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const next = args[i + 1];
            if (next && !next.startsWith('--')) {
                options[key] = next;
                i++;
            } else {
                options[key] = true;
            }
        } else if (args[i].startsWith('-')) {
            const key = args[i].slice(1);
            options[key] = true;
        } else {
            positional.push(args[i]);
        }
    }

    const command = positional[0] || 'hello';
    const commandArgs = positional.slice(1);

    return { command, args: commandArgs, options };
}

// ============ 命令处理 ============
async function main() {
    const config = loadConfig();
    const { command, args, options } = parseArgs();
    const verbose = options.verbose === true || config.verbose === true;

    if (verbose) {
        console.error(`[DEBUG] 命令: ${command}`);
        console.error(`[DEBUG] 参数: ${args.join(', ')}`);
        console.error(`[DEBUG] 配置: ${JSON.stringify(config)}`);
    }

    switch (command) {
        case 'hello':
            const name = args[0] || config.name || 'World';
            console.log(`Hello, ${name}!`);
            break;

        case 'echo':
            console.log(args.join(' '));
            break;

        case 'add':
            const sum = args.map(Number).reduce((a, b) => a + b, 0);
            console.log(sum);
            break;

        case 'help':
        case '--help':
        case '-h':
            console.log(`
用法: mycli [命令] [选项]

命令:
  hello [name]   打招呼（默认: World）
  echo <文本>    回显内容
  add <数字...>  求和

选项:
  --verbose, -v  显示详细信息
  --help, -h     显示帮助

配置文件:
  在项目目录创建 .myclirc 文件:
  { "name": "YourName", "verbose": true }
`);
            break;

        default:
            console.error(`未知命令: ${command}`);
            console.error('运行 "mycli --help" 查看可用命令');
            process.exit(1);
    }
}

// ============ 入口 ============
main().catch((error) => {
    console.error(`错误: ${error.message}`);
    process.exit(1);
});