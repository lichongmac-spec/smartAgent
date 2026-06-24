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
} from './context-aware.js';
import { logger } from './logger.js';
import { renderKVTable } from './utils/table.js';
import { redactApiKey } from './utils/secrets.js';
import { setupAutocomplete, enhancedChatCompleter, modelCompleter } from './utils/autocomplete.js';
import { withRetry, type RetryOptions } from './utils/retry.js';
import { withTimeoutAndSignal } from './utils/timeout.js';
import { profile } from './utils/profile.js';
import { setVerbose, debug } from './utils/debug.js';
import { sessionManager } from './utils/session.js';
import { StreamHandler, createMockSSEStream } from './utils/stream-handler.js';
import { dumpContext } from './utils/interactive-debugger.js';
import pc from 'picocolors';
import { createLLMClientFromConfig } from '../llm/client-factory.js';
import { LoopEngine } from '../core/loop-engine.js';
import { createDefaultToolRegistry } from '../tools/index.js';

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

    // config get - 获取单个配置项
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

            // 构建展示用的配置对象（统一由 secrets 模块脱敏）
            const displayConfig: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(config)) {
                if (key === 'apiKey' && !options.showSecrets) {
                    displayConfig[key] = redactApiKey(value as string);
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
    //  session 命令组 - 会话管理
    //  子命令: list, create, delete, switch, show
    // ============================================================
    const sessionCmd = program.command('session').description('会话管理（多对话切换）');

    sessionCmd
        .command('list')
        .description('列出所有会话')
        .option('--json', '以 JSON 格式输出')
        .action((options) => {
            const sessions = sessionManager.list();
            if (options.json) {
                console.log(JSON.stringify(sessions, null, 2));
                return;
            }
            if (sessions.length === 0) {
                console.log('📭 暂无会话，使用 agent chat --session <name> 创建');
                return;
            }
            console.log('');
            console.log('📋 会话列表:');
            for (const s of sessions) {
                const marker = s.id === sessionManager.currentId ? '→' : ' ';
                const preview = s.preview ? ` — ${s.preview}` : '';
                console.log(`  ${marker} ${pc.bold(s.name)} (${s.messageCount} 条, ${s.updatedAt.slice(0, 10)})${preview}`);
            }
            console.log('');
        });

    sessionCmd
        .command('create <name>')
        .description('创建新会话')
        .option('-m, --model <model>', '指定模型')
        .action((name: string, opts) => {
            sessionManager.create(name, opts.model);
        });

    sessionCmd
        .command('delete <name>')
        .description('删除会话')
        .action((name: string) => {
            const sessions = sessionManager.list();
            const found = sessions.find(
                (s: any) => s.name === name || s.id.startsWith(name),
            );
            if (!found) {
                console.log(`❌ 会话 "${name}" 不存在`);
                return;
            }
            sessionManager.delete(found.id);
        });

    sessionCmd
        .command('show <name>')
        .description('查看会话内容')
        .option('--format <fmt>', '输出格式: text/json', 'text')
        .action((name: string, opts) => {
            const sessions = sessionManager.list();
            const found = sessions.find(
                (s: any) => s.name === name || s.id.startsWith(name),
            );
            if (!found) {
                console.log(`❌ 会话 "${name}" 不存在`);
                return;
            }
            if (opts.format === 'json') {
                console.log(sessionManager.exportAsJSON(found.id));
            } else {
                console.log(sessionManager.exportAsText(found.id));
            }
        });

    // ============================================================
    //  ask 命令 - 向 Agent 提问（核心命令）
    //  支持：stdin 管道、上下文文件、流式/非流式输出、系统提示词、会话、调试
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
        .option('--retry <times>', '失败后自动重试次数（默认 0）', parseInt)
        .option('--timeout <ms>', '操作超时时间（毫秒，默认无限制）', parseInt)
        .option('--profile', '输出性能分析耗时信息')
        .option('--session <name>', '使用指定会话（按名称或 ID 匹配）')
        .option('--debug', '显示调试信息（上下文摘要）')
        .action(async (prompt: string, options: {
            model?: string;
            verbose?: boolean;
            context?: string | string[];
            stream?: boolean;
            systemPrompt?: string;
            tokenLimit?: number;
            retry?: number;
            timeout?: number;
            profile?: boolean;
            session?: string;
            debug?: boolean;
        }) => {
            try {
                // ---- 0. 应用 verbose 模式 ----
                if (options.verbose) {
                    setVerbose(true);
                }

                const config = configManager.get();
                const model = options.model || config.model;
                const doProfile = options.profile ?? false;

                // ---- 0.5 会话加载 ----
                let ctx: ContextManager | null = null;
                if (options.session) {
                    // 按名称或 ID 查找会话
                    const sessions = sessionManager.list();
                    const found = sessions.find(
                        (s: any) => s.name === options.session || s.id.startsWith(options.session),
                    );
                    if (found) {
                        const loaded = sessionManager.load(found.id);
                        if (loaded) {
                            ctx = loaded;
                            logger.success(`已加载会话: ${found.name}`);
                        } else {
                            logger.warn(`会话加载失败，创建新会话`);
                            ctx = new ContextManager(options.systemPrompt);
                        }
                    } else {
                        // 创建新会话
                        const newId = sessionManager.create(options.session, model);
                        ctx = new ContextManager(options.systemPrompt);
                        sessionManager.saveContext(newId, ctx);
                    }
                }

                if (!ctx) {
                    ctx = new ContextManager(options.systemPrompt);
                }

                debug('ask 命令启动', {
                    model,
                    verbose: options.verbose ?? false,
                    stream: options.stream ?? true,
                    retry: options.retry ?? 0,
                    timeout: options.timeout,
                    profile: doProfile,
                });

                // ---- 1. 构建系统提示词 ----
                const systemPrompt = options.systemPrompt ?? undefined;

                // ---- 2. 读取 stdin 管道 ----
                const stdinContent = await profile('stdin-read', () => readFromStdin(), doProfile);
                if (stdinContent) {
                    debug('stdin 管道输入已读取', { length: stdinContent.length });
                }

                // ---- 3. 加载上下文文件 ----
                let fileContent = '';
                if (options.context) {
                    const contextPaths = Array.isArray(options.context)
                        ? options.context
                        : [options.context];

                    debug('加载上下文文件', { count: contextPaths.length, paths: contextPaths });

                    fileContent = await profile('file-load', async () => {
                        let content = '';
                        for (const p of contextPaths) {
                            try {
                                const result = loadContextFromFile(p);
                                content += `\n\n## 文件: ${result.path}\n${result.content}`;
                                if (result.truncated) {
                                    logger.warn(`文件 ${p} 过大，已截断至 ~1MB`);
                                }
                            } catch (err) {
                                logger.warn(`加载文件失败: ${(err as Error).message}`);
                            }
                        }
                        return content;
                    }, doProfile);

                    debug('上下文文件加载完成', { totalLength: fileContent.length });
                }

                // ---- 4. 组装完整 prompt ----
                let finalPrompt = prompt;
                if (fileContent) {
                    finalPrompt = `${prompt}\n\n---\n${fileContent}`;
                }
                if (stdinContent) {
                    finalPrompt = `${finalPrompt}\n\n---\n📥 管道输入:\n${stdinContent}`;
                }

                debug('最终 prompt 组装完成', { length: finalPrompt.length });

                // ---- 5. 记录 token 估算（不提前把用户消息加入 ctx，LoopEngine 会自行处理） ----
                if (doProfile) {
                    const ctxStats = ctx.getStats();
                    console.log(`\x1b[36m⏱ [Profile]\x1b[0m context-build: ${ctxStats.estimatedTokens} tokens, ${ctxStats.messageCount} 条消息`);
                }

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
                    if (options.timeout) logger.info(`⏱ 超时时间: ${options.timeout}ms`);
                    logger.blank();
                }

                // ---- 6. 调用 LLM（支持重试 + 超时 + 取消） ----
                const retryTimes = options.retry ?? 0;
                const timeoutMs = options.timeout;
                const doStream = options.stream !== false;

                // 创建 LLM 客户端（自动检测 Provider：DeepSeek / OpenAI / Ollama / Mock）
                const llmClient = await createLLMClientFromConfig(
                    model ? { model } : undefined,
                );

                // 创建工具注册表
                const toolRegistry = createDefaultToolRegistry();

                // 创建 Loop 引擎（含工具调用能力）
                const loopEngine = new LoopEngine(llmClient, toolRegistry, {
                    maxSteps: 10,
                    systemPrompt: systemPrompt,
                    verbose: options.verbose ?? false,
                    contextManager: ctx,
                    injectHistory: true,
                });

                // 实际 LLM 调用（支持 AbortSignal）
                const callLLM = async (signal?: AbortSignal): Promise<string> => {
                    signal?.throwIfAborted();

                    // 使用 LoopEngine 执行 ReAct 循环
                    const answer = await loopEngine.run(finalPrompt);

                    if (doStream) {
                        // 流式展示：把 LoopEngine 的最终回答通过 Mock SSE 流逐字打出
                        const mockResponseObj = createMockSSEStream(answer, 8);
                        const handler = new StreamHandler();

                        console.log(''); // 空行分隔
                        const fullText = await handler.processSSE(mockResponseObj, {
                            onComplete: () => {
                                console.log(''); // 输出完成，换行
                            },
                            onInterrupt: () => {
                                logger.warn('流式输出已中断');
                            },
                        });

                        return fullText;
                    } else {
                        // 非流式：直接返回
                        return answer;
                    }
                };

                /**
                 * 组装调用链：
                 * 1. 最内层：withTimeoutAndSignal（超时 + 取消）
                 * 2. 最外层：withRetry（自动重试）
                 *
                 * 这样超时后 AbortSignal 触发 → 原请求取消 → 不会堆积并发请求
                 */
                const executeCall = async (): Promise<string> => {
                    if (timeoutMs) {
                        return withTimeoutAndSignal(callLLM, timeoutMs);
                    }
                    return callLLM();
                };

                let response: string;
                // ---- LLM 调用（内嵌 profile） ----
                const doLLMCall = async (): Promise<string> => {
                    if (retryTimes > 0) {
                        const retryOpts: RetryOptions = {
                            retries: retryTimes,
                            delay: 1000,
                            onRetry: (err, attempt, wait) => {
                                logger.warn(`⚠ 第 ${attempt} 次重试（${wait}ms 后）: ${err.message}`);
                            },
                        };
                        return withRetry(executeCall, retryOpts);
                    }
                    return executeCall();
                };

                response = await profile('llm-call', doLLMCall, doProfile);

                debug('LLM 调用完成', {
                    responseLength: response.length,
                    model,
                    retryUsed: retryTimes > 0,
                });

                // ---- 6.5 调试模式：打印上下文摘要 ----
                if (options.debug) {
                    dumpContext(ctx);
                }

                // ---- 7. 保存到会话 ----
                if (options.session) {
                    const sessions = sessionManager.list();
                    const found = sessions.find(
                        (s: any) => s.name === options.session || s.id.startsWith(options.session),
                    );
                    if (found) {
                        // 补充记录用户消息和 AI 回复（LoopEngine 内部不操作外部 ctx）
                        ctx.addUserMessage(finalPrompt);
                        ctx.addAssistantMessage(response);
                        sessionManager.saveContext(found.id, ctx);
                    }
                }

                // 非流式且未通过 StreamHandler 输出的，这里输出
                if (!doStream) {
                    console.log(response);
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
        .option('-v, --verbose', '显示详细信息')
        .option('-s, --system-prompt <text>', '自定义系统提示词')
        .option('--no-stream', '禁用流式输出')
        .option('--profile', '输出性能分析耗时信息')
        .option('--session <name>', '使用或创建指定会话')
        .option('--debug', '显示调试信息')
        .action(async (options: {
            model?: string; verbose?: boolean; systemPrompt?: string;
            stream?: boolean; profile?: boolean; session?: string; debug?: boolean;
        }) => {
            const { handleError } = await import('./error-handler.js');

            try {
                // ---- 应用 verbose 模式 ----
                if (options.verbose) {
                    setVerbose(true);
                }

                const config = configManager.get();
                const model = options.model || config.model;

                debug('chat 命令启动', {
                    model,
                    verbose: options.verbose ?? false,
                    stream: options.stream ?? true,
                    profile: options.profile ?? false,
                    systemPrompt: options.systemPrompt ? `${options.systemPrompt.slice(0, 60)}...` : undefined,
                });

                // 非 TTY 环境：打印提示并退出（管道调用、CI 等）
                if (!process.stdin.isTTY) {
                    console.log(`💬 Chat 模式需要交互式终端。`);
                    console.log(`   使用 ask 命令进行非交互式提问：agent ask "你的问题"`);
                    return;
                }

                // 创建对话上下文（支持会话恢复）
                let ctx: ContextManager;
                if (options.session) {
                    const sessions = sessionManager.list();
                    const found = sessions.find(
                        (s: any) => s.name === options.session || s.id.startsWith(options.session),
                    );
                    if (found) {
                        const loaded = sessionManager.load(found.id);
                        if (loaded) {
                            ctx = loaded;
                            logger.success(`已恢复会话: ${found.name}`);
                        } else {
                            ctx = new ContextManager(options.systemPrompt);
                        }
                    } else {
                        const newId = sessionManager.create(options.session, model);
                        ctx = new ContextManager(options.systemPrompt);
                        sessionManager.saveContext(newId, ctx);
                        logger.success(`已创建新会话: ${options.session}`);
                    }
                } else {
                    ctx = new ContextManager(options.systemPrompt);
                }

                console.log(`💬 进入 Chat 模式 (模型: ${model})`);
                console.log(`   会话 ID: ${ctx.sessionId}`);
                console.log('   输入消息开始对话，Tab 补全命令，/exit 退出，/clear 清上下文');
                if (options.systemPrompt) {
                    console.log(`   系统提示: ${options.systemPrompt.slice(0, 60)}...`);
                }
                if (options.session) {
                    console.log(`   会话名称: ${options.session}`);
                }
                console.log('');

                // 创建 readline 实例 + 安装增强补全
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                    prompt: '> ',
                    terminal: true,
                });

                // 安装 Tab 自动补全（增强版）
                setupAutocomplete(rl, enhancedChatCompleter);

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

                    if (line === '/debug') {
                        dumpContext(ctx);
                        rl.prompt();
                        continue;
                    }

                    if (line.startsWith('/session')) {
                        const sessions = sessionManager.list();
                        if (sessions.length === 0) {
                            console.log('📭 暂无保存的会话');
                        } else {
                            console.log('');
                            console.log('  📋 会话列表:');
                            for (const s of sessions) {
                                const marker = s.id === sessionManager.currentId ? pc.cyan('→') : ' ';
                                console.log(`  ${marker} ${s.name} (${s.messageCount} 条消息, ${s.updatedAt.slice(0, 10)})`);
                            }
                            console.log('');
                        }
                        rl.prompt();
                        continue;
                    }

                    // ---- 正常对话 ----
                    const doProfile = options.profile ?? false;
                    const doStream = options.stream !== false;

                    debug('用户输入', {
                        message: line.length > 80 ? line.slice(0, 80) + '…' : line,
                        ctxMessages: ctx.length,
                        ctxTokens: ctx.totalTokens,
                    });

                    // 创建 LLM 客户端 + Loop 引擎
                    const chatLLM = await createLLMClientFromConfig(
                        model ? { model } : undefined,
                    );
                    const chatTools = createDefaultToolRegistry();
                    const chatEngine = new LoopEngine(chatLLM, chatTools, {
                        maxSteps: 10,
                        systemPrompt: options.systemPrompt,
                        verbose: options.verbose ?? false,
                        contextManager: ctx,
                        injectHistory: true,
                    });

                    // 执行 ReAct 循环
                    const answer = await chatEngine.run(line);

                    // 流式输出
                    if (doStream) {
                        const responseObj = createMockSSEStream(answer, 8);
                        const handler = new StreamHandler();

                        console.log(''); // 空行
                        await handler.processSSE(responseObj, {
                            onComplete: () => { console.log(''); },
                        });
                    } else {
                        console.log('');
                        console.log(answer);
                        console.log('');
                    }

                    // 把本轮对话同步到 ctx（供 stats 和会话保存使用）
                    ctx.addUserMessage(line);
                    ctx.addAssistantMessage(answer);

                    // 保存到会话
                    if (options.session) {
                        const sessions = sessionManager.list();
                        const found = sessions.find(
                            (s: any) => s.name === options.session || s.id.startsWith(options.session),
                        );
                        if (found) {
                            sessionManager.saveContext(found.id, ctx);
                        }
                    }

                    debug('LLM 响应', {
                        responseLength: answer.length,
                        ctxMessages: ctx.length + 1,
                    });

                    rl.prompt();
                }

                rl.close();
            } catch (error) {
                handleError(error);
            }
        });

    // ============================================================
    //  隐藏的测试命令: test:error
    // ============================================================
    program
        .command('test:error')
        .description('测试错误处理模块（隐藏命令）')
        .option('--type <type>', '错误类型: user, network, system, config')
        .option('--show-stack', '显示堆栈信息')
        .action(async (options) => {
            // 动态导入错误处理模块（含加载失败保护）
            let userError: (msg: string) => Error;
            let networkError: (msg: string) => Error;
            let systemError: (msg: string) => Error;
            let configError: (msg: string) => Error;
            try {
                const handlers = await import('./error-handler.js');
                userError = handlers.userError;
                networkError = handlers.networkError;
                systemError = handlers.systemError;
                configError = handlers.configError;
            } catch {
                console.log('❌ 错误处理模块加载失败，请检查项目安装是否完整');
                process.exit(1);
            }

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