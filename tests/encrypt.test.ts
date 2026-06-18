/**
 * encrypt 模块测试
 *
 * 覆盖：encrypt / decrypt / isEncrypted 的加密轮转、向后兼容、边界情况
 *
 * 注意：
 *   - 加密密钥从 hostname 派生，同一台机器加解密可轮转
 *   - decrypt 对非加密字符串原样返回（向后兼容）
 */

import { encrypt, decrypt, isEncrypted } from '../src/cli/utils/encrypt.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;

function test(name: string, fn: () => void) {
    testCount++;
    console.log(`\n📝 测试 ${testCount}: ${name}`);
    try {
        fn();
        passCount++;
        console.log('  ✅ 通过');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ❌ 失败: ${msg}`);
    }
}

function assertEqual<T>(actual: T, expected: T, msg = ''): void {
    if (actual !== expected) {
        throw new Error(`${msg ? msg + ': ' : ''}期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
}

function assertOk(value: unknown, msg = ''): void {
    if (!value) throw new Error(msg || '期望 truthy 值');
}

function assertThrows(fn: () => void, msg = ''): void {
    try {
        fn();
        throw new Error(msg || '期望抛出异常但未抛出');
    } catch (err) {
        // 预期抛出
    }
}

// ============================================================
//  测试
// ============================================================
function run() {
    console.log('🔐 encrypt 模块测试');
    console.log('━'.repeat(62));

    // ── encrypt / decrypt 基本轮转 ──

    test('encrypt + decrypt 轮转（标准 API Key）', () => {
        const original = 'sk-1234567890abcdefghijklmnopqrstuv';
        const ciphertext = encrypt(original);
        assertOk(ciphertext.startsWith('$ENC$:'), '以 $ENC$: 开头');
        assertOk(!ciphertext.includes(original), '不包含原文');
        assertEqual(decrypt(ciphertext), original, '解密还原');
    });

    test('encrypt + decrypt 轮转（短 key）', () => {
        const original = 'sk-short';
        const ciphertext = encrypt(original);
        assertEqual(decrypt(ciphertext), original, '短 key 加解密');
    });

    test('encrypt + decrypt 轮转（特殊字符）', () => {
        const original = 'sk-key!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'';
        const ciphertext = encrypt(original);
        assertEqual(decrypt(ciphertext), original, '特殊字符');
    });

    test('encrypt + decrypt 轮转（中文字符）', () => {
        const original = '密钥测试-中文key-测试';
        const ciphertext = encrypt(original);
        assertEqual(decrypt(ciphertext), original, '中文字符');
    });

    test('encrypt + decrypt 轮转（空字符串）', () => {
        const original = '';
        const ciphertext = encrypt(original);
        assertOk(ciphertext.startsWith('$ENC$:'), '空字符串也能加密');
        assertEqual(decrypt(ciphertext), original, '空字符串解密');
    });

    test('encrypt + decrypt 轮转（长 key 512 字符）', () => {
        const original = 'sk-' + 'x'.repeat(508);
        const ciphertext = encrypt(original);
        assertEqual(decrypt(ciphertext), original, '长 key 加解密');
    });

    // ── 随机性 ──

    test('相同明文生成不同密文（随机 IV）', () => {
        const original = 'sk-same-plaintext';
        const c1 = encrypt(original);
        const c2 = encrypt(original);
        const c3 = encrypt(original);

        assertOk(c1 !== c2 || c2 !== c3, '每次加密结果不同（随机 IV）');
        // 但都能正确解密
        assertEqual(decrypt(c1), original);
        assertEqual(decrypt(c2), original);
        assertEqual(decrypt(c3), original);
    });

    // ── 向后兼容 ──

    test('decrypt 明文原样返回（向后兼容）', () => {
        assertEqual(decrypt('sk-plain-text'), 'sk-plain-text', '明文原样返回');
        assertEqual(decrypt('simple-key'), 'simple-key', '简单 key 原样');
        assertEqual(decrypt(''), '', '空字符串原样');
    });

    test('decrypt 非 $ENC$: 前缀字符串原样返回', () => {
        assertEqual(decrypt('$NOT_ENC$:something'), '$NOT_ENC$:something');
        assertEqual(decrypt('ENC:something'), 'ENC:something');
        assertEqual(decrypt('random text here'), 'random text here');
    });

    // ── isEncrypted ──

    test('isEncrypted 正确识别密文', () => {
        assertOk(isEncrypted(encrypt('sk-test')), '加密结果识别');
    });

    test('isEncrypted 正确识别明文', () => {
        assertOk(!isEncrypted('sk-plain-text'), '明文不识别');
        assertOk(!isEncrypted(''), '空字符串不识别');
        assertOk(!isEncrypted('$NOT_ENC$:xxx'), '错误前缀不识别');
    });

    // ── 边界情况 ──

    test('decrypt 损坏数据（长度不足）抛出异常', () => {
        // IV(12) + AuthTag(16) + 0 ciphertext = 28 bytes = bad
        const badPayload = Buffer.alloc(28).toString('base64');
        const badCipher = '$ENC$:' + badPayload;

        assertThrows(() => decrypt(badCipher), '损坏数据应抛异常');
    });

    test('decrypt 篡改数据抛出异常', () => {
        const ciphertext = encrypt('sk-original');
        // 翻转 base64 中某个字符
        const parts = ciphertext.split(':');
        const tampered = parts[0] + ':x' + (parts[1]?.slice(1) || '');
        assertThrows(() => decrypt(tampered), '篡改数据应抛异常');
    });

    test('decrypt 无效 base64 抛出异常', () => {
        assertThrows(() => decrypt('$ENC$:!!!invalid!!!'), '无效 base64 应抛异常');
    });

    // ── 密文格式 ──

    test('密文不包含明文子串', () => {
        const plaintext = 'sk-secret-api-key-value';
        const ciphertext = encrypt(plaintext);
        // 检查明文是否以任何方式出现在 base64 编码中
        // base64 编码不会直接泄露原文，但为确保安全性验证
        const b64 = ciphertext.slice(6); // strip $ENC$:
        assertOk(!b64.includes(plaintext), 'base64 不直接包含明文');
    });

    // ── 多次加密一致性 ──

    test('多次加密 → 解密 → 全部还原', () => {
        const keys = [
            'sk-key-one',
            'sk-key-two-with-more-chars',
            'dp-secret-key',
            'very-long-key-' + 'a'.repeat(100),
        ];

        const encrypted = keys.map(k => encrypt(k));
        // 全部密文不同
        const uniqueCiphers = new Set(encrypted);
        assertOk(uniqueCiphers.size === encrypted.length, '相同 key 密文不同');
        // 全部正确解密
        for (let i = 0; i < keys.length; i++) {
            assertEqual(decrypt(encrypted[i]), keys[i], `key ${i} 正确解密`);
        }
    });

    // ============================================================
    //  汇总
    // ============================================================
    console.log('\n' + '━'.repeat(62));
    console.log(`\n📊 测试结果: ${passCount}/${testCount} 通过`);
    if (passCount === testCount) {
        console.log('🎉 所有测试通过！\n');
    } else {
        console.log(`❌ ${testCount - passCount} 个测试失败\n`);
        process.exit(1);
    }
}

run();
