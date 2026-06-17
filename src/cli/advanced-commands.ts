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

import * as readline from 'readline';
import { Command } from 'commander';
import { configManager, type ConfigKey } from './config-manager.js';
import { configError } from './error-handler.js';
import {
    ContextManager,
    readFromStdin,
    loadContextFromFile,
    printStream,
    streamResponse,
} from './context-aware.js';
import { logger } from './logger.js';
import { renderKVTable } from './utils/table.js';
import { setupAutocomplete, chatCompleter } from './utils/autocomplete.js';

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

            // 写入配置（项目或全局）
            if (options.global) {
                configManager.setGlobal(key as ConfigKey, parsedValue);
            } else {
                configManager.set(key as ConfigKey, parsedValue);
            }
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

    // config list - 表格输出
    configCmd
        .command('list')
        .description('列出所有配置')
        .option('--show-secrets', '显示敏感信息（如 API Key）')
        .option('--json', '以 JSON 格式输出（便于脚本解析）')
        .action((options) => {
            const config = configManager.get();

            if (options.json) {
                console.log(JSON.stringify(config, null, 2));
                return;
            }

            // 构建展示用的配置对象（含脱敏）
            const displayConfig: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(config)) {
                if (key === 'apiKey' && !options.showSecrets && typeof value === 'string') {
                    // 安全脱敏：按比例显示首尾，短 key 完全隐藏
                    if (value.length > 8) {
                        const visible = Math.min(6, Math.floor(value.length / 3));
                        displayConfig[key] = value.slice(0, visible) + '…' + value.slice(-Math.min(4, visible));
                    } else if (value.length > 0) {
                        displayConfig[key] = '••••'; // 完全隐藏
                    } else {
                        displayConfig[key] = '(未设置)';
                    }
                } else {
                    displayConfig[key] = value;
                }
            }

            renderKVTable(displayConfig, { title: '📋 当前配置' });
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
    //  支持：stdin 管道、上下文文件、流式/非流式输出、系统提示词
    // ============================================================
    program
        .command('ask <prompt>')
        .description('向 Agent 提问（支持管道和文件上下文）')
        .option('-m, --model <model>', '指定模型')
        .option('-v, --verbose', '显示详细信息')
        .option('-c, --context <file>', '加载上下文文件（支持多个 -c）')
        .option('--no-stream', '禁用流式输出')
        .option('-s, --system-prompt <text>', '自定义系统提示词')
        .option('--token-limit <number>', 'token 上限（裁剪用）', parseInt)
        .action(async (prompt: string, options: {
            model?: string;
            verbose?: boolean;
            context?: string | string[];
            stream?: boolean;
            systemPrompt?: string;
            tokenLimit?: number;
        }) => {
            try {
                const config = configManager.get();
                const model = options.model || config.model;

                // ---- 1. 构建系统提示词 ----
                const systemPrompt = options.systemPrompt ?? undefined;

                // ---- 2. 读取 stdin 管道 ----
                const stdinContent = await readFromStdin();

                // ---- 3. 加载上下文文件 ----
                let fileContent = '';
                if (options.context) {
                    const paths = Array.isArray(options.context)
                        ? options.context
                        : [options.context];

                    for (const p of paths) {
                        try {
                            const result = loadContextFromFile(p);
                            fileContent += `\n\n## 文件: ${result.path}\n${result.content}`;
                            if (result.truncated) {
                                logger.warn(`文件 ${p} 过大，已截断至 ~1MB`);
                            }
                        } catch (err) {
                            logger.warn(`加载文件失败: ${(err as Error).message}`);
                        }
                    }
                }

                // ---- 4. 组装完整 prompt ----
                let finalPrompt = prompt;
                if (fileContent) {
                    finalPrompt = `${prompt}\n\n---\n${fileContent}`;
                }
                if (stdinContent) {
                    finalPrompt = `${finalPrompt}\n\n---\n📥 管道输入:\n${stdinContent}`;
                }

                // ---- 5. 构建上下文 ----
                const ctx = new ContextManager(systemPrompt);
                ctx.addUserMessage(finalPrompt);

                // Verbose 输出诊断信息
                if (options.verbose) {
                    logger.blank();
                    logger.info(`💬 提问: ${prompt}`);
                    logger.info(`🤖 模型: ${model}`);
                    logger.debug(`消息数: ${ctx.getStats().messageCount}`);
                    logger.debug(`估算 tokens: ${ctx.getStats().estimatedTokens}`);
                    if (systemPrompt) logger.debug(`系统提示: ${systemPrompt.slice(0, 80)}...`);
                    if (stdinContent) logger.info('📥 检测到管道输入');
                    if (fileContent) logger.info('📄 已加载上下文文件');
                    if (options.tokenLimit) logger.info(`📏 Token 上限: ${options.tokenLimit}`);
                    logger.blank();
                }

                // ---- 6. 模拟 LLM 响应 ----
                // TODO: 替换为真实 API 调用 + SSE 流式解析
                const mockResponse =
                    `收到问题: "${prompt}"\n\n` +
                    `当前上下文包含 ${ctx.length} 条消息，` +
                    `估算 ${ctx.totalTokens} tokens。\n\n` +
                    `这是模拟回复 —— 接入真实 LLM API 后将返回实际内容。`;

                if (options.stream !== false) {
                    // 流式输出
                    await printStream(streamResponse(mockResponse, 15));
                } else {
                    // 非流式输出
                    console.log(mockResponse);
                }
            } catch (error) {
                const { handleError } = await import('./error-handler.js');
                handleError(error);
            }
        });

    // ============================================================
    //  chat 命令 - 交互式对话模式
    // ============================================================
    program
        .command('chat')
        .description('进入交互式对话模式（Tab 补全，/exit 退出）')
        .option('-m, --model <model>', '指定模型')
        .option('-s, --system-prompt <text>', '自定义系统提示词')
        .option('--no-stream', '禁用流式输出')
        .action(async (options: { model?: string; systemPrompt?: string; stream?: boolean }) => {
            const { handleError } = await import('./error-handler.js');

            try {
                const config = configManager.get();
                const model = options.model || config.model;

                // 非 TTY 环境：打印提示并退出（管道调用、CI 等）
                if (!process.stdin.isTTY) {
                    console.log(`💬 Chat 模式需要交互式终端。`);
                    console.log(`   使用 ask 命令进行非交互式提问：agent ask "你的问题"`);
                    return;
                }

                // 创建对话上下文（支持系统提示词）
                const ctx = new ContextManager(options.systemPrompt);

                console.log(`💬 进入 Chat 模式 (模型: ${model})`);
                console.log(`   会话 ID: ${ctx.sessionId}`);
                console.log('   输入消息开始对话，Tab 补全命令，/exit 退出，/clear 清上下文');
                if (options.systemPrompt) {
                    console.log(`   系统提示: ${options.systemPrompt.slice(0, 60)}...`);
                }
                console.log('');

                // 创建 readline 实例 + 安装补全
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                    prompt: '> ',
                    terminal: true,
                });

                // 安装 Tab 自动补全
                setupAutocomplete(rl, chatCompleter);

                // 交互循环
                for await (const rawLine of rl) {
                    const line = rawLine.trim();

                    // 空行跳过
                    if (!line) {
                        rl.prompt();
                        continue;
                    }

                    // ---- 控制命令 ----
                    if (line === '/exit' || line === '/quit') {
                        console.log('👋 再见！');
                        rl.close();
                        break;
                    }

                    if (line === '/clear') {
                        ctx.clear();
                        console.log('✅ 上下文已清空');
                        rl.prompt();
                        continue;
                    }

                    if (line === '/help') {
                        console.log('');
                        console.log('  📖 Chat 模式帮助');
                        console.log('  ──────────────────────────');
                        console.log('  /exit, /quit    退出对话');
                        console.log('  /clear          清空上下文');
                        console.log('  /help           显示此帮助');
                        console.log('  /save           保存会话到文件');
                        console.log('  /load           从文件恢复会话');
                        console.log('  /stats          显示上下文统计');
                        console.log('  Tab             自动补全命令');
                        console.log('');
                        rl.prompt();
                        continue;
                    }

                    if (line === '/stats') {
                        const stats = ctx.getStats();
                        console.log('');
                        logger.info(`📊 会话统计 | ID: ${ctx.sessionId}`);
                        logger.info(`  消息数: ${stats.messageCount}`);
                        logger.info(`  估算 tokens: ${stats.estimatedTokens}`);
                        logger.info(`  总字符数: ${stats.totalChars}`);
                        console.log('');
                        rl.prompt();
                        continue;
                    }

                    if (line === '/save') {
                        console.log('📝 会话保存功能将在后续版本实现');
                        rl.prompt();
                        continue;
                    }

                    if (line === '/load') {
                        console.log('📂 会话恢复功能将在后续版本实现');
                        rl.prompt();
                        continue;
                    }

                    // ---- 正常对话 ----
                    ctx.addUserMessage(line);

                    // TODO: 替换为真实 API 调用 + SSE 流式解析
                    const mockResponse =
                        `收到: "${line.length > 60 ? line.slice(0, 60) + '…' : line}"\n` +
                        `当前上下文 ${ctx.length} 条消息，估算 ${ctx.totalTokens} tokens。`;

                    if (options.stream !== false) {
                        console.log('');
                        await printStream(streamResponse(mockResponse, 15));
                        console.log('');
                    } else {
                        console.log('');
                        console.log(mockResponse);
                        console.log('');
                    }

                    ctx.addAssistantMessage(mockResponse);
                    rl.prompt();
                }

                rl.close();
            } catch (error) {
                handleError(error);
            }
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