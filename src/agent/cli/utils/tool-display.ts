/**
 * 工具调用可视化模块
 *
 * 职责：
 * 1. 显示工具调用的开始、参数、结果、错误
 * 2. 支持折叠/展开（简洁/详细模式）
 * 3. 彩色格式化输出
 *
 * 使用方式：
 *   import { ToolDisplay } from './utils/tool-display.js';
 *   const display = new ToolDisplay();
 *   display.start('readFile', { path: 'test.txt' });
 *   display.complete('文件内容...');
 */

import pc from 'picocolors';

export interface ToolCall {
    name: string;
    parameters: Record<string, unknown>;
    result?: unknown;
    error?: Error;
    duration?: number;
    timestamp: number;
}

export interface ToolDisplayOptions {
    /** 是否显示时间戳 */
    showTimestamp?: boolean;
    /** 是否折叠参数（true = 只显示参数摘要） */
    collapseParams?: boolean;
    /** 结果最大显示长度 */
    maxResultLength?: number;
}

const DEFAULT_OPTIONS: Required<ToolDisplayOptions> = {
    showTimestamp: false,
    collapseParams: false,
    maxResultLength: 200,
};

/**
 * 工具调用可视化器
 *
 * 在终端中清晰地展示 Agent 的工具调用过程。
 */
export class ToolDisplay {
    private calls: ToolCall[] = [];
    private verbose: boolean;
    private options: Required<ToolDisplayOptions>;

    constructor(verbose: boolean = false, options: ToolDisplayOptions = {}) {
        this.verbose = verbose;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * 开始工具调用
     *
     * @param name - 工具名称
     * @param parameters - 工具参数
     * @returns 调用 ID（用于后续 complete/fail 调用）
     *
     * @example
     *   const callId = display.start('readFile', { path: 'test.txt' });
     */
    start(name: string, parameters: Record<string, unknown> = {}): number {
        const call: ToolCall = {
            name,
            parameters,
            timestamp: Date.now(),
        };
        this.calls.push(call);
        const id = this.calls.length - 1;

        const indent = '  '.repeat(this.depth);
        console.log(`${indent}${pc.cyan('🔧')} ${pc.bold(name)}`);

        // 显示参数
        if (this.verbose || !this.options.collapseParams) {
            this.renderParams(parameters, indent);
        } else {
            const paramSummary = Object.keys(parameters).length > 0
                ? `(${Object.keys(parameters).join(', ')})`
                : '(无参数)';
            console.log(`${indent}  ${pc.gray(paramSummary)}`);
        }

        return id;
    }

    /**
     * 工具调用成功完成
     *
     * @param result - 调用结果
     * @param callId - 调用 ID（默认最后一个）
     */
    complete(result: unknown, callId?: number): void {
        const id = callId ?? this.calls.length - 1;
        const call = this.calls[id];
        if (!call) return;

        call.result = result;
        call.duration = Date.now() - call.timestamp;

        const indent = '  '.repeat(this.depth);
        const resultStr = this.formatResult(result);

        console.log(`${indent}  ${pc.green('✅')} ${pc.gray('结果:')} ${resultStr}`);
        if (this.verbose) {
            console.log(`${indent}  ${pc.gray(`(${call.duration}ms)`)}`);
        }
    }

    /**
     * 工具调用失败
     *
     * @param error - 错误对象
     * @param callId - 调用 ID（默认最后一个）
     */
    fail(error: Error, callId?: number): void {
        const id = callId ?? this.calls.length - 1;
        const call = this.calls[id];
        if (!call) return;

        call.error = error;
        call.duration = Date.now() - call.timestamp;

        const indent = '  '.repeat(this.depth);
        console.log(`${indent}  ${pc.red('❌')} ${pc.gray('错误:')} ${error.message}`);
    }

    /**
     * 渲染参数
     */
    private renderParams(params: Record<string, unknown>, indent: string): void {
        const entries = Object.entries(params);
        if (entries.length === 0) {
            console.log(`${indent}  ${pc.gray('(无参数)')}`);
            return;
        }

        for (const [key, value] of entries) {
            const formatted = typeof value === 'string'
                ? `"${value.length > 80 ? value.slice(0, 80) + '…' : value}"`
                : JSON.stringify(value);
            console.log(`${indent}  ${pc.yellow(key)}: ${formatted}`);
        }
    }

    /**
     * 格式化结果
     */
    private formatResult(result: unknown): string {
        if (result === undefined || result === null) {
            return pc.gray('(无返回值)');
        }

        const str = typeof result === 'string'
            ? result
            : JSON.stringify(result);

        const maxLen = this.options.maxResultLength;
        if (str.length > maxLen) {
            return str.slice(0, maxLen) + pc.gray(`… (+${str.length - maxLen} 字符)`);
        }

        return str;
    }

    /** 当前嵌套深度（用于未来支持嵌套工具调用） */
    private get depth(): number {
        return 0;
    }

    /** 清空调用记录 */
    clear(): void {
        this.calls = [];
    }

    /** 获取所有调用记录 */
    getCalls(): ToolCall[] {
        return [...this.calls];
    }

    /** 获取统计信息 */
    getStats(): { total: number; success: number; failed: number; totalDuration: number } {
        let success = 0;
        let failed = 0;
        let totalDuration = 0;

        for (const call of this.calls) {
            if (call.error) failed++;
            else success++;
            if (call.duration) totalDuration += call.duration;
        }

        return { total: this.calls.length, success, failed, totalDuration };
    }
}

// ============================================================
//  便利函数
// ============================================================

/**
 * 格式化工具调用列表（用于调试模式或总结）
 */
export function formatToolCallSummary(calls: ToolCall[]): string {
    if (calls.length === 0) return '(无工具调用)';

    const lines = calls.map((call, i) => {
        const status = call.error ? pc.red('✗') : pc.green('✓');
        const duration = call.duration ? ` ${call.duration}ms` : '';
        const name = pc.bold(call.name);
        const resultPreview = call.error
            ? pc.red(call.error.message)
            : String(call.result ?? '').slice(0, 50);
        return `  ${i + 1}. ${status} ${name}${duration} — ${resultPreview}`;
    });

    return lines.join('\n');
}

/**
 * 从 SSE chunk 中解析工具调用信息
 *
 * 兼容 OpenAI 的 tool_calls delta 格式。
 */
export function parseToolCallFromChunk(chunk: { raw?: any }): {
    name?: string;
    arguments?: string;
    id?: string;
    index?: number;
} | null {
    const raw = chunk.raw;
    if (!raw?.choices?.[0]?.delta?.tool_calls) return null;

    const toolCall = raw.choices[0].delta.tool_calls[0];
    if (!toolCall) return null;

    return {
        id: toolCall.id,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments,
        index: toolCall.index,
    };
}
