/**
 * ollama-client.test.ts - Ollama 客户端测试
 *
 * 当 Ollama 未运行时，跳过的测试会标记为 ⏭️
 *
 * 运行: node tests/test.ts --only unit  或直接 node --loader ts-node/esm tests/ollama-client.test.ts
 */

import { OllamaClient } from '../src/agent/llm/ollama-client.js';
import type { ILLMClient } from '../src/agent/llm/types.js';
import {
  LLMError,
  ModelUnavailableError,
  isRetryableError,
} from '../src/agent/llm/errors.js';

let passCount = 0;
let failCount = 0;
let skipCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n=== Ollama 客户端测试 ===\n');

  const running = await isOllamaRunning();

  if (!running) {
    console.log('  ⏭️ Ollama 服务未运行，将只运行离线测试\n');
  }

  // ============================================================
  //  离线测试（不需要 Ollama 运行）
  // ============================================================

  // 1. 实例化
  testCount++;
  try {
    const client = new OllamaClient({ model: 'test-model' });
    assert(client !== null, 'OllamaClient 实例化');
    passCount++;
    console.log('  ✅ 实例化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 实例化: ${(e as Error).message}`);
  }

  // 2. 默认配置
  testCount++;
  try {
    const client = new OllamaClient();
    assert(client !== null, '默认配置实例化');
    passCount++;
    console.log('  ✅ 默认配置');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 默认配置: ${(e as Error).message}`);
  }

  // 3. 自定义 host
  testCount++;
  try {
    const client = new OllamaClient({
      model: 'qwen',
      host: 'http://custom:9999',
    });
    assert(client !== null, '自定义 host 实例化');
    passCount++;
    console.log('  ✅ 自定义 host');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 自定义 host: ${(e as Error).message}`);
  }

  // 4. ILLMClient 接口合规
  testCount++;
  try {
    const client: ILLMClient = new OllamaClient();
    assert(typeof client.chat === 'function', 'chat 方法');
    assert(typeof client.chatStream === 'function', 'chatStream 方法');
    assert(typeof client.healthCheck === 'function', 'healthCheck 方法');
    passCount++;
    console.log('  ✅ ILLMClient 接口合规');
  } catch (e) {
    failCount++;
    console.log(`  ❌ ILLMClient 接口合规: ${(e as Error).message}`);
  }

  // 5. healthCheck 返回 boolean
  testCount++;
  try {
    const client = new OllamaClient();
    const result = await client.healthCheck();
    assert(typeof result === 'boolean', 'healthCheck 应返回 boolean');
    passCount++;
    console.log('  ✅ healthCheck 返回类型');
  } catch (e) {
    failCount++;
    console.log(`  ❌ healthCheck 返回类型: ${(e as Error).message}`);
  }

  // 6. 错误类型基类
  testCount++;
  try {
    const err = new LLMError('test', 'TEST_CODE', true);
    assert(err.code === 'TEST_CODE', '错误码');
    assert(err.retryable === true, '可重试标记');
    assert(isRetryableError(err) === true, 'isRetryableError 检测');
    passCount++;
    console.log('  ✅ 错误类型');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 错误类型: ${(e as Error).message}`);
  }

  // 7. 超时模拟（不运行真 Ollama，测试错误处理路径）
  testCount++;
  try {
    const client = new OllamaClient({
      host: 'http://localhost:19999', // 不存在的端口
      timeout: 100,
    });
    try {
      await client.chat([{ role: 'user', content: 'hi' }]);
      failCount++;
      console.log('  ❌ 超时模拟（应抛出但未抛出）');
    } catch (err) {
      assert(err instanceof LLMError, `应抛出 LLMError，实际: ${err}`);
      passCount++;
      console.log('  ✅ 超时错误处理');
    }
  } catch (e) {
    failCount++;
    console.log(`  ❌ 超时错误处理: ${(e as Error).message}`);
  }

  // ============================================================
  //  在线测试（需要 Ollama 运行）
  // ============================================================

  if (running) {
    // 8. healthCheck
    testCount++;
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      const healthy = await client.healthCheck();
      assert(healthy === true, 'Ollama 应在线');
      passCount++;
      console.log('  ✅ healthCheck（在线）');
    } catch (e) {
      failCount++;
      console.log(`  ❌ healthCheck（在线）: ${(e as Error).message}`);
    }

    // 9. 普通对话
    testCount++;
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      const resp = await client.chat([
        { role: 'user', content: '用一句话介绍自己' },
      ]);
      assert(resp.content.length > 0, '应有回复内容');
      assert(resp.finishReason === 'stop' || resp.finishReason === 'length', 'finishReason');
      passCount++;
      console.log('  ✅ 普通对话');
    } catch (e) {
      failCount++;
      console.log(`  ❌ 普通对话: ${(e as Error).message}`);
    }

    // 10. 流式对话
    testCount++;
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      const tokens: string[] = [];
      for await (const chunk of client.chatStream([
        { role: 'user', content: '说一个字: 好' },
      ])) {
        tokens.push(chunk);
      }
      assert(tokens.length > 0, '应有流式输出');
      assert(tokens.join('').includes('好'), '应包含"好"字');
      passCount++;
      console.log('  ✅ 流式对话');
    } catch (e) {
      failCount++;
      console.log(`  ❌ 流式对话: ${(e as Error).message}`);
    }

    // 11. 系统提示词
    testCount++;
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      const resp = await client.chat(
        [{ role: 'user', content: '你是谁？' }],
        { systemPrompt: '你是一个国际象棋大师，回答需提及国际象棋' },
      );
      assert(resp.content.length > 0, '应有回复');
      passCount++;
      console.log('  ✅ 系统提示词');
    } catch (e) {
      failCount++;
      console.log(`  ❌ 系统提示词: ${(e as Error).message}`);
    }

    // 12. Token 统计
    testCount++;
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      const resp = await client.chat([
        { role: 'user', content: '1+1等于几？' },
      ]);
      assert(resp.usage !== undefined, '应有 usage');
      if (resp.usage) {
        assert(resp.usage.promptTokens > 0, 'promptTokens > 0');
        assert(resp.usage.completionTokens > 0, 'completionTokens > 0');
        assert(resp.usage.totalTokens > 0, 'totalTokens > 0');
      }
      passCount++;
      console.log('  ✅ Token 统计');
    } catch (e) {
      failCount++;
      console.log(`  ❌ Token 统计: ${(e as Error).message}`);
    }

    // 13. 模型不存在错误
    testCount++;
    try {
      const client = new OllamaClient({ model: 'nonexistent-model-xyz' });
      try {
        await client.chat([{ role: 'user', content: 'hello' }]);
        failCount++;
        console.log('  ❌ 模型不存在（应抛出但未抛出）');
      } catch (err) {
        assert(
          err instanceof ModelUnavailableError || err instanceof LLMError,
          `应抛出 LLMError，实际: ${err}`,
        );
        passCount++;
        console.log('  ✅ 模型不存在错误');
      }
    } catch (e) {
      failCount++;
      console.log(`  ❌ 模型不存在错误: ${(e as Error).message}`);
    }

    // 14. 长时间对话
    testCount++;
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      const resp = await client.chat([
        { role: 'user', content: '请列出3种编程语言' },
      ]);
      assert(resp.content.length > 10, '长回复应有足够内容');
      passCount++;
      console.log('  ✅ 多 Token 回复');
    } catch (e) {
      failCount++;
      console.log(`  ❌ 多 Token 回复: ${(e as Error).message}`);
    }
  } else {
    const onlineTests = ['healthCheck（在线）', '普通对话', '流式对话', '系统提示词', 'Token 统计', '模型不存在错误', '多 Token 回复'];
    skipCount += onlineTests.length;
    testCount += onlineTests.length;
    for (const name of onlineTests) {
      console.log(`  ⏭️ ${name}`);
    }
  }

  // ============================================================
  //  结果汇总
  // ============================================================

  console.log(`\n=== Ollama 客户端测试结果: ${passCount}/${testCount} 通过 (${skipCount}跳过), ${failCount} 失败 ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
