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
