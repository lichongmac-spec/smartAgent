import { redactApiKey, redactConfig, maskSensitiveValue } from '../src/cli/utils/secrets.js';

// ────────────────────────────────────────────────
// 测试工具函数
// ────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
    try {
        const result = fn();
        if (result instanceof Promise) {
            result
                .then(() => { passed++; })
                .catch((err) => {
                    failed++;
                    failures.push(`${name}: ${err instanceof Error ? err.message : err}`);
                    console.error(`  ❌ ${name}\n    ${err instanceof Error ? err.message : err}`);
                });
        } else {
            passed++;
        }
    } catch (err) {
        failed++;
        failures.push(`${name}: ${err instanceof Error ? err.message : err}`);
        console.error(`  ❌ ${name}\n    ${err instanceof Error ? err.message : err}`);
    }
}

function assertEq<T>(actual: T, expected: T, label?: string): void {
    if (actual !== expected) {
        throw new Error(
            `assertEq${label ? ` [${label}]` : ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    }
}

// ────────────────────────────────────────────────
// redactApiKey 测试
// ────────────────────────────────────────────────

console.log('\n🔑 redactApiKey 测试');

test('空字符串 + showSecrets=false → (未设置)', () => {
    assertEq(redactApiKey('', false), '(未设置)');
});

test('空字符串 + showSecrets=true → 原样返回空字符串', () => {
    assertEq(redactApiKey('', true), '');
});

test('null + showSecrets=false → (未设置)', () => {
    assertEq(redactApiKey(null, false), '(未设置)');
});

test('null + showSecrets=true → (未设置)', () => {
    assertEq(redactApiKey(null, true), '(未设置)');
});

test('undefined + showSecrets=false → (未设置)', () => {
    assertEq(redactApiKey(undefined, false), '(未设置)');
});

test('undefined + showSecrets=true → (未设置)', () => {
    assertEq(redactApiKey(undefined, true), '(未设置)');
});

test('showSecrets=true (boolean 简写) → 原样返回', () => {
    assertEq(redactApiKey('sk-1234567890abcdef', true), 'sk-1234567890abcdef');
    assertEq(redactApiKey('short', true), 'short');
});

test('showSecrets=true (对象选项) → 原样返回', () => {
    assertEq(redactApiKey('sk-xxx', { showSecrets: true }), 'sk-xxx');
});

test('长度 ≤8 → ••••', () => {
    assertEq(redactApiKey('12345678', false), '••••');
    assertEq(redactApiKey('abc', false), '••••');
    assertEq(redactApiKey('AB', false), '••••');
});

test('长度 11 → 显示首尾（visible=3）', () => {
    const key = 'sk-1234567'; // 11 chars
    const r = redactApiKey(key, false);
    assertEq(r.slice(0, 3), 'sk-');
    assertEq(r.slice(-3), '567');
    const dot = r.includes('…');
    if (!dot) throw new Error('should contain …');
});

test('长度 ≥16 → 显示前6后4', () => {
    const key = 'sk-1234567890abcdef'; // 22 chars
    const r = redactApiKey(key, false);
    assertEq(r.slice(0, 6), 'sk-123');
    assertEq(r.slice(-4), 'cdef');
    if (!r.includes('…')) throw new Error('should contain …');
});

test('典型 OpenAI key 格式', () => {
    const key = 'sk-1234567890abcdefghijklmnopqrstuvwxyzABCD'; // 51 chars
    const r = redactApiKey(key, false);
    assertEq(r.slice(0, 6), 'sk-123');
    assertEq(r.slice(-4), 'ABCD');
    if (!r.includes('…')) throw new Error('should contain …');
});

test('比例计算：长度 12 → visible=4', () => {
    const r = redactApiKey('abcdefghijkl', false);
    if (r === '••••') throw new Error('len=12 should not be fully hidden');
    if (!r.includes('…')) throw new Error('should contain …');
});

test('比例计算：长度 100 → visible=6', () => {
    const longKey = 'a'.repeat(100);
    const r = redactApiKey(longKey, false);
    assertEq(r.slice(0, 6), 'aaaaaa');
    assertEq(r.slice(-4), 'aaaa');
});

// ────────────────────────────────────────────────
// maskSensitiveValue 测试
// ────────────────────────────────────────────────

console.log('\n🎭 maskSensitiveValue 测试');

test('string 短 key → ••••', () => {
    assertEq(maskSensitiveValue('short', false), '••••');
});

test('string 长 key → 脱敏', () => {
    const r = maskSensitiveValue('longenoughkey', false) as string;
    if (r === 'longenoughkey') throw new Error('should be redacted');
    if (!r.includes('…')) throw new Error('should contain …');
});

test('showSecrets=true (boolean 简写) → 原样返回', () => {
    assertEq(maskSensitiveValue('any-value', true), 'any-value');
});

test('showSecrets=true (对象选项) → 原样返回', () => {
    assertEq(maskSensitiveValue('any-value', { showSecrets: true }), 'any-value');
    assertEq(maskSensitiveValue(12345, { showSecrets: true }), 12345);
    assertEq(maskSensitiveValue(null, { showSecrets: true }), null);
});

test('number → 转为字符串后脱敏', () => {
    const r = maskSensitiveValue(123456789012345, false);
    if (typeof r !== 'string') throw new Error('should return string');
    if (r === '123456789012345') throw new Error('should be redacted');
});

test('boolean → 原样返回', () => {
    assertEq(maskSensitiveValue(true, false), true);
    assertEq(maskSensitiveValue(false, false), false);
});

test('null → 原样返回', () => {
    assertEq(maskSensitiveValue(null, false), null);
});

test('undefined → 原样返回', () => {
    assertEq(maskSensitiveValue(undefined, false), undefined);
});

test('object → 返回 [redacted]', () => {
    assertEq(maskSensitiveValue({ password: 'secret' }, false), '[redacted]');
    assertEq(maskSensitiveValue([1, 2, 3], false), '[redacted]');
});

// ────────────────────────────────────────────────
// redactConfig 测试
// ────────────────────────────────────────────────

console.log('\n⚙️  redactConfig 测试');

test('showSecrets=true → 原样返回', () => {
    const config = { apiKey: 'secret-key', name: 'test' };
    const result = redactConfig(config, { showSecrets: true });
    assertEq(result.apiKey, 'secret-key');
    assertEq(result.name, 'test');
});

test('默认 showSecrets=false → apiKey 被脱敏', () => {
    const config = { apiKey: 'sk-1234567890abcdef', model: 'gpt-4' };
    const result = redactConfig(config);
    if (result.apiKey === 'sk-1234567890abcdef') throw new Error('apiKey should be redacted');
    assertEq(result.model, 'gpt-4');
});

test('apiKey 大小写不敏感', () => {
    const r1 = redactConfig({ apikey: 'secret', model: 'gpt-4' }, { showSecrets: false });
    const r2 = redactConfig({ APIKEY: 'secret', model: 'gpt-4' }, { showSecrets: false });
    const r3 = redactConfig({ ApiKey: 'secret', model: 'gpt-4' }, { showSecrets: false });
    if (r1.apikey === 'secret') throw new Error('lowercase apikey should be redacted');
    if (r2['APIKEY'] === 'secret') throw new Error('uppercase APIKEY should be redacted');
    if (r3['ApiKey'] === 'secret') throw new Error('mixed case ApiKey should be redacted');
});

test('apiSecret 也被脱敏', () => {
    const config = { apiSecret: 'my-secret-value', model: 'gpt-4' };
    const result = redactConfig(config, { showSecrets: false });
    if (result.apiSecret === 'my-secret-value') throw new Error('apiSecret should be redacted');
});

test('key 字段也被脱敏', () => {
    const config = { key: 'secret-key-value', model: 'gpt-4' };
    const result = redactConfig(config, { showSecrets: false });
    if (result.key === 'secret-key-value') throw new Error('key should be redacted');
});

test('非敏感字段不变', () => {
    const config = { apiKey: 'secret', model: 'gpt-4', maxTokens: 4096, debug: true };
    const result = redactConfig(config, { showSecrets: false });
    assertEq(result.model, 'gpt-4');
    assertEq(result.maxTokens, 4096);
    assertEq(result.debug, true);
});

test('返回新对象（不修改原对象）', () => {
    const config = { apiKey: 'secret', model: 'gpt-4' };
    const originalKey = config.apiKey;
    redactConfig(config, { showSecrets: false });
    assertEq(config.apiKey, originalKey);
});

test('空对象', () => {
    const config = {};
    const result = redactConfig(config, { showSecrets: false });
    assertEq(Object.keys(result).length, 0);
});

test('redactConfig 默认 showSecrets=false', () => {
    const config = { apiKey: 'secret' };
    const result = redactConfig(config);
    if (result.apiKey === 'secret') throw new Error('default should redact');
});

test('含多个敏感字段', () => {
    const config = {
        apiKey: 'key-value',
        apiSecret: 'secret-value',
        key: 'key-value-2',
        token: 'should-not-redact',
    };
    const result = redactConfig(config, { showSecrets: false });
    if (result.apiKey === 'key-value') throw new Error('apiKey should be redacted');
    if (result.apiSecret === 'secret-value') throw new Error('apiSecret should be redacted');
    if (result.key === 'key-value-2') throw new Error('key should be redacted');
    assertEq(result.token, 'should-not-redact');
});

// ────────────────────────────────────────────────
// 边界情况
// ────────────────────────────────────────────────

console.log('\n🔬 边界情况测试');

test('redactApiKey 超长 key', () => {
    const longKey = 'sk-' + 'a'.repeat(1000);
    const r = redactApiKey(longKey, false);
    if (!r.includes('…')) throw new Error('long key should have ellipsis');
    assertEq(r.slice(0, 6), 'sk-aaa');
});

test('redactConfig 含所有敏感 key 大小写变体', () => {
    const config = {
        apiKey: 'a', APIKEY: 'b', ApiKey: 'c',
        apiSecret: 'd', APISECRET: 'e',
        key: 'f', KEY: 'g',
    };
    const result = redactConfig(config, { showSecrets: false });
    if (result.apiKey === 'a') throw new Error('apiKey should be redacted');
    if (result['APIKEY'] === 'b') throw new Error('APIKEY should be redacted');
    if (result['ApiKey'] === 'c') throw new Error('ApiKey should be redacted');
    if (result.apiSecret === 'd') throw new Error('apiSecret should be redacted');
    if (result['APISECRET'] === 'e') throw new Error('APISECRET should be redacted');
    if (result.key === 'f') throw new Error('key should be redacted');
    if (result['KEY'] === 'g') throw new Error('KEY should be redacted');
});

// ────────────────────────────────────────────────
// 汇总
// ────────────────────────────────────────────────

const total = passed + failed;
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed > 0) {
    console.log(`  ❌ 失败: ${failed}  ✅ 通过: ${passed}  📊 总计: ${total}`);
    console.log('\n失败详情:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
} else {
    console.log(`  ✅ 通过: ${passed}  📊 总计: ${total}`);
    console.log('\n🎉 所有测试通过！');
    process.exit(0);
}
