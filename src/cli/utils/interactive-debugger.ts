/**
 * 交互式调试器模块
 *
 * 职责：
 * 1. 显示 Agent 内部状态
 * 2. 单步执行（n/next）
 * 3. 查看内存/工具调用历史
 * 4. 设置断点（未来）
 *
 * 使用方式：
 *   import { InteractiveDebugger } from './utils/interactive-debugger.js';
 *   const dbg = new InteractiveDebugger(ctx);
 *   await dbg.start();
 */

import { ContextManager, type Message } from '../context-aware.js';
import { ToolDisplay, type ToolCall } from './tool-display.js';
import { logger } from '../logger.js';
import { createInterface, type Interface } from 'readline';
import pc from 'picocolors';

export interface DebuggerState {
    ctx: ContextManager;
    toolDisplay: ToolDisplay;
    calls: ToolCall[];
    step: number;
    maxSteps: number;
    breakpoints: Set<number>;
    isPaused: boolean;
}

export class InteractiveDebugger {
    private state: DebuggerState | null = null;
    private rl: Interface | null = null;
    private isRunning = false;

    /**
     * 启动交互式调试模式
     *
     * @param ctx - 要调试的 ContextManager 实例
     * @param options - 调试选项
     *
     * @example
     *   const dbg = new InteractiveDebugger();
     *   await dbg.start(ctx);
     */
    async start(
        ctx: ContextManager,
        options: { maxSteps?: number } = {},
    ): Promise<void> {
        this.state = {
            ctx,
            toolDisplay: new ToolDisplay(true),
            calls: [],
            step: 0,
            maxSteps: options.maxSteps ?? 100,
            breakpoints: new Set(),
            isPaused: false,
        };
        this.isRunning = true;

        console.log('');
        logger.info(`${pc.bgYellow(pc.black(' 🐞 DEBUG MODE '))}`);
        console.log(`  ${pc.gray('命令:')} ${pc.cyan('n')}(下一步)  ${pc.cyan('c')}(继续)  ${pc.cyan('s')}(状态)  ${pc.cyan('m')}(内存)  ${pc.cyan('t')}(工具)  ${pc.cyan('q')}(退出)`);
        console.log('');

        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `${pc.yellow('🐞')} > `,
        });

        // 设置终端为 raw mode 以支持单字符输入（可选）
        this.rl.prompt();

        // 使用 for-await 监听输入
        try {
            for await (const line of this.rl) {
                const trimmed = line.trim();
                if (!trimmed) { this.rl.prompt(); continue; }
                const parts = trimmed.split(/\s+/);
                const command = parts[0].toLowerCase();
                const args = parts.slice(1);
                const handled = await this.handleCommand(command, args);
                if (!handled) break; // 退出
                if (this.isRunning) this.rl.prompt();
            }
        } finally {
            this.rl.close();
        }
    }

    /**
     * 处理调试命令
     *
     * @returns true = 继续循环, false = 退出
     */
    private async handleCommand(command: string, args: string[]): Promise<boolean> {
        if (!this.state) return false;

        switch (command) {
            case 'n':
            case 'next':
                this.stepForward();
                return true;

            case 'c':
            case 'continue':
                logger.info('继续执行...');
                this.isRunning = false;
                return false;

            case 's':
            case 'status':
                this.showStatus();
                return true;

            case 'm':
            case 'memory':
                this.showMemory();
                return true;

            case 't':
            case 'tools':
                this.showToolCalls();
                return true;

            case 'b':
            case 'breakpoint': {
                if (args.length > 0) {
                    const bp = parseInt(args[0], 10);
                    if (!isNaN(bp)) {
                        this.state.breakpoints.add(bp);
                        logger.success(`已在步骤 ${bp} 设置断点`);
                    } else {
                        logger.warn(`无效的步骤号: ${args[0]}`);
                    }
                } else {
                    const bps = [...this.state.breakpoints].join(', ') || '(无)';
                    logger.info(`当前断点: ${bps}`);
                }
                return true;
            }

            case 'q':
            case 'quit':
            case 'exit':
                logger.info('调试模式已退出');
                this.isRunning = false;
                return false;

            default:
                logger.warn(`未知命令: ${command}`);
                logger.info(`可用: ${pc.cyan('n')} ${pc.cyan('c')} ${pc.cyan('s')} ${pc.cyan('m')} ${pc.cyan('t')} ${pc.cyan('q')}`);
                return true;
        }
    }

    /**
     * 前进一步
     */
    private stepForward(): void {
        if (!this.state) return;
        this.state.step++;
        logger.info(`${pc.cyan(`🔄 Step ${this.state.step}/${this.state.maxSteps}`)}`);

        // 显示当前上下文摘要
        const stats = this.state.ctx.getStats();
        console.log(`  ${pc.gray(`消息: ${stats.messageCount}, tokens: ~${stats.estimatedTokens}`)}`);
        console.log('');
    }

    /**
     * 显示状态
     */
    private showStatus(): void {
        if (!this.state) return;
        const stats = this.state.ctx.getStats();

        console.log('');
        console.log(`${pc.bold('📊 调试状态')}`);
        console.log(`${pc.gray('─'.repeat(40))}`);
        console.log(`  步骤: ${this.state.step}/${this.state.maxSteps}`);
        console.log(`  消息数: ${stats.messageCount}`);
        console.log(`  估算 tokens: ${stats.estimatedTokens}`);
        console.log(`  总字符数: ${stats.totalChars}`);
        console.log(`  会话 ID: ${this.state.ctx.sessionId}`);
        console.log(`  断点: ${[...this.state.breakpoints].join(', ') || '(无)'}`);
        console.log('');
    }

    /**
     * 显示内存（消息列表）
     */
    private showMemory(): void {
        if (!this.state) return;
        const messages = this.state.ctx.getMessages();

        console.log('');
        console.log(`${pc.bold(`🧠 内存 (${messages.length} 条消息)`)}`);
        console.log(`${pc.gray('─'.repeat(40))}`);

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const roleColor = msg.role === 'system'
                ? pc.gray
                : msg.role === 'user'
                    ? pc.blue
                    : msg.role === 'assistant'
                        ? pc.green
                        : pc.yellow;

            const contentPreview = msg.content.length > 80
                ? msg.content.slice(0, 80) + '…'
                : msg.content;

            console.log(`  ${pc.gray(`[${i}]`)} ${roleColor(msg.role)} ${pc.gray('|')} ${contentPreview}`);
        }
        console.log('');
    }

    /**
     * 显示工具调用历史
     */
    private showToolCalls(): void {
        if (!this.state) return;

        console.log('');
        console.log(`${pc.bold(`🔧 工具调用 (${this.state.calls.length} 次)`)}`);
        console.log(`${pc.gray('─'.repeat(40))}`);

        if (this.state.calls.length === 0) {
            console.log(`  ${pc.gray('(无工具调用)')}`);
        } else {
            for (const call of this.state.calls) {
                const status = call.error ? pc.red('✗ FAIL') : pc.green('✓ OK');
                const duration = call.duration ? ` ${call.duration}ms` : '';
                console.log(`  ${status} ${pc.bold(call.name)}${duration}`);
                if (call.error) {
                    console.log(`    ${pc.red(call.error.message)}`);
                }
            }
        }
        console.log('');
    }

    /**
     * 记录工具调用（由外部调用）
     */
    recordToolCall(call: ToolCall): void {
        if (!this.state) return;
        this.state.calls.push(call);
    }

    /**
     * 停止调试模式
     */
    stop(): void {
        this.isRunning = false;
        this.rl?.close();
        logger.info('调试模式已退出');
    }
}

// ============================================================
//  非交互式调试工具函数
// ============================================================

/**
 * 打印上下文摘要（用于 --debug 标志）
 *
 * @param ctx - ContextManager 实例
 *
 * @example
 *   if (options.debug) dumpContext(ctx);
 */
export function dumpContext(ctx: ContextManager): void {
    const stats = ctx.getStats();
    const messages = ctx.getMessages();

    console.log('');
    console.log(`${pc.bold('🔍 上下文摘要')}`);
    console.log(`${pc.gray('─'.repeat(50))}`);
    console.log(`会话 ID: ${ctx.sessionId}`);
    console.log(`消息数: ${stats.messageCount}`);
    console.log(`估算 tokens: ${stats.estimatedTokens}`);
    console.log('');

    console.log(`${pc.bold('消息列表:')}`);
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const preview = msg.content.length > 60
            ? msg.content.slice(0, 60) + '…'
            : msg.content;
        const roleTag = msg.role === 'system' ? pc.gray('[S]')
            : msg.role === 'user' ? pc.blue('[U]')
                : msg.role === 'assistant' ? pc.green('[A]')
                    : pc.yellow(`[${msg.role.slice(0, 1).toUpperCase()}]`);
        console.log(`  ${roleTag} ${preview}`);
    }
    console.log('');
}

/**
 * 打印工具调用摘要
 */
export function dumpToolCalls(calls: ToolCall[]): void {
    if (calls.length === 0) return;

    console.log('');
    console.log(`${pc.bold('🔧 工具调用记录')}`);
    console.log(`${pc.gray('─'.repeat(50))}`);

    const stats = {
        total: calls.length,
        success: calls.filter((c) => !c.error).length,
        failed: calls.filter((c) => c.error).length,
        totalDuration: calls.reduce((sum, c) => sum + (c.duration ?? 0), 0),
    };

    for (const call of calls) {
        const status = call.error ? pc.red('✗') : pc.green('✓');
        const duration = call.duration ? ` (${call.duration}ms)` : '';
        console.log(`  ${status} ${pc.bold(call.name)}${duration}`);
    }

    console.log('');
    console.log(`  ${pc.gray(`总计: ${stats.total}, 成功: ${stats.success}, 失败: ${stats.failed}, 总耗时: ${stats.totalDuration}ms`)}`);
    console.log('');
}
