#!/usr/bin/env node
/**
 * SmartAgent CLI 入口文件
 * 
 * 职责：
 * 1. 环境检查（Node 版本、优雅退出）
 * 2. 创建 Commander 主程序
 * 3. 注册所有命令（从 advanced-commands 导入）
 * 4. 解析命令行参数并执行
 */

import { Command } from 'commander';
import { registerAdvancedCommands } from './advanced-commands.js';
import { configManager } from './config-manager.js';
import { checkNodeVersion } from './env-check.js';
import { setupGracefulShutdown } from './error-handler.js';

// ============ 1. 环境检查 ============
checkNodeVersion();          // 确保 Node.js >= 18
// ============ 2. 优雅退出 ============
setupGracefulShutdown({
    verbose: true,
    cleanupFns: [
        // 示例清理函数
        async () => {
            // 保存当前配置
            const config = configManager.get();
            // 可以在此执行清理操作，如保存临时状态
        },
    ],
});

// ============ 3. 创建 CLI 主程序 ============
const program = new Command();

program
    .name('agent')
    .description('SmartAgent CLI - 智能助手')
    .version('1.0.0');

// ============ 4. 注册所有命令 ============
registerAdvancedCommands(program);

// ============ 5. 解析参数 ============
program.parse(process.argv);

// ============ 6. 无参数时显示帮助 ============
if (!process.argv.slice(2).length) {
    program.outputHelp();
}