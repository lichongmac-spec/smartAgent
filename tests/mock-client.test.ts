/**
 * mock-client.test.ts - Mock 客户端专项测试
 *
 * 测试关键词匹配覆盖率和响应格式
 *
 * 运行: node tests/test.ts --only unit
 */

import { MockLLMClient } from '../src/llm/mock-client.js';
import type { ILLMClient } from '../src/llm/types.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertContains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) throw new Error(`"${haystack}" 中未找到 "${needle}"`);
}

async function main() {
  console.log('\n=== Mock 客户端测试 ===\n');

  const client = new MockLLMClient();

  // ============================================================
  //  关键词匹配
  // ============================================================

  const keywords: Array<{ input: string; expected: string }> = [
    { input: '你好，你是谁？', expected: 'Mock 模式' },
    { input: 'Hello, how are you?', expected: 'Mock 模式' },
    { input: '今天天气如何？', expected: '天气' },
    { input: 'weather forecast please', expected: '天气' },
    { input: '帮我写一段代码', expected: '代码' },
    { input: 'code review please', expected: '代码' },
    { input: '请帮助我', expected: 'SmartAgent' },
    { input: 'help me please', expected: 'SmartAgent' },
    { input: '打开一个文件', expected: '文件' },
    { input: 'read this file', expected: '文件' },
    { input: '有什么工具可用？', expected: '工具' },
    { input: 'list tools', expected: '工具' },
    { input: '随便说点什么', expected: 'Mock 客户端' },
  ];

  for (const { input, expected } of keywords) {
    testCount++;
    try {
      const resp = await client.chat([{ role: 'user', content: input }]);
      assertContains(resp.content, expected);
      passCount++;
      console.log(`  ✅ 关键词 "${input.slice(0, 20)}" → "${expected}"`);
    } catch (e) {
      failCount++;
      console.log(`  ❌ 关键词 "${input}": ${(e as Error).message}`);
    }
  }

  // ============================================================
  //  响应格式
  // ============================================================

  testCount++;
  try {
    const resp = await client.chat([{ role: 'user', content: '你好' }]);
    assert(resp.finishReason === 'stop', 'finishReason 应为 stop');
    assert(resp.model === 'mock-model-v1', 'model 应为 mock-model-v1');
    assert(resp.usage !== undefined, '应有 usage');
    assert(typeof resp.content === 'string', 'content 应为 string');
    passCount++;
    console.log('  ✅ 响应格式完整');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 响应格式完整: ${(e as Error).message}`);
  }

  // 15. 流式输出格式
  testCount++;
  try {
    const tokens: string[] = [];
    for await (const token of client.chatStream([
      { role: 'user', content: '你好' },
    ])) {
      tokens.push(token);
      assert(token.length === 1, `每个 token 应为单字符，实际: "${token}"`);
    }
    assert(tokens.length > 0, '应有输出');
    assertContains(tokens.join(''), 'Mock');
    passCount++;
    console.log('  ✅ 流式输出格式');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 流式输出格式: ${(e as Error).message}`);
  }

  // 16. 空消息处理
  testCount++;
  try {
    const resp = await client.chat([]);
    assert(typeof resp.content === 'string', '空消息应有回复');
    assert(resp.finishReason === 'stop', 'finishReason');
    passCount++;
    console.log('  ✅ 空消息处理');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 空消息处理: ${(e as Error).message}`);
  }

  // 17. 多轮消息
  testCount++;
  try {
    const resp = await client.chat([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮助你的？' },
      { role: 'user', content: '天气怎么样？' },
    ]);
    assertContains(resp.content, '天气');
    passCount++;
    console.log('  ✅ 多轮消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 多轮消息: ${(e as Error).message}`);
  }

  // 18. listModels
  testCount++;
  try {
    const models = await client.listModels();
    assert(Array.isArray(models), '应返回数组');
    assert(models.length >= 1, '至少一个模型');
    assert(models.includes('mock-model-v1'), '包含主模型');
    assert(models.includes('mock-embed-v1'), '包含嵌入模型');
    passCount++;
    console.log('  ✅ listModels');
  } catch (e) {
    failCount++;
    console.log(`  ❌ listModels: ${(e as Error).message}`);
  }

  // 19. embed
  testCount++;
  try {
    const vec = await client.embed('测试');
    assert(Array.isArray(vec), '应返回数组');
    assert(vec.length === 768, `维度应为 768，实际 ${vec.length}`);

    // 相同文本相同向量
    const vec2 = await client.embed('测试');
    assert(
      vec.every((v, i) => Math.abs(v - vec2[i]) < 1e-6),
      '相同文本应有相同嵌入',
    );

    // 不同文本不同向量
    const vec3 = await client.embed('不同的文本');
    const isDifferent = vec.some((v, i) => Math.abs(v - vec3[i]) > 1e-6);
    assert(isDifferent, '不同文本应有不同嵌入');

    passCount++;
    console.log('  ✅ embed');
  } catch (e) {
    failCount++;
    console.log(`  ❌ embed: ${(e as Error).message}`);
  }

  // 20. chat 带 timeout 选项
  testCount++;
  try {
    const resp = await client.chat(
      [{ role: 'user', content: '你好' }],
      { timeout: 30000 },
    );
    assertContains(resp.content, '你好');
    passCount++;
    console.log('  ✅ chat + timeout 选项');
  } catch (e) {
    failCount++;
    console.log(`  ❌ chat + timeout 选项: ${(e as Error).message}`);
  }

  // ============================================================
  //  结果汇总
  // ============================================================

  console.log(`\n=== Mock 客户端测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败 ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
