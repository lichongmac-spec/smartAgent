/**
 * 流式输出处理器
 *
 * 职责：
 * 1. 封装 SSEStreamParser，提供高层流式处理 API
 * 2. 支持 AbortController 中断（Ctrl+C）
 * 3. 支持打字机效果输出
 * 4. 统一错误处理
 *
 * 使用方式：
 *   import { StreamHandler } from './utils/stream-handler.js';
 *   const handler = new StreamHandler();
 *   const text = await handler.processSSE(response, { onToken: ... });
 */

import { SSEStreamParser, type SSEChunk } from '../context-aware.js';
import { logger } from '../logger.js';

export interface StreamHandlerOptions {
    /** 打字机效果每字符延迟（毫秒），0 = 无延迟直接输出 */
    charDelay?: number;
    /** 是否启用缓冲输出（减少 stdout 调用次数） */
    buffered?: boolean;
    /** 缓冲大小（字符数，buffered=true 时生效） */
    bufferSize?: number;
}

export interface StreamProcessOptions {
    /** 每个 token 的回调 */
    onToken?: (token: string, fullText: string) => void;
    /** 完成回调 */
    onComplete?: (fullText: string) => void;
    /** 错误回调 */
    onError?: (error: Error) => void;
    /** 中断回调 */
    onInterrupt?: () => void;
}

/**
 * 流式输出处理器类
 *
 * 封装 SSE 流式响应的完整处理流程，支持中断和打字机效果。
 */
export class StreamHandler {
    private abortController: AbortController | null = null;
    private isInterrupted = false;

    /**
     * 处理 SSE 流式响应（完整封装）
     *
     * @param response - fetch Response 对象（body 必须是 ReadableStream）
     * @param options - 流处理选项
     * @returns 完整的回复文本
     *
     * @example
     *   const response = await fetch(apiUrl, { signal });
     *   const handler = new StreamHandler();
     *   const text = await handler.processSSE(response, {
     *     onToken: (token) => process.stdout.write(token),
     *     onComplete: (full) => console.log('\n完成'),
     *   });
     */
    async processSSE(
        response: Response,
        options: StreamProcessOptions = {},
    ): Promise<string> {
        this.abortController = new AbortController();
        this.isInterrupted = false;
        let fullText = '';

        // 监听 Ctrl+C
        const sigintHandler = () => {
            this.isInterrupted = true;
            this.abortController?.abort();
            console.log('\n\x1b[90m🛑 流式输出已中断\x1b[0m');
            options.onInterrupt?.();
        };
        process.once('SIGINT', sigintHandler);

        try {
            const body = response.body;
            if (!body) {
                throw new Error('Response body 为空，无法解析 SSE 流');
            }

            const parser = new SSEStreamParser(body);

            for await (const chunk of parser) {
                if (this.isInterrupted) break;
                if (chunk.done) break;

                fullText += chunk.delta;
                options.onToken?.(chunk.delta, fullText);
            }

            options.onComplete?.(fullText);
            return fullText;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                // 用户主动中断，不视为错误
                return fullText;
            }
            const err = error instanceof Error ? error : new Error(String(error));
            options.onError?.(err);
            throw err;
        } finally {
            process.removeListener('SIGINT', sigintHandler);
            this.abortController = null;
        }
    }

    /**
     * 打字机效果输出（用于非 SSE 场景或回放）
     *
     * @param text - 要输出的文本
     * @param delay - 每字符延迟（毫秒）
     * @param onChar - 每字符回调
     *
     * @example
     *   await handler.typewriter(fullText, 20);
     */
    async typewriter(
        text: string,
        delay: number = 30,
        onChar?: (char: string, index: number) => void,
    ): Promise<void> {
        if (delay <= 0) {
            process.stdout.write(text);
            return;
        }

        this.abortController = new AbortController();
        this.isInterrupted = false;

        const sigintHandler = () => {
            this.isInterrupted = true;
            this.abortController?.abort();
            console.log('\n\x1b[90m🛑 输出已中断\x1b[0m');
        };
        process.once('SIGINT', sigintHandler);

        try {
            for (let i = 0; i < text.length; i++) {
                if (this.isInterrupted) break;
                if (this.abortController?.signal.aborted) break;

                const char = text[i];
                process.stdout.write(char);
                onChar?.(char, i);

                if (delay > 0) {
                    await new Promise<void>((resolve) => {
                        const onAbort = () => clearTimeout(timeout);
                        const timeout = setTimeout(() => {
                            this.abortController?.signal.removeEventListener('abort', onAbort);
                            resolve();
                        }, delay);
                        if (this.abortController) {
                            this.abortController.signal.addEventListener('abort', onAbort, { once: true });
                        }
                    });
                }
            }
        } finally {
            process.removeListener('SIGINT', sigintHandler);
            this.abortController = null;
        }
    }

    /**
     * 中断当前流式输出
     */
    interrupt(): void {
        this.isInterrupted = true;
        this.abortController?.abort();
    }

    /**
     * 是否已被中断
     */
    get interrupted(): boolean {
        return this.isInterrupted;
    }
}

// ============================================================
//  便利函数（直接使用，无需实例化）
// ============================================================

/**
 * 处理 SSE 响应并实时输出到终端
 *
 * 结合了 SSEStreamParser 和实时 stdout 输出，适用于 ask/chat 命令。
 *
 * @param response - fetch Response 对象
 * @param options - 输出选项
 * @returns 完整回复文本
 *
 * @example
 *   const response = await fetch(apiUrl, { method: 'POST', body: ... });
 *   const text = await streamToStdout(response, { buffered: true });
 */
export async function streamToStdout(
    response: Response,
    options: {
        buffered?: boolean;
        bufferSize?: number;
        charDelay?: number;
        signal?: AbortSignal;
    } = {},
): Promise<string> {
    const { buffered = true, bufferSize = 4, charDelay = 0 } = options;
    let fullText = '';
    let buffer = '';

    const handler = new StreamHandler();

    // 如果外部传入了 signal，监听 abort
    if (options.signal) {
        const onExternalAbort = () => handler.interrupt();
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const onToken = (token: string) => {
        if (charDelay > 0) return; // 由 typewriter 处理

        if (buffered) {
            buffer += token;
            if (buffer.length >= bufferSize) {
                process.stdout.write(buffer);
                buffer = '';
            }
        } else {
            process.stdout.write(token);
        }
    };

    const onComplete = () => {
        // 刷新剩余缓冲
        if (buffer.length > 0) {
            process.stdout.write(buffer);
            buffer = '';
        }
    };

    fullText = await handler.processSSE(response, { onToken, onComplete });

    return fullText;
}

/**
 * 模拟 SSE 流（用于测试或 Mock）
 *
 * 将普通文本包装成 SSE 风格的 fetch Response，便于测试流式处理逻辑。
 *
 * @param text - 要模拟的回复文本
 * @param delay - 每个 chunk 的延迟（毫秒）
 * @returns 模拟的 fetch Response 对象
 *
 * @example
 *   const mockResponse = createMockSSEStream('Hello World', 10);
 *   const text = await streamToStdout(mockResponse);
 */
export function createMockSSEStream(
    text: string,
    delay: number = 20,
): Response {
    // 创建一个 ReadableStream，逐个字符推送
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder();

            for (const char of text) {
                // SSE 格式：data: {...}\n\n
                const chunk = {
                    id: 'chatcmpl-mock',
                    choices: [{ delta: { content: char }, index: 0 }],
                };
                const sseData = `data: ${JSON.stringify(chunk)}\n\n`;
                controller.enqueue(encoder.encode(sseData));
                await new Promise<void>((resolve) => setTimeout(resolve, delay));
            }

            // 结束信号
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
        },
    });

    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
