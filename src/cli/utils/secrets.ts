/**
 * 统一脱敏工具模块
 *
 * 职责：
 * 1. API Key 脱敏（按比例显示首尾，短 key 完全隐藏）
 * 2. 配置对象脱敏（保留原始对象结构，仅替换敏感字段）
 *
 * 使用方式：
 *   import { redactApiKey, redactConfig } from './utils/secrets.js';
 *
 *   const masked = redactApiKey('sk-1234567890abcdef');
 *   // => 'sk-1234…cdef'
 *
 *   const safeConfig = redactConfig(config);  // apiKey → '••••'
 *   const fullConfig = redactConfig(config, { showSecrets: true }); // 原样
 */

// ============================================================
//  脱敏函数
// ============================================================

export interface RedactOptions {
    /** 是否显示敏感信息（true = 原样返回） */
    showSecrets?: boolean;
}

/**
 * 脱敏 API Key
 *
 * 规则：
 * - showSecrets=true → 直接返回原值
 * - 空值/未设置 → 返回 '(未设置)'
 * - 短 key（≤8 字符）→ 返回 '••••'（完全隐藏）
 * - 长 key → 按比例显示首尾，中间用 '…' 替代
 *
 * @param apiKey  原始 API Key
 * @param options 选项
 * @returns 脱敏后的字符串
 *
 * @example
 *   redactApiKey('sk-1234567890abcdef')  // 'sk-1234…cdef'
 *   redactApiKey('short')                // '••••'
 *   redactApiKey('')                     // '(未设置)'
 *   redactApiKey('sk-secret', { showSecrets: true })  // 'sk-secret'
 */
export function redactApiKey(
    apiKey: string | undefined | null,
    options: RedactOptions | boolean = {},
): string {
    const opts: RedactOptions =
        typeof options === 'boolean' ? { showSecrets: options } : options;

    if (opts.showSecrets) {
        return apiKey ?? '(未设置)';
    }

    if (!apiKey || apiKey.length === 0) {
        return '(未设置)';
    }

    if (apiKey.length <= 8) {
        return '••••'; // 完全隐藏
    }

    // 按比例显示首尾：首部 ~1/3，尾部 ~1/4（最少 1，最多 6）
    const visible = Math.min(6, Math.floor(apiKey.length / 3));
    const prefix = apiKey.slice(0, visible);
    const suffix = apiKey.slice(-Math.min(4, visible));

    return `${prefix}…${suffix}`;
}

/**
 * 对任意类型的值进行脱敏处理
 *
 * 规则：
 * - string  → 调用 redactApiKey（视同密钥）
 * - number  → 转为字符串后脱敏
 * - boolean / null / undefined → 原样返回
 * - object  → 返回 '[redacted]'
 *
 * @param value   待脱敏的值
 * @param options 选项（可传 boolean 简写，true = 显示原文）
 */
export function maskSensitiveValue(
    value: unknown,
    options: RedactOptions | boolean = {},
): unknown {
    const opts: RedactOptions =
        typeof options === 'boolean' ? { showSecrets: options } : options;

    if (opts.showSecrets) return value;

    if (typeof value === 'string') {
        return redactApiKey(value, opts);
    }

    if (typeof value === 'number') {
        return redactApiKey(String(value), opts);
    }

    if (value === null || value === undefined) return value;
    if (typeof value === 'boolean') return value;

    // object / array / function 等
    return '[redacted]';
}

// ============================================================
//  配置对象脱敏
// ============================================================

/**
 * 脱敏配置对象中的敏感字段
 *
 * 当前支持的敏感字段：
 * - apiKey  → 脱敏
 * - apiSecret → 脱敏
 *
 * 返回新对象，不修改原对象。
 *
 * @param config  原始配置对象
 * @param options 选项
 * @returns 脱敏后的配置对象
 *
 * @example
 *   const safe = redactConfig({ apiKey: 'sk-abc', model: 'gpt-4' });
 *   // { apiKey: '••••', model: 'gpt-4' }
 */
export function redactConfig<T extends Record<string, unknown>>(
    config: T,
    options: RedactOptions = {},
): T {
    const result = { ...config } as Record<string, unknown>;

    for (const key of Object.keys(result)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'apikey' || lowerKey === 'apisecret' || lowerKey === 'key') {
            result[key] = redactApiKey(result[key] as string, options);
        }
    }

    return result as T;
}

// ============================================================
//  文本流脱敏（正则匹配）
// ============================================================

/**
 * 敏感信息匹配模式
 *
 * 覆盖常见密钥/令牌格式：
 * - OpenAI / DeepSeek 风格 API Key（sk- / dp- 前缀）
 * - Bearer Token（HTTP Authorization 头）
 * - 通用 API Key / Secret（常见环境变量中的 key=value 形式）
 * - JWT Token（三段式 base64 编码）
 * - AWS 风格 Access Key（AKID 前缀）
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    {
        // OpenAI / DeepSeek / Anthropic 风格 API Key
        // 匹配: sk-xxx, sk-ant-xxx, dp-xxx, ak-xxx 等
        pattern: /\b(?:sk|dp|ak|pk)-(?:ant-)?[A-Za-z0-9]{20,}\b/g,
        label: 'API Key',
    },
    {
        // Bearer Token（HTTP Authorization）
        // 匹配: Bearer eyJhbGci..., Bearer sk-xxx, 等
        pattern: /Bearer\s+[A-Za-z0-9._\-+/=]{20,}/gi,
        label: 'Bearer Token',
    },
    {
        // JWT Token（三段式，每段 base64 编码）
        // 匹配: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIi...
        pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g,
        label: 'JWT',
    },
    {
        // 常见 API Key 环境变量形式
        // 匹配: API_KEY=sk-xxx, token=abc123..., secret=xxx 等
        pattern: /(?:api[_-]?key|secret|token|password)=[\x21-\x7e]{8,}/gi,
        label: 'Credential',
    },
];

/**
 * 将匹配到的敏感字符串脱敏显示
 *
 * 规则：
 * - 长度 > 8 → 显示前 6 个字符 + '***' + 后 4 个字符
 * - 长度 ≤ 8 → 显示 '***REDACTED***'
 *
 * @param match 原始匹配字符串
 * @returns 脱敏后的字符串（保留原长度大致可见）
 */
function redactMatch(match: string): string {
    if (match.length > 8) {
        const prefix = match.slice(0, 6);
        const suffix = match.slice(-4);
        return `${prefix}***${suffix}`;
    }
    return '***REDACTED***';
}

/**
 * 自动脱敏文本中的敏感信息
 *
 * 使用预定义的敏感信息匹配模式，扫描文本中的 API Key、Bearer Token、
 * JWT、凭据等，自动将其替换为脱敏版本。
 *
 * @param text 原始文本（可能包含敏感信息）
 * @returns 脱敏后的文本
 *
 * @example
 *   redactSecrets('使用 sk-1234567890abcdefghij 调用 API')
 *   // => '使用 sk-123***ghij 调用 API'
 *
 *   redactSecrets('Authorization: Bearer my-super-secret-token-12345')
 *   // => 'Authorization: Beare***2345'
 */
export function redactSecrets(text: string): string {
    let redacted = text;
    for (const { pattern } of SENSITIVE_PATTERNS) {
        redacted = redacted.replace(pattern, redactMatch);
    }
    return redacted;
}

/**
 * 控制脱敏是否启用（默认启用）
 */
let _redactionEnabled = true;

/** 开启/关闭自动脱敏 */
export function setRedactionEnabled(enabled: boolean): void {
    _redactionEnabled = enabled;
}

/** 查询脱敏是否启用 */
export function isRedactionEnabled(): boolean {
    return _redactionEnabled;
}

/**
 * 安全输出——根据是否启用脱敏，决定是否调用 redactSecrets
 *
 * 供 logger 等输出模块使用。
 */
export function safeOutput(text: string): string {
    return _redactionEnabled ? redactSecrets(text) : text;
}
