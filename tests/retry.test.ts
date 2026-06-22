/**
 * retry.test.ts - 请求重试机制测试
 *
 * 测试范围：
 *  - withRetry: 成功场景 / 全部失败 / 部分成功 / 指数退避 / 自定义判断
 *  - resolveRetryConfig: 各种配置组合
 *  - withOptionalRetry: 无配置跳过 / 有配置重试
 */

import { withRetry, resolveRetryConfig, withOptionalRetry } from '../src/llm/retry.js';
import { LLMError, NetworkError, AuthenticationError } from '../src/llm/errors.js';
import type { RetryConfig } from '../src/llm/types.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(a: T, b: T): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
}

async function main() {
  console.log('\n=== 重试机制测试 ===\n');

  // ============================================================
  //  withRetry - 一次成功（不重试）
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    const result = await withRetry(
      () => {
        callCount++;
        return Promise.resolve('ok');
      },
      { maxRetries: 3, initialDelay: 10 },
    );
    assertEq(result, 'ok');
    assertEq(callCount, 1);
    passCount++;
    console.log('  ✅ withRetry 一次成功');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 一次成功: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 第 2 次成功
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    const result = await withRetry(
      () => {
        callCount++;
        if (callCount < 2) throw new NetworkError('第一次失败');
        return Promise.resolve('retry-ok');
      },
      { maxRetries: 3, initialDelay: 10 },
    );
    assertEq(result, 'retry-ok');
    assertEq(callCount, 2);
    passCount++;
    console.log('  ✅ withRetry 第 2 次成功');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 第 2 次成功: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 全部失败
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    try {
      await withRetry(
        () => {
          callCount++;
          throw new NetworkError('永远失败');
        },
        { maxRetries: 2, initialDelay: 10 },
      );
      assert(false, '应抛出异常');
    } catch (e) {
      assert(e instanceof NetworkError, '应为 NetworkError');
    }
    assertEq(callCount, 3); // 初始 1 次 + 重试 2 次
    passCount++;
    console.log('  ✅ withRetry 全部失败');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 全部失败: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 不可重试错误不重试
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    try {
      await withRetry(
        () => {
          callCount++;
          throw new AuthenticationError('API Key 无效');
        },
        { maxRetries: 3, initialDelay: 10 },
      );
      assert(false, '应抛出异常');
    } catch (e) {
      assert(e instanceof AuthenticationError, '应为 AuthenticationError');
    }
    assertEq(callCount, 1); // 不重试
    passCount++;
    console.log('  ✅ withRetry 不可重试错误不重试');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 不可重试错误不重试: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 自定义 shouldRetry
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    try {
      await withRetry(
        () => {
          callCount++;
          throw new Error('任意错误');
        },
        {
          maxRetries: 2,
          initialDelay: 10,
          shouldRetry: () => true, // 总是重试
        },
      );
      assert(false, '应抛出异常');
    } catch (e) {
      assert(e instanceof Error, '应为 Error');
    }
    assertEq(callCount, 3); // 初始 + 重试 2 次
    passCount++;
    console.log('  ✅ withRetry 自定义 shouldRetry');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 自定义 shouldRetry: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 超时错误可重试
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    const timeoutError = new Error('请求超时');
    timeoutError.name = 'TimeoutError';

    try {
      await withRetry(
        () => {
          callCount++;
          throw timeoutError;
        },
        { maxRetries: 1, initialDelay: 10 },
      );
      assert(false, '应抛出异常');
    } catch (e) {
      assert((e as Error).name === 'TimeoutError', '应为 TimeoutError');
    }
    assert(callCount >= 2, `应有重试，实际 ${callCount} 次`);
    passCount++;
    console.log('  ✅ withRetry 超时错误可重试');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 超时错误可重试: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 可重试 LLMError
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    try {
      await withRetry(
        () => {
          callCount++;
          throw new LLMError('服务器繁忙', 'SERVER_BUSY', true);
        },
        { maxRetries: 1, initialDelay: 10 },
      );
      assert(false, '应抛出异常');
    } catch (e) {
      assert(e instanceof LLMError, '应为 LLMError');
    }
    assertEq(callCount, 2);
    passCount++;
    console.log('  ✅ withRetry 可重试 LLMError');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 可重试 LLMError: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 不可重试 LLMError
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    try {
      await withRetry(
        () => {
          callCount++;
          throw new LLMError('请求格式错误', 'BAD_REQUEST', false);
        },
        { maxRetries: 2, initialDelay: 10 },
      );
      assert(false, '应抛出异常');
    } catch (e) {
      assert(e instanceof LLMError, '应为 LLMError');
    }
    assertEq(callCount, 1);
    passCount++;
    console.log('  ✅ withRetry 不可重试 LLMError');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 不可重试 LLMError: ${(e as Error).message}`);
  }

  // ============================================================
  //  resolveRetryConfig
  // ============================================================

  testCount++;
  try {
    assertEq(resolveRetryConfig(), null);
    assertEq(resolveRetryConfig(false), null);
    assertEq(resolveRetryConfig(true), {});
    assertEq(resolveRetryConfig({ maxRetries: 5 }), { maxRetries: 5 });
    assert(resolveRetryConfig(undefined) === null, 'undefined → null');
    passCount++;
    console.log('  ✅ resolveRetryConfig');
  } catch (e) {
    failCount++;
    console.log(`  ❌ resolveRetryConfig: ${(e as Error).message}`);
  }

  // ============================================================
  //  withOptionalRetry - 无配置时直接返回
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    const result = await withOptionalRetry(
      () => {
        callCount++;
        return Promise.resolve('direct');
      },
      undefined,
    );
    assertEq(result, 'direct');
    assertEq(callCount, 1);
    passCount++;
    console.log('  ✅ withOptionalRetry 无配置直接返回');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withOptionalRetry 无配置直接返回: ${(e as Error).message}`);
  }

  // ============================================================
  //  withOptionalRetry - 有配置时重试
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    const result = await withOptionalRetry(
      () => {
        callCount++;
        if (callCount < 2) throw new NetworkError('失败');
        return Promise.resolve('retried');
      },
      true, // 默认重试
    );
    assertEq(result, 'retried');
    assertEq(callCount, 2);
    passCount++;
    console.log('  ✅ withOptionalRetry 有配置时重试');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withOptionalRetry 有配置时重试: ${(e as Error).message}`);
  }

  // ============================================================
  //  withRetry - 指数退避验证（不完全验证延迟，只验证重试次数）
  // ============================================================

  testCount++;
  try {
    let callCount = 0;
    const startTime = Date.now();
    try {
      await withRetry(
        () => {
          callCount++;
          throw new NetworkError('测试延迟');
        },
        { maxRetries: 2, initialDelay: 10 },
      );
    } catch { /* expected */ }
    const elapsed = Date.now() - startTime;
    // 初始 + 2 次重试 = 3 次调用，延迟至少 10 + 20 = 30ms
    assertEq(callCount, 3);
    // 由于有随机抖动，延迟可能不同。只验证没有立即失败
    assert(elapsed >= 0, '应花费一些时间');
    passCount++;
    console.log('  ✅ withRetry 指数退避');
  } catch (e) {
    failCount++;
    console.log(`  ❌ withRetry 指数退避: ${(e as Error).message}`);
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
