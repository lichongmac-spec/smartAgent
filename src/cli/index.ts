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
import { checkNodeVersion, isCI } from './env-check.js';
import { setupGracefulShutdown } from './error-handler.js';
import { configureLogger } from './logger.js';
import { registerAliases } from './utils/alias.js';
import { setVerbose } from './utils/debug.js';

// ============ 1. 环境检查 ============
checkNodeVersion();          // 确保 Node.js >= 18

// ============ 1.5 日志初始化 ============
// 注入 CI 检测结果
configureLogger({
    isCI: isCI(),
});
// 应用配置文件 / 环境变量中的 verbose 设置
setVerbose(configManager.get().verbose ?? false);

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

// ============ 3.5 注册命令别名 ============
// 必须在注册命令前拦截参数，使别名能映射到已注册的命令
// 例如: agent cfg list → agent config list
registerAliases(program);

// ============ 4. 注册所有命令 ============
registerAdvancedCommands(program);

// ============ 5. 解析参数 ============
// 过滤掉 pnpm/npm/yarn 注入的独立 '--'（会被 Commander 误判为 end-of-options）
// 例如：pnpm cli -- ask "hello" --no-stream
//       → argv: [node, script, '--', ask, hello, --no-stream]
//       → 过滤后: [node, script, ask, hello, --no-stream]
const cleanedArgv = process.argv.filter(arg => arg !== '--');
program.parse(cleanedArgv);

// ============ 6. 无参数时显示帮助 ============
if (!process.argv.slice(2).length) {
    program.outputHelp();
}