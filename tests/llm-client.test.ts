/**
 * llm-client.test.ts - LLM 客户端层测试
 *
 * 测试范围：
 *  - MockLLMClient: 聊天/流式/健康检查/关键词匹配
 *  - createLLMClient: 自动检测 Provider / 显式指定
 *  - detectProvider: 环境变量检测逻辑
 *  - 类型系统: ILLMClient 接口合规
 */

import { MockLLMClient } from '../src/llm/mock-client.js';
import { createLLMClient, detectProvider } from '../src/llm/client-factory.js';
import type { ILLMClient, ChatResponse } from '../src/llm/types.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(a: T, b: T): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
}

function assertContains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) throw new Error(`"${haystack}" 中未找到 "${needle}"`);
}

async function main() {
  console.log('\n=== LLM 客户端层测试 ===\n');

  // ============================================================
  //  模块导入
  // ============================================================

  testCount++;
  try {
    assert(typeof MockLLMClient === 'function', 'MockLLMClient 应存在');
    assert(typeof createLLMClient === 'function', 'createLLMClient 应存在');
    assert(typeof detectProvider === 'function', 'detectProvider 应存在');
    passCount++;
    console.log('  ✅ 模块导入');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 模块导入: ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - 实例化
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    assert(client !== null, 'MockLLMClient 实例化');
    passCount++;
    console.log('  ✅ MockLLMClient 实例化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient 实例化: ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - healthCheck
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const healthy = await client.healthCheck();
    assert(healthy === true, 'Mock 应始终健康');
    passCount++;
    console.log('  ✅ MockLLMClient healthCheck');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient healthCheck: ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chat（你好）
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const resp = await client.chat([{ role: 'user', content: '你好' }]);
    assert(resp.content.includes('你好'), '应包含问候语');
    assert(resp.finishReason === 'stop', 'finishReason 应为 stop');
    assert(resp.usage !== undefined, '应有 usage 信息');
    assert(resp.model === 'mock-model-v1', 'model 应为 mock-model-v1');
    passCount++;
    console.log('  ✅ MockLLMClient chat(你好)');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chat(你好): ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chat（天气）
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const resp = await client.chat([{ role: 'user', content: '今天天气怎么样？' }]);
    assertContains(resp.content, '天气');
    passCount++;
    console.log('  ✅ MockLLMClient chat(天气)');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chat(天气): ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chat（帮助）
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const resp = await client.chat([{ role: 'user', content: '请帮助我' }]);
    assertContains(resp.content, 'SmartAgent');
    passCount++;
    console.log('  ✅ MockLLMClient chat(帮助)');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chat(帮助): ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chat（未知消息→默认回复）
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const resp = await client.chat([{ role: 'user', content: '随便说点什么' }]);
    assertContains(resp.content, 'Mock');
    passCount++;
    console.log('  ✅ MockLLMClient chat(默认回复)');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chat(默认回复): ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chat（空消息）
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const resp = await client.chat([]);
    assert(typeof resp.content === 'string', '应返回字符串');
    assert(resp.finishReason === 'stop', 'finishReason 应为 stop');
    passCount++;
    console.log('  ✅ MockLLMClient chat(空消息)');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chat(空消息): ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chatStream
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    let fullText = '';
    for await (const chunk of client.chatStream([{ role: 'user', content: '你好' }])) {
      fullText += chunk;
    }
    assertContains(fullText, '你好');
    passCount++;
    console.log('  ✅ MockLLMClient chatStream');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chatStream: ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - chatStream 逐字输出
  // ============================================================

  testCount++;
  try {
    const client = new MockLLMClient();
    const chars: string[] = [];
    for await (const chunk of client.chatStream([{ role: 'user', content: '你好' }])) {
      chars.push(chunk);
    }
    assert(chars.length > 1, `流式应有多个 chunk，实际 ${chars.length} 个`);
    passCount++;
    console.log('  ✅ MockLLMClient chatStream 逐字输出');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient chatStream 逐字输出: ${(e as Error).message}`);
  }

  // ============================================================
  //  MockLLMClient - ILLMClient 接口合规
  // ============================================================

  testCount++;
  try {
    const client: ILLMClient = new MockLLMClient();
    assert(typeof client.chat === 'function', 'chat 方法');
    assert(typeof client.chatStream === 'function', 'chatStream 方法');
    assert(typeof client.healthCheck === 'function', 'healthCheck 方法');
    passCount++;
    console.log('  ✅ MockLLMClient ILLMClient 接口合规');
  } catch (e) {
    failCount++;
    console.log(`  ❌ MockLLMClient ILLMClient 接口合规: ${(e as Error).message}`);
  }

  // ============================================================
  //  createLLMClient - Mock Provider（无环境变量时默认）
  // ============================================================

  testCount++;
  try {
    // 确保环境变量干净
    const origDk = process.env.DEEPSEEK_API_KEY;
    const origOpenAI = process.env.OPENAI_API_KEY;
    const origOllama = process.env.OLLAMA_HOST;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;

    const client = await createLLMClient({ provider: 'mock' });
    assert(await client.healthCheck(), 'Mock 应健康');

    // 恢复
    if (origDk) process.env.DEEPSEEK_API_KEY = origDk;
    if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;

    passCount++;
    console.log('  ✅ createLLMClient Mock Provider');
  } catch (e) {
    failCount++;
    console.log(`  ❌ createLLMClient Mock Provider: ${(e as Error).message}`);
  }

  // ============================================================
  //  createLLMClient - 显式指定 DeepSeek Provider
  // ============================================================

  testCount++;
  try {
    const client = await createLLMClient({
      provider: 'deepseek',
      apiKey: 'sk-test-key',
    });
    assert(client !== null, '应创建 DeepSeekClient');
    passCount++;
    console.log('  ✅ createLLMClient DeepSeek Provider');
  } catch (e) {
    failCount++;
    console.log(`  ❌ createLLMClient DeepSeek Provider: ${(e as Error).message}`);
  }

  // ============================================================
  //  createLLMClient - 显式指定 OpenAI Provider
  // ============================================================

  testCount++;
  try {
    const client = await createLLMClient({
      provider: 'openai',
      apiKey: 'sk-test-key',
    });
    assert(client !== null, '应创建 OpenAIClient');
    passCount++;
    console.log('  ✅ createLLMClient OpenAI Provider');
  } catch (e) {
    failCount++;
    console.log(`  ❌ createLLMClient OpenAI Provider: ${(e as Error).message}`);
  }

  // ============================================================
  //  createLLMClient - 显式指定 Ollama Provider
  // ============================================================

  testCount++;
  try {
    const client = await createLLMClient({ provider: 'ollama', model: 'test-model' });
    assert(client !== null, '应创建 OllamaClient');
    passCount++;
    console.log('  ✅ createLLMClient Ollama Provider');
  } catch (e) {
    failCount++;
    console.log(`  ❌ createLLMClient Ollama Provider: ${(e as Error).message}`);
  }

  // ============================================================
  //  detectProvider - DEEPSEEK_API_KEY 优先
  // ============================================================

  testCount++;
  try {
    const origDk = process.env.DEEPSEEK_API_KEY;
    const origOpenAI = process.env.OPENAI_API_KEY;
    const origOllama = process.env.OLLAMA_HOST;

    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    process.env.DEEPSEEK_API_KEY = 'sk-test';

    const provider = detectProvider();
    assertEq(provider, 'deepseek');

    // 恢复
    process.env.DEEPSEEK_API_KEY = origDk ?? '';
    if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;
    if (!origDk) delete process.env.DEEPSEEK_API_KEY;

    passCount++;
    console.log('  ✅ detectProvider DeepSeek 优先');
  } catch (e) {
    failCount++;
    console.log(`  ❌ detectProvider DeepSeek 优先: ${(e as Error).message}`);
  }

  // ============================================================
  //  detectProvider - OPENAI_API_KEY 次优先
  // ============================================================

  testCount++;
  try {
    const origDk = process.env.DEEPSEEK_API_KEY;
    const origOpenAI = process.env.OPENAI_API_KEY;
    const origOllama = process.env.OLLAMA_HOST;

    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OLLAMA_HOST;
    process.env.OPENAI_API_KEY = 'sk-test';

    const provider = detectProvider();
    assertEq(provider, 'openai');

    // 恢复
    process.env.OPENAI_API_KEY = origOpenAI ?? '';
    if (origDk) process.env.DEEPSEEK_API_KEY = origDk;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;
    if (!origOpenAI) delete process.env.OPENAI_API_KEY;

    passCount++;
    console.log('  ✅ detectProvider OpenAI 次优先');
  } catch (e) {
    failCount++;
    console.log(`  ❌ detectProvider OpenAI 次优先: ${(e as Error).message}`);
  }

  // ============================================================
  //  detectProvider - Ollama 兜底
  // ============================================================

  testCount++;
  try {
    const origDk = process.env.DEEPSEEK_API_KEY;
    const origOpenAI = process.env.OPENAI_API_KEY;
    const origOllama = process.env.OLLAMA_HOST;

    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.OLLAMA_HOST = 'http://localhost:11434';

    const provider = detectProvider();
    assertEq(provider, 'ollama');

    // 恢复
    if (origDk) process.env.DEEPSEEK_API_KEY = origDk;
    if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
    if (!origOllama) delete process.env.OLLAMA_HOST;

    passCount++;
    console.log('  ✅ detectProvider Ollama 兜底');
  } catch (e) {
    failCount++;
    console.log(`  ❌ detectProvider Ollama 兜底: ${(e as Error).message}`);
  }

  // ============================================================
  //  detectProvider - 全无时 fallback Mock
  // ============================================================

  testCount++;
  try {
    const origDk = process.env.DEEPSEEK_API_KEY;
    const origOpenAI = process.env.OPENAI_API_KEY;
    const origOllama = process.env.OLLAMA_HOST;

    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;

    const provider = detectProvider();
    assertEq(provider, 'mock');

    // 恢复
    if (origDk) process.env.DEEPSEEK_API_KEY = origDk;
    if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;

    passCount++;
    console.log('  ✅ detectProvider Mock fallback');
  } catch (e) {
    failCount++;
    console.log(`  ❌ detectProvider Mock fallback: ${(e as Error).message}`);
  }

  // ============================================================
  //  结果
  // ============================================================

  console.log(`\n=== 结果: ${passCount}/${testCount} 通过, ${failCount} 失败 ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
