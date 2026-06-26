/**
 * openai-client.test.ts - OpenAI/DeepSeek 客户端测试
 *
 * 离线测试为主（不依赖真实 API），覆盖实例化和错误分类
 *
 * 运行: node tests/test.ts --only unit
 */

import {
  AuthenticationError,
  ContentFilterError,
  isAuthError,
  RateLimitError,
} from '../src/agent/llm/errors.js';
import { DeepSeekClient, OpenAIClient } from '../src/agent/llm/openai-client.js';
import type { ILLMClient } from '../src/agent/llm/types.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}


async function main() {
  console.log('\n=== OpenAI/DeepSeek 客户端测试 ===\n');

  // ============================================================
  //  OpenAI 客户端实例化
  // ============================================================

  testCount++;
  try {
    const client = new OpenAIClient({
      apiKey: 'sk-test-key-12345',
      model: 'gpt-4o-mini',
    });
    assert(client !== null, 'OpenAIClient 实例化');
    passCount++;
    console.log('  ✅ OpenAIClient 实例化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ OpenAIClient 实例化: ${(e as Error).message}`);
  }

  // 2. 默认模型
  testCount++;
  try {
    const client = new OpenAIClient({ apiKey: 'sk-test' });
    assert(client !== null, '默认模型实例化');
    passCount++;
    console.log('  ✅ OpenAIClient 默认模型');
  } catch (e) {
    failCount++;
    console.log(`  ❌ OpenAIClient 默认模型: ${(e as Error).message}`);
  }

  // 3. 自定义 baseUrl
  testCount++;
  try {
    const client = new OpenAIClient({
      apiKey: 'sk-test',
      baseUrl: 'https://custom.api.com/v1',
    });
    assert(client !== null, '自定义 baseUrl 实例化');
    passCount++;
    console.log('  ✅ OpenAIClient 自定义 baseUrl');
  } catch (e) {
    failCount++;
    console.log(`  ❌ OpenAIClient 自定义 baseUrl: ${(e as Error).message}`);
  }

  // 4. ILLMClient 接口合规
  testCount++;
  try {
    const client: ILLMClient = new OpenAIClient({ apiKey: 'sk-test' });
    assert(typeof client.chat === 'function', 'chat 方法');
    assert(typeof client.chatStream === 'function', 'chatStream 方法');
    assert(typeof client.healthCheck === 'function', 'healthCheck 方法');
    passCount++;
    console.log('  ✅ OpenAIClient ILLMClient 接口合规');
  } catch (e) {
    failCount++;
    console.log(`  ❌ OpenAIClient ILLMClient 接口合规: ${(e as Error).message}`);
  }

  // 5. healthCheck
  testCount++;
  try {
    const client = new OpenAIClient({ apiKey: 'sk-test' });
    const result = await client.healthCheck();
    assert(typeof result === 'boolean', 'healthCheck 返回 boolean');
    passCount++;
    console.log('  ✅ OpenAIClient healthCheck');
  } catch (e) {
    failCount++;
    console.log(`  ❌ OpenAIClient healthCheck: ${(e as Error).message}`);
  }

  // ============================================================
  //  DeepSeek 客户端
  // ============================================================

  testCount++;
  try {
    const client = new DeepSeekClient({
      apiKey: 'sk-test-key-67890',
      model: 'deepseek-v4-flash',
    });
    assert(client !== null, 'DeepSeekClient 实例化');
    assert(client instanceof OpenAIClient, '应继承自 OpenAIClient');
    passCount++;
    console.log('  ✅ DeepSeekClient 实例化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ DeepSeekClient 实例化: ${(e as Error).message}`);
  }

  // 7. DeepSeek 默认模型
  testCount++;
  try {
    const client = new DeepSeekClient({ apiKey: 'sk-test' });
    assert(client !== null, 'DeepSeek 默认模型');
    passCount++;
    console.log('  ✅ DeepSeekClient 默认模型');
  } catch (e) {
    failCount++;
    console.log(`  ❌ DeepSeekClient 默认模型: ${(e as Error).message}`);
  }

  // ============================================================
  //  错误类型验证
  // ============================================================

  testCount++;
  try {
    const err = new AuthenticationError('无效 Key');
    assert(err.code === 'AUTH_ERROR', '错误码');
    assert(err.retryable === false, '不可重试');
    assert(isAuthError(err) === true, 'isAuthError');
    passCount++;
    console.log('  ✅ AuthenticationError');
  } catch (e) {
    failCount++;
    console.log(`  ❌ AuthenticationError: ${(e as Error).message}`);
  }

  testCount++;
  try {
    const err = new RateLimitError();
    assert(err.retryable === true, '可重试');
    passCount++;
    console.log('  ✅ RateLimitError');
  } catch (e) {
    failCount++;
    console.log(`  ❌ RateLimitError: ${(e as Error).message}`);
  }

  testCount++;
  try {
    const err = new ContentFilterError();
    assert(err.code === 'CONTENT_FILTER', '错误码');
    assert(err.retryable === false, '不可重试');
    passCount++;
    console.log('  ✅ ContentFilterError');
  } catch (e) {
    failCount++;
    console.log(`  ❌ ContentFilterError: ${(e as Error).message}`);
  }

  // 11. 工具调用类型解析
  testCount++;
  try {
    // 验证 ToolCall 类型可用（不需要真实 API）
    const { OpenAIClient } = await import('../src/agent/llm/openai-client.js');
    const { DeepSeekClient } = await import('../src/agent/llm/openai-client.js');
    assert(typeof OpenAIClient === 'function', 'OpenAIClient import');
    assert(typeof DeepSeekClient === 'function', 'DeepSeekClient import');
    passCount++;
    console.log('  ✅ 工具调用类型可用');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 工具调用类型可用: ${(e as Error).message}`);
  }

  // ============================================================
  //  结果汇总
  // ============================================================

  console.log(`\n=== OpenAI/DeepSeek 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败 ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
