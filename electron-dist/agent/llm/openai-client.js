"use strict";
/**
 * openai-client.ts - 云端 AI 模型客户端
 *
 * 理解：这就像"连锁大饭店"——需要会员卡（API Key），但菜品更丰富（模型更强大）。
 *
 * 支持：OpenAI、DeepSeek、以及任何 OpenAI 兼容的 API
 *
 * 使用方式：
 *   import { OpenAIClient, DeepSeekClient } from './openai-client.js';
 *   const client = new OpenAIClient({ apiKey: 'sk-xxx', model: 'gpt-4o-mini' });
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekClient = exports.OpenAIClient = void 0;
const logger_js_1 = require("./logger.js");
const errors_js_1 = require("./errors.js");
const retry_js_1 = require("./retry.js");
/** 默认超时（毫秒） */
const DEFAULT_CHAT_TIMEOUT = 60000;
const DEFAULT_STREAM_TIMEOUT = 120000;
const DEFAULT_EMBED_TIMEOUT = 30000;
// ============================================================
//  工具函数
// ============================================================
/**
 * 构建符合 OpenAI 格式的消息列表
 */
function buildOpenAIMessages(messages, systemPrompt) {
    const result = [];
    if (systemPrompt) {
        result.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
        const entry = {
            role: msg.role,
            content: msg.content || null,
        };
        if (msg.tool_call_id) {
            entry.tool_call_id = msg.tool_call_id;
        }
        if (msg.tool_calls) {
            entry.tool_calls = msg.tool_calls;
        }
        result.push(entry);
    }
    return result;
}
/**
 * 解析 OpenAI 响应中的工具调用
 *
 * OpenAI 响应格式：
 *   choice.message.tool_calls = [{ id, type, function: { name, arguments } }]
 */
function parseToolCalls(choice) {
    const message = choice.message;
    const toolCalls = message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0)
        return undefined;
    return toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name ?? '',
        arguments: tc.function.arguments ?? '{}',
    }));
}
/**
 * 根据 HTTP 状态码抛出对应的错误类型
 */
function handleHttpError(status, errorText, apiName) {
    switch (status) {
        case 401:
        case 403:
            throw new errors_js_1.AuthenticationError(`${apiName} 认证失败 (${status}): ${errorText}`);
        case 429:
            throw new errors_js_1.RateLimitError(`${apiName} 请求过于频繁，请稍后重试`);
        case 400:
            if (errorText.toLowerCase().includes('content') || errorText.toLowerCase().includes('safety')) {
                throw new errors_js_1.ContentFilterError(`${apiName} 内容被安全策略拦截`);
            }
            throw new errors_js_1.LLMError(`${apiName} 请求错误 (${status}): ${errorText}`, 'BAD_REQUEST', false);
        default:
            throw new errors_js_1.LLMError(`${apiName} 服务器错误 (${status}): ${errorText}`, 'API_ERROR', status >= 500);
    }
}
// ============================================================
//  OpenAI 客户端
// ============================================================
/**
 * OpenAI 客户端
 */
class OpenAIClient {
    apiKey;
    baseUrl;
    model;
    constructor(config) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
        this.model = config.model ?? 'gpt-4o-mini';
        const displayKey = this.apiKey.slice(0, 7) + '...';
        (0, logger_js_1.info)(`🟢 ${this.apiName} 客户端初始化: ${this.model}, key=${displayKey}`);
    }
    /** 获取 API 名称（用于错误消息） */
    get apiName() {
        return 'OpenAI';
    }
    /** @inheritdoc */
    async healthCheck() {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5000),
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
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok)
                return [];
            const data = (await response.json());
            return (data.data ?? []).map((m) => m.id).sort();
        }
        catch {
            return [];
        }
    }
    /** @inheritdoc */
    async embed(text) {
        (0, logger_js_1.debug)(`📤 ${this.apiName} embed 请求: ${text.slice(0, 50)}...`);
        try {
            const response = await fetch(`${this.baseUrl}/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: 'text-embedding-ada-002',
                    input: text,
                }),
                signal: AbortSignal.timeout(DEFAULT_EMBED_TIMEOUT),
            });
            if (!response.ok) {
                const errorText = await response.text();
                handleHttpError(response.status, errorText, this.apiName);
            }
            const data = (await response.json());
            return data.data?.[0]?.embedding ?? [];
        }
        catch (err) {
            if (err instanceof errors_js_1.LLMError)
                throw err;
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw new errors_js_1.NetworkError(`${this.apiName} embed 请求超时`);
            }
            throw new errors_js_1.LLMError(`${this.apiName} embed 失败: ${err.message}`, 'EMBED_ERROR', true);
        }
    }
    /** @inheritdoc */
    async chat(messages, options = {}) {
        return (0, retry_js_1.withOptionalRetry)(() => this._chatImpl(messages, options), options.retry);
    }
    /**
     * 流式聊天 —— 逐字返回（SSE 格式）
     *
     * 注意：流式模式不支持重试
     */
    async *chatStream(messages, options = {}) {
        const model = options.model ?? this.model;
        const timeout = options.timeout ?? DEFAULT_STREAM_TIMEOUT;
        (0, logger_js_1.debug)(`📤 ${this.apiName} 流式请求: ${model}`);
        const body = {
            model,
            messages: buildOpenAIMessages(messages, options.systemPrompt),
            temperature: options.temperature ?? 0.7,
            stream: true,
            stream_options: { include_usage: true },
        };
        if (options.maxTokens) {
            body.max_tokens = options.maxTokens;
        }
        // 工具支持
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools;
            body.tool_choice = 'auto';
        }
        let response;
        try {
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeout),
            });
        }
        catch (err) {
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw new errors_js_1.NetworkError(`${this.apiName} 流式请求超时 (${timeout}ms)`);
            }
            throw new errors_js_1.LLMError(`${this.apiName} 流式连接失败: ${err.message}`, 'STREAM_CONNECTION_ERROR', true);
        }
        if (!response.ok) {
            const errorText = await response.text();
            handleHttpError(response.status, errorText, this.apiName);
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
                    if (!trimmed || !trimmed.startsWith('data: '))
                        continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]')
                        return;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta?.content) {
                            yield delta.content;
                        }
                    }
                    catch {
                        // 跳过无法解析的行（如注释或格式错误的 SSE chunk）
                        // 只在 debug 级别记录，避免正常流式中产生噪音
                        (0, logger_js_1.debug)(`⚠️ SSE 跳过无法解析的行: ${data.slice(0, 80)}`);
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
        const timeout = options.timeout ?? DEFAULT_CHAT_TIMEOUT;
        (0, logger_js_1.debug)(`📤 ${this.apiName} 请求: ${model}, ${messages.length} 条消息`);
        const body = {
            model,
            messages: buildOpenAIMessages(messages, options.systemPrompt),
            temperature: options.temperature ?? 0.7,
        };
        if (options.maxTokens) {
            body.max_tokens = options.maxTokens;
        }
        // 工具调用支持
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools;
            body.tool_choice = 'auto';
        }
        let response;
        try {
            // 组合内部超时信号和外部取消信号
            const timeoutSignal = AbortSignal.timeout(timeout);
            const fetchSignal = options.signal
                ? AbortSignal.any([timeoutSignal, options.signal])
                : timeoutSignal;
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: fetchSignal,
            });
        }
        catch (err) {
            (0, logger_js_1.error)(`${this.apiName} 网络请求失败: ${err}`);
            if (err instanceof Error && err.name === 'TimeoutError') {
                throw new errors_js_1.NetworkError(`${this.apiName} 请求超时 (${timeout}ms)`);
            }
            if (err instanceof Error && err.name === 'AbortError') {
                throw new errors_js_1.LLMError(`${this.apiName} 请求被取消`, 'REQUEST_CANCELLED', false);
            }
            throw new errors_js_1.LLMError(`${this.apiName} 连接失败: ${err.message}`, 'CONNECTION_ERROR', true);
        }
        if (!response.ok) {
            const errorText = await response.text();
            handleHttpError(response.status, errorText, this.apiName);
        }
        const data = (await response.json());
        const choice = data.choices?.[0];
        if (!choice) {
            throw new errors_js_1.LLMError(`${this.apiName} 返回了空的 choices`, 'EMPTY_RESPONSE', true);
        }
        // 检查是否为工具调用
        const finishReason = choice.finish_reason;
        if (finishReason === 'tool_calls') {
            const toolCalls = parseToolCalls(choice);
            return {
                content: choice.message?.content ?? '',
                finishReason: 'stop',
                usage: data.usage
                    ? {
                        promptTokens: data.usage.prompt_tokens,
                        completionTokens: data.usage.completion_tokens,
                        totalTokens: data.usage.total_tokens,
                    }
                    : undefined,
                model: data.model,
                toolCalls,
            };
        }
        const content = choice.message?.content ?? '';
        (0, logger_js_1.debug)(`📥 ${this.apiName} 响应: ${content.slice(0, 100)}...`);
        return {
            content,
            finishReason: finishReason === 'stop' ? 'stop' : 'length',
            usage: data.usage
                ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                }
                : undefined,
            model: data.model,
        };
    }
}
exports.OpenAIClient = OpenAIClient;
// ============================================================
//  DeepSeek 客户端
// ============================================================
/**
 * DeepSeek 客户端（OpenAI 兼容）
 *
 * 理解：DeepSeek 的 API 和 OpenAI 完全兼容，所以直接继承。
 * 特点：便宜、中文能力强
 */
class DeepSeekClient extends OpenAIClient {
    get apiName() {
        return 'DeepSeek';
    }
    constructor(config) {
        super({
            apiKey: config.apiKey,
            baseUrl: 'https://api.deepseek.com/v1',
            model: config.model ?? 'deepseek-v4-flash',
        });
        const displayKey = config.apiKey.slice(0, 7) + '...';
        (0, logger_js_1.info)(`🔵 DeepSeek 客户端初始化: ${config.model ?? 'deepseek-v4-flash'}, key=${displayKey}`);
    }
}
exports.DeepSeekClient = DeepSeekClient;
//# sourceMappingURL=openai-client.js.map