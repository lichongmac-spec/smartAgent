/**
 * 上下文与交互模块
 *
 * 职责：
 * 1. ContextManager — 从 context/ 模块统一导入（唯一实现）
 * 2. 流式输出 — 模拟打字机效果 + SSE 事件解析器（为真实 LLM 对接预留）
 * 3. stdin 管道输入 — 支持 cat file | agent ask "…" 组合调用
 * 4. 文件上下文加载 — --context <file> 将文件内容注入 prompt
 *
 * 使用方式：
 *   import { ContextManager, readFromStdin, printStream, loadContextFromFile } from './context-aware.js';
 *
 *   const ctx = new ContextManager('你是一个有帮助的助手');
 *   ctx.addUserMessage('你好');
 *   ctx.addAssistantMessage('你好！有什么可以帮你的？');
 *
 *   const stdin = await readFromStdin();
 *   const fileContent = loadContextFromFile('./notes.md');
 */

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { resolve } from 'path';

// ============================================================
//  Re-export ContextManager（唯一实现，来自 context/ 模块）
// ============================================================

export { ContextManager } from '../context/context-manager.js';
export type { Message, MessageRole, ContextStats } from '../context/types.js';

// ============================================================
//  类型定义（CLI 特有）
// ============================================================

/** readFromStdin 选项 */
export interface StdinOptions {
    /** 超时时间（毫秒），默认 5000 */
    timeout?: number;
    /** 最大读取字节数，默认 1MB */
    maxBytes?: number;
}

/** 文件上下文加载结果 */
export interface FileContextResult {
    /** 文件路径 */
    path: string;
    /** 文件大小（字节） */
    size: number;
    /** 内容 */
    content: string;
    /** 是否被截断 */
    truncated: boolean;
}

/** 文件上下文加载选项 */
export interface FileContextOptions {
    /** 最大文件大小（字节），默认 1MB */
    maxSize?: number;
    /** 截断后是否在末尾添加提示 */
    truncationHint?: boolean;
}

// ============================================================
//  1. 流式输出
// ============================================================

/**
 * 模拟流式输出（打字机效果）
 *
 * 注意：这是占位实现，仅用于演示和测试。
 * 接入真实 LLM 后应替换为 SSE ReadableStream 解析。
 *
 * @param text   要逐字输出的文本
 * @param delay  每字延迟（毫秒），默认 30
 */
export async function* streamResponse(
    text: string,
    delay = 30,
): AsyncGenerator<string> {
    for (const char of text) {
        await new Promise(resolve => setTimeout(resolve, delay));
        yield char;
    }
}

/**
 * 打印流式输出
 *
 * @param stream    异步字符生成器
 * @param options   可选配置
 * @returns 完整的输出文本
 */
export async function printStream(
    stream: AsyncGenerator<string>,
    options: {
        /** 是否缓冲输出（批量写入，性能更好），默认 false */
        buffered?: boolean;
        /** 缓冲大小（字符数），默认 8 */
        bufferSize?: number;
    } = {},
): Promise<string> {
    const { buffered = false, bufferSize = 8 } = options;
    let fullText = '';
    let buffer = '';

    for await (const char of stream) {
        fullText += char;

        if (buffered) {
            buffer += char;
            if (buffer.length >= bufferSize) {
                process.stdout.write(buffer);
                buffer = '';
            }
        } else {
            process.stdout.write(char);
        }
    }

    // 刷新剩余缓冲
    if (buffer.length > 0) {
        process.stdout.write(buffer);
    }

    process.stdout.write('\n');
    return fullText;
}

// ============================================================
//  2. SSE 流解析器（为真实 LLM 对接预留）
// ============================================================

/** SSE 事件块 */
export interface SSEChunk {
    /** 增量内容 */
    delta: string;
    /** 本次选择 */
    index: number;
    /** 是否结束 */
    done: boolean;
    /** 原始 JSON 数据 */
    raw?: unknown;
}

/**
 * 从 fetch 的 ReadableStream 中解析 SSE 事件
 *
 * 标准 SSE 格式：
 *   data: {"choices":[{"delta":{"content":"你好"}}]}\n\n
 *   data: [DONE]\n\n
 *
 * 用法（接入真实 LLM 时）：
 *   const response = await fetch(url, { body: ..., headers: ... });
 *   const parser = new SSEStreamParser(response.body!);
 *   for await (const chunk of parser) {
 *     if (chunk.done) break;
 *     process.stdout.write(chunk.delta);
 *   }
 */
export class SSEStreamParser {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private buffer = '';
    private decoder = new TextDecoder();

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
    }

    async *parse(): AsyncGenerator<SSEChunk> {
        try {
            while (true) {
                const { done, value } = await this.reader.read();
                if (done) break;

                this.buffer += this.decoder.decode(value, { stream: true });

                // 按 \n\n 分割事件
                const events = this.buffer.split('\n\n');
                // 最后一个可能不完整，保留到下次
                this.buffer = events.pop() ?? '';

                for (const event of events) {
                    const chunk = this.parseEvent(event);
                    if (chunk) yield chunk;
                    if (chunk?.done) return;
                }
            }

            // 处理最后残片
            if (this.buffer.trim()) {
                const chunk = this.parseEvent(this.buffer);
                if (chunk) yield chunk;
            }
        } finally {
            this.reader.releaseLock();
        }
    }

    private parseEvent(event: string): SSEChunk | null {
        const lines = event.split('\n');
        const dataLines = lines
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim());

        if (dataLines.length === 0) return null;

        // 合并多行 data
        const dataStr = dataLines.join('');

        // [DONE] 信号
        if (dataStr === '[DONE]') {
            return { delta: '', index: 0, done: true };
        }

        try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed?.choices?.[0];

            if (!choice) return null;

            const delta = choice.delta?.content ?? '';
            return {
                delta,
                index: choice.index ?? 0,
                done: choice.finish_reason != null || delta.length === 0,
                raw: parsed,
            };
        } catch {
            // 非 JSON 行（如注释），安全跳过
            return null;
        }
    }

    /** 便利方法：直接迭代使用 */
    [Symbol.asyncIterator](): AsyncIterator<SSEChunk> {
        return this.parse();
    }
}

// ============================================================
//  3. 管道输入（stdin）
// ============================================================

/**
 * 从stdin 读取管道输入
 *
 * 用法：
 *   const content = await readFromStdin();
 *   if (content) console.log('检测到管道输入');
 *
 * @param options 可选配置（超时、大小限制）
 */
export async function readFromStdin(options: StdinOptions = {}): Promise<string> {
    const { timeout = 5000, maxBytes = 1024 * 1024 } = options;

    // 交互式终端：stdin 是 TTY，没有管道数据
    if (process.stdin.isTTY) {
        return '';
    }

    return new Promise((resolve) => {
        let data = '';
        let resolved = false;
        let timer: ReturnType<typeof setTimeout>;

        const cleanup = (): void => {
            clearTimeout(timer);
            process.stdin.removeAllListeners('data');
            process.stdin.removeAllListeners('end');
            process.stdin.removeAllListeners('error');
        };

        const finish = (result: string) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(result);
        };

        // 超时保护
        timer = setTimeout(() => {
            finish(data.trim());
        }, timeout);

        process.stdin.on('data', (chunk: Buffer) => {
            data += chunk.toString();

            // 超过大小限制时截断并结束
            if (data.length > maxBytes) {
                data = data.slice(0, maxBytes);
                finish(data.trim());
            }
        });

        process.stdin.on('end', () => {
            finish(data.trim());
        });

        process.stdin.on('error', () => {
            finish(data.trim()); // 出错时返回已读取部分
        });

        // 如果 stdin 已经结束（数据已在缓冲区），立即读取
        // Node.js 中 pause() 过的 stream 不会触发 'data'
        if (typeof (process.stdin as any).read === 'function') {
            process.stdin.resume();
        }
    });
}

/** 检查 stdin 是否有管道数据（同步版本，用于快速判断） */
export function hasPipeInput(): boolean {
    return !process.stdin.isTTY;
}

// ============================================================
//  4. 文件上下文加载
// ============================================================

/**
 * 从文件加载上下文内容
 *
 * 支持：纯文本、Markdown、JSON、代码文件等。
 * 不支持二进制文件（会被检测并拒绝）。
 *
 * @param filePath 文件路径（相对或绝对）
 * @param options  加载选项
 * @returns 加载结果，失败时抛出异常
 */
export function loadContextFromFile(
    filePath: string,
    options: FileContextOptions = {},
): FileContextResult {
    const { maxSize = 1024 * 1024, truncationHint = true } = options;

    const resolved = resolve(filePath);

    if (!existsSync(resolved)) {
        throw new Error(`文件不存在: ${resolved}`);
    }

    const stat = statSync(resolved);
    if (!stat.isFile()) {
        throw new Error(`路径不是文件: ${resolved}`);
    }

    if (stat.size === 0) {
        return { path: resolved, size: 0, content: '', truncated: false };
    }

    // 超大文件拒绝加载（避免 OOM），默认限 128MB
    const MAX_FILE_BYTES = 128 * 1024 * 1024;
    if (stat.size > MAX_FILE_BYTES) {
        throw new Error(
            `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，拒绝加载。` +
            `请使用 head -c ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}M 截取文件内容。`,
        );
    }

    // 只读前 512 字节检测二进制（避免 readFileSync 加载整个超大文件）
    const probeFd = openSync(resolved, 'r');
    const probeBuf = Buffer.allocUnsafe(Math.min(512, stat.size));
    readSync(probeFd, probeBuf, 0, probeBuf.length, 0);
    closeSync(probeFd);
    const probe = new Uint8Array(probeBuf);
    let nullCount = 0;
    for (const byte of probe) {
        if (byte === 0) nullCount++;
    }
    if (nullCount > 0) {
        throw new Error(`不支持二进制文件: ${resolved}`);
    }

    // 读取内容
    let content: string;
    try {
        content = readFileSync(resolved, 'utf-8');
    } catch (err) {
        throw new Error(`读取文件失败: ${resolved} (${(err as Error).message})`);
    }

    let truncated = false;
    let finalSize = content.length;

    if (content.length > maxSize) {
        content = content.slice(0, maxSize);
        finalSize = maxSize;
        truncated = true;
    }

    if (truncated && truncationHint) {
        const hint = `\n\n⚠️ [文件过大，仅加载前 ${(maxSize / 1024 / 1024).toFixed(1)}MB]`;
        content += hint;
    }

    return {
        path: resolved,
        size: finalSize,
        content,
        truncated,
    };
}

/**
 * 加载多个上下文文件并拼接
 *
 * @param paths  文件路径列表
 * @param options  加载选项
 * @returns 结果数组 + 合并后的总内容
 */
export function loadMultipleContexts(
    paths: string[],
    options: FileContextOptions = {},
): { results: FileContextResult[]; combinedContent: string } {
    const results: FileContextResult[] = [];
    const errors: string[] = [];

    for (const p of paths) {
        try {
            results.push(loadContextFromFile(p, options));
        } catch (err) {
            errors.push((err as Error).message);
        }
    }

    const parts: string[] = [];
    for (const r of results) {
        // 每个文件用一个分隔头包裹
        const label = r.path.split('/').pop() ?? r.path;
        parts.push(`## ${label}\n\n${r.content}`);
    }

    let combinedContent = parts.join('\n\n---\n\n');

    // 错误文件提示
    if (errors.length > 0) {
        combinedContent += `\n\n---\n⚠️ 以下文件加载失败:\n${errors.map(e => `- ${e}`).join('\n')}`;
    }

    return { results, combinedContent };
}
