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
import { HeartbeatManager } from '../health/index.js';
import type { UnhealthyEvent } from '../health/types.js';
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

// ============ 2. 心跳 & 健康监控 ============
// 创建心跳管理器（不含 LLM 客户端，内置检查为磁盘+内存）
// 详细监控在 advanced-commands 中创建 LLM 客户端后动态注册
const heartbeat = new HeartbeatManager({
  intervalMs: 60_000,        // 每分钟检查一次
  failureThreshold: 3,        // 连续 3 次失败才报警
  recoveryThreshold: 2,       // 连续 2 次成功恢复
  autoRestart: false,         // 默认不自动重启
  initialCheck: false,        // 启动时不立即检查（避免阻塞）
});

// 启动心跳
heartbeat.start();

// 监听健康状态变化
heartbeat.on('unhealthy', (event: UnhealthyEvent) => {
  console.error(`\n🚨 [心跳] 系统不健康！失败项: ${event.failedChecks.map(c => c.name).join(', ')}`);
});

heartbeat.on('recovered', () => {
  console.log(`\n✅ [心跳] 系统已恢复健康`);
});

// ============ 3. 优雅退出 ============
setupGracefulShutdown({
    verbose: true,
    cleanupFns: [
        async () => { heartbeat.stop(); },
    ],
});

// ============ 4. 创建 CLI 主程序 ============
const program = new Command();

program
    .name('agent')
    .description('SmartAgent CLI - 智能助手')
    .version('1.0.0');

// ============ 5. 注册所有命令 ============
registerAdvancedCommands(program);

// ============ 6. 解析参数 ============
// 过滤掉 pnpm/npm/yarn 注入的独立 '--'（会被 Commander 误判为 end-of-options）
// 例如：pnpm cli -- ask "hello" --no-stream
//       → argv: [node, script, '--', ask, hello, --no-stream]
//       → 过滤后: [node, script, ask, hello, --no-stream]
const cleanedArgv = process.argv.filter(arg => arg !== '--');

// 预处理别名展开（如 cfg → config、q → ask），在 Commander 解析前完成
const expandedArgv = [cleanedArgv[0], cleanedArgv[1], ...expandAlias(cleanedArgv.slice(2))];
program.parse(expandedArgv);

// ============ 7. 无参数时显示帮助 ============
if (!process.argv.slice(2).length) {
    program.outputHelp();
}