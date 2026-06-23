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
import { expandAlias } from './utils/alias.js';
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

// ============ 1.6 启动时配置验证 ============
// 检查 API Key 是否匹配当前 Provider
const startupConfig = configManager.get();
if (startupConfig.provider === 'deepseek' || startupConfig.provider === 'openai') {
  if (!startupConfig.apiKey) {
    const providerName = startupConfig.provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
    console.warn(`\n⚠️  警告: 已选择 Provider '${providerName}' 但未配置 API Key`);
    console.warn('');
    console.warn('请通过以下方式之一配置:');
    console.warn(`  1. 环境变量: AGENT_API_KEY=sk-xxx`);
    console.warn('  2. 本地配置: 在 .smartagentrc.local.json 中设置 "apiKey"');
    console.warn('  3. CLI 命令: pnpm cli -- config set apiKey sk-xxx');
    console.warn('');
    console.warn('当前将自动降级到 Ollama 本地模式。\n');
    configManager.set('provider', 'ollama' as any);
  }
}

// ============ 2. 优雅退出 ============
setupGracefulShutdown({
    verbose: true,
    cleanupFns: [],
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
// 过滤掉 pnpm/npm/yarn 注入的独立 '--'（会被 Commander 误判为 end-of-options）
// 例如：pnpm cli -- ask "hello" --no-stream
//       → argv: [node, script, '--', ask, hello, --no-stream]
//       → 过滤后: [node, script, ask, hello, --no-stream]
const cleanedArgv = process.argv.filter(arg => arg !== '--');

// 预处理别名展开（如 cfg → config、q → ask），在 Commander 解析前完成
const expandedArgv = [cleanedArgv[0], cleanedArgv[1], ...expandAlias(cleanedArgv.slice(2))];
program.parse(expandedArgv);

// ============ 6. 无参数时显示帮助 ============
if (!process.argv.slice(2).length) {
    program.outputHelp();
}