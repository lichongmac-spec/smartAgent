"use strict";
/**
 * 配置加密存储模块
 *
 * 职责：
 * 1. 使用 AES-256-GCM 加密敏感配置字段（如 apiKey）
 * 2. 加密密钥从机器标识派生，绑定当前设备
 * 3. 向后兼容明文配置（decrypt 对非加密字符串原样返回）
 *
 * 使用方式：
 *   import { encrypt, decrypt, isEncrypted } from './utils/encrypt.js';
 *
 *   const ciphertext = encrypt('sk-1234567890abcdef');
 *   // => '$ENC$:dmFyaW91cyBiYXNlNjQgZW5jb2RlZCBkYXRh...'
 *
 *   const plaintext = decrypt(ciphertext);
 *   // => 'sk-1234567890abcdef'
 *
 *   decrypt('sk-plain-text');  // 向后兼容，原样返回
 *   // => 'sk-plain-text'
 *
 * 安全模型：
 *   - 加密密钥由 PBKDF2 从 AGENT_ENCRYPTION_KEY（环境变量）或机器 hostname + 固定盐值派生
 *   - 设置 AGENT_ENCRYPTION_KEY 可跨机器共享密钥（容器/多机部署推荐）
 *   - 每次加密使用随机 IV（12 字节）
 *   - GCM 模式提供认证加密（防篡改）
 *   - 格式: $ENC$:<base64(iv + authTag + ciphertext)>
 *
 * 局限性：
 *   - 未设置 AGENT_ENCRYPTION_KEY 时，更换机器后无法解密（需重新配置 apiKey）
 *   - 不适用于需要跨设备共享配置且未设 ENCRYPTION_KEY 的场景
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.isEncrypted = isEncrypted;
const crypto_1 = require("crypto");
const os_1 = require("os");
// ============================================================
//  常量
// ============================================================
/** 加密算法 */
const ALGORITHM = 'aes-256-gcm';
/** 密钥长度（字节） */
const KEY_LENGTH = 32; // 256 bits
/** IV 长度（字节），GCM 推荐 12 字节 */
const IV_LENGTH = 12; // 96 bits
/** 认证标签长度（字节） */
const AUTH_TAG_LENGTH = 16; // 128 bits
/** PBKDF2 迭代次数 */
const ITERATIONS = 100_000;
/** 固定盐值（项目级别） */
const SALT = 'smartagent-config-encryption-v1';
/** 密文前缀标记 */
const ENC_PREFIX = '$ENC$:';
// ============================================================
//  密钥派生
// ============================================================
/**
 * 从机器标识或用户提供的密钥派生 AES-256 密钥
 *
 * 优先级：
 *   1. 环境变量 AGENT_ENCRYPTION_KEY（用户提供，跨机器共享）
 *   2. hostname 派生（绑定当前设备，容器重启可能丢失）
 *
 * 使用 PBKDF2-SHA256 从种子 + 固定盐值派生 256 位密钥。
 *
 * @returns 32 字节的密钥 Buffer
 */
function deriveKey() {
    const seed = process.env.AGENT_ENCRYPTION_KEY || (0, os_1.hostname)();
    return (0, crypto_1.pbkdf2Sync)(seed, SALT, ITERATIONS, KEY_LENGTH, 'sha256');
}
// ============================================================
//  公开 API
// ============================================================
/**
 * 加密明文
 *
 * 使用 AES-256-GCM 加密：
 * 1. 派生密钥（机器绑定）
 * 2. 生成随机 IV
 * 3. 加密明文
 * 4. 获取 GCM 认证标签
 * 5. 打包为 `$ENC$:<base64>` 格式
 *
 * @param plaintext 明文（如 API Key）
 * @returns 加密后的密文字符串，以 `$ENC$:` 开头
 *
 * @example
 *   encrypt('sk-1234567890abcdef')
 *   // => '$ENC$:oVxY2a...base64...'
 */
function encrypt(plaintext) {
    const key = deriveKey();
    const iv = (0, crypto_1.randomBytes)(IV_LENGTH);
    const cipher = (0, crypto_1.createCipheriv)(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // 打包: iv (12) + authTag (16) + ciphertext (var)
    const payload = Buffer.concat([iv, authTag, encrypted]);
    return ENC_PREFIX + payload.toString('base64');
}
/**
 * 解密密文
 *
 * 兼容两种格式：
 * - `$ENC$:<base64>` → AES-256-GCM 解密
 * - 其他（明文/空值） → 原样返回（向后兼容）
 *
 * @param encryptedString 密文或明文
 * @returns 解密后的明文
 * @throws 如果密文格式正确但密钥不匹配（机器变更）或数据被篡改
 *
 * @example
 *   decrypt(encrypt('sk-key'));  // => 'sk-key'
 *   decrypt('plain-text');       // => 'plain-text'（向后兼容）
 */
function decrypt(encryptedString) {
    // 向后兼容：非加密字符串原样返回
    if (!encryptedString.startsWith(ENC_PREFIX)) {
        return encryptedString;
    }
    const payload = Buffer.from(encryptedString.slice(ENC_PREFIX.length), 'base64');
    // 校验最小长度: iv + authTag + 密文（可为空，允许空字符串加密）
    const minLength = IV_LENGTH + AUTH_TAG_LENGTH;
    if (payload.length < minLength) {
        throw new Error('密文数据不完整，可能已损坏');
    }
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const key = deriveKey();
    const decipher = (0, crypto_1.createDecipheriv)(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    try {
        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]).toString('utf8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`解密失败：密钥不匹配或数据被篡改（${msg}）。` +
            '如果更换了机器，请重新设置 apiKey：smartagent config set apiKey <your-key>');
    }
}
/**
 * 判断字符串是否为加密格式
 *
 * @param value 待检测的字符串
 * @returns true 表示以 `$ENC$:` 开头
 */
function isEncrypted(value) {
    return value.startsWith(ENC_PREFIX);
}
//# sourceMappingURL=encrypt.js.map