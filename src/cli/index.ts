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
import { checkNodeVersion } from './env-check.js';
import { setupGracefulShutdown } from './error-handler.js';

// ============ 1. 环境检查 ============
checkNodeVersion();          // 确保 Node.js >= 18
setupGracefulShutdown();     // Ctrl+C 优雅退出

// ============ 2. 创建 CLI 主程序 ============
const program = new Command();

program
    .name('agent')
    .description('SmartAgent CLI - 智能助手')
    .version('1.0.0');

// ============ 3. 注册所有命令 ============
// 所有业务命令集中在 advanced-commands.ts 中管理
registerAdvancedCommands(program);

// ============ 4. 解析参数 ============
program.parse(process.argv);

// ============ 5. 无参数时显示帮助 ============
if (!process.argv.slice(2).length) {
    program.outputHelp();
}