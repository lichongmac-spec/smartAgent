"use strict";
/**
 * ollama-client.ts - 本地 AI 模型客户端
 *
 * 理解：这就像"小区门口的小饭馆"——不用排队（不用 API Key），想用就用。
 *
 * 前提条件：电脑上要安装并启动 Ollama
 *   brew install ollama
 *   ollama serve
 *   ollama pull qwen2.5:7b
 *
 * 使用方式：
 *   import { OllamaClient } from './ollama-client.js';
 *   const client = new OllamaClient({ model: 'qwen2.5:7b' });
 *   const resp = await client.chat([{ role: 'user', content: '你好' }]);
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaClient = void 0;
const logger_js_1 = require("./logger.js");
const errors_js_1 = require("./errors.js");
const retry_js_1 = require("./retry.js");
/** Ollama 默认服务地址 */
const DEFAULT_HOST = 'http://localhost:11434';
/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT = 60000;
/**
 * Ollama 客户端
 *
 * 理解：这个类就是"小饭馆的服务员"——你告诉它你想吃什么（发消息），
 * 它帮你跟后厨（本地模型）沟通。
 */
class OllamaClient {
    host;
    model;
    timeout;
    /**
     * 创建 Ollama 客户端实例
     *
     * @param config.host - Ollama 服务地址
     * @param config.model - 模型名
     * @param config.timeout - 默认请求超时（毫秒），默认 60s
     */
    constructor(config = {}) {
        this.host = config.host ?? DEFAULT_HOST;
        this.model = config.model ?? 'qwen2.5:7b';
        this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
        (0, logger_js_1.info)(`📡 Ollama 客户端初始化: ${this.host}, 模型: ${this.model}`);
    }
    /** @inheritdoc */
    async healthCheck() {
        try {
            const response = await fetch(`${this.host}/api/tags`, {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /** @inheritdoc */
    async listModels() {
        try {
            const response = await fetch(`${this.host}/api/tags`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok)
                return [];
            const data = (await response.json());
            return (data.models ?? []).map((m) => m.name);
        }
        catch {
            return [];
        }
    }
    /** @inheritdoc */
    async embed(text) {
        (0, logger_js_1.debug)(`📤 Ollama embed 请求: ${text.slice(0, 50)}...`);
        try {
            const response = await fetch(`${this.host}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: this.model, prompt: text }),
                signal: AbortSignal.timeout(this.timeout),
            });
            if (!response.ok) {
                throw new errors_js_1.LLMError(`Ollama embed 失败 (${response.status})`, 'OLLAMA_EMBED_ERROR', response.status >= 500);
            }
            const data = (await response.json());
            return data.embedding ?? [];
        }
        catch (err) {
            if (err instanceof errors_js_1.LLMError)
                throw err;
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw new errors_js_1.NetworkError(`Ollama embed 请求超时 (${this.timeout}ms)`);
            }
            throw new errors_js_1.LLMError(`Ollama embed 失败: ${err.message}`, 'OLLAMA_EMBED_ERROR', true);
        }
    }
    /**
     * 聊天（非流式）—— 一次返回完整回答
     *
     * 支持 options.timeout 独立超时、options.retry 重试
     */
    async chat(messages, options = {}) {
        return (0, retry_js_1.withOptionalRetry)(() => this._chatImpl(messages, options), options.retry);
    }
    /**
     * 聊天（流式）—— 逐字返回，实现"打字机效果"
     *
     * 注意：流式模式不支持重试（无法恢复已输出的 Token）
     */
    async *chatStream(messages, options = {}) {
        const model = options.model ?? this.model;
        const timeout = options.timeout ?? this.timeout;
        (0, logger_js_1.debug)(`📤 Ollama 流式请求: ${model}`);
        const body = {
            model,
            messages: this.buildMessages(messages, options.systemPrompt),
            stream: true,
            options: {
                temperature: options.temperature ?? 0.7,
                num_predict: options.maxTokens,
                num_gpu: 1,
                main_gpu: 0,
            },
        };
        // 工具支持
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools;
        }
        let response;
        try {
            response = await fetch(`${this.host}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeout),
            });
        }
        catch (err) {
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw new errors_js_1.NetworkError(`Ollama 流式请求超时 (${timeout}ms)`);
            }
            throw new errors_js_1.LLMError(`Ollama 流式连接失败: ${err.message}`, 'OLLAMA_STREAM_CONNECTION', true);
        }
        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 404) {
                throw new errors_js_1.ModelUnavailableError(`模型 "${model}" 未找到，请先运行: ollama pull ${model}`);
            }
            if (response.status === 429) {
                throw new errors_js_1.RateLimitError('Ollama 流式请求过于频繁');
            }
            throw new errors_js_1.LLMError(`Ollama 流式错误 (${response.status}): ${errorText}`, 'OLLAMA_STREAM_ERROR', response.status >= 500);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        try {
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    try {
                        const chunk = JSON.parse(trimmed);
                        const token = chunk.message?.content ?? '';
                        if (token) {
                            yield token;
                        }
                        if (chunk.done)
                            return;
                    }
                    catch {
                        // 跳过非 JSON 行
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    // ============================================================
    //  内部实现
    // ============================================================
    /**
     * chat 的内部实现（不含重试逻辑）
     */
    async _chatImpl(messages, options) {
        const model = options.model ?? this.model;
        const timeout = options.timeout ?? this.timeout;
        (0, logger_js_1.debug)(`📤 Ollama 请求: ${model}, ${messages.length} 条消息`);
        try {
            const body = {
                model,
                messages: this.buildMessages(messages, options.systemPrompt),
                stream: false,
                options: {
                    temperature: options.temperature ?? 0.7,
                    num_predict: options.maxTokens,
                    // 🔥 M1/M2 Mac GPU 加速
                    num_gpu: 1,
                    main_gpu: 0,
                },
            };
            // 工具支持
            if (options.tools && options.tools.length > 0) {
                body.tools = options.tools;
            }
            const startTime = Date.now();
            // 组合内部超时信号和外部取消信号
            const timeoutSignal = AbortSignal.timeout(timeout);
            const fetchSignal = options.signal
                ? AbortSignal.any([timeoutSignal, options.signal])
                : timeoutSignal;
            const response = await fetch(`${this.host}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: fetchSignal,
            });
            const elapsed = Date.now() - startTime;
            (0, logger_js_1.debug)(`⏱️ Ollama 响应耗时: ${elapsed}ms`);
            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 404) {
                    throw new errors_js_1.ModelUnavailableError(`模型 "${model}" 未找到，请先运行: ollama pull ${model}`);
                }
                if (response.status === 429) {
                    throw new errors_js_1.RateLimitError('Ollama 请求过于频繁');
                }
                throw new errors_js_1.LLMError(`Ollama 错误 (${response.status}): ${errorText}`, 'OLLAMA_ERROR', response.status >= 500);
            }
            const data = (await response.json());
            const message = data.message;
            const content = message?.content ?? '';
            (0, logger_js_1.debug)(`📥 Ollama 响应: ${content.slice(0, 100)}...`);
            // 解析工具调用（Ollama 0.3+ 支持）
            const toolCalls = this.parseOllamaToolCalls(message);
            return {
                content,
                finishReason: data.done_reason === 'load' ? 'length' : 'stop',
                usage: {
                    promptTokens: data.prompt_eval_count ?? 0,
                    completionTokens: data.eval_count ?? 0,
                    totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
                },
                model: data.model ?? model,
                toolCalls,
            };
        }
        catch (err) {
            // 超时错误
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw new errors_js_1.NetworkError(`Ollama 请求超时 (${timeout}ms)`);
            }
            // 外部取消
            if (err instanceof Error && err.name === 'AbortError') {
                throw new errors_js_1.LLMError(`Ollama 请求被取消`, 'REQUEST_CANCELLED', false);
            }
            // 已经是 LLMError 的直接抛出
            if (err instanceof errors_js_1.LLMError) {
                throw err;
            }
            // 其他网络错误
            (0, logger_js_1.error)(`Ollama 请求失败: ${err}`);
            throw new errors_js_1.LLMError(`Ollama 通信失败: ${err.message}`, 'OLLAMA_CONNECTION', true);
        }
    }
    /**
     * 解析 Ollama 响应中的工具调用
     */
    parseOllamaToolCalls(message) {
        if (!message)
            return undefined;
        const toolCalls = message.tool_calls;
        if (!toolCalls || toolCalls.length === 0)
            return undefined;
        return toolCalls.map((tc) => {
            const fn = tc.function;
            return {
                name: fn?.name ?? '',
                arguments: fn?.arguments ?? '{}',
            };
        });
    }
    /**
     * 构建 Ollama 格式的消息列表
     */
    buildMessages(messages, systemPrompt) {
        const result = [];
        if (systemPrompt) {
            result.push({ role: 'system', content: systemPrompt });
        }
        for (const msg of messages) {
            result.push({ role: msg.role, content: msg.content });
        }
        return result;
    }
}
exports.OllamaClient = OllamaClient;
//# sourceMappingURL=ollama-client.js.map