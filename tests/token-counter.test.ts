/**
 * token-counter.test.ts - Token 计数器测试
 *
 * 测试范围：
 *  - TokenCounter.count: 中文/英文/混合文本 / 空字符串
 *  - TokenCounter.countMessages: 多轮对话计数
 *  - TokenCounter.fitsInBudget: 预算判断
 *  - TokenCounter.truncateToBudget: 截断功能
 */

import { TokenCounter } from '../src/llm/token-counter.js';
import type { Message } from '../src/llm/types.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertGt(a: number, b: number, msg?: string): void {
  if (!(a > b)) throw new Error(msg ?? `期望 ${a} > ${b}`);
}

function assertLt(a: number, b: number, msg?: string): void {
  if (!(a < b)) throw new Error(msg ?? `期望 ${a} < ${b}`);
}

function assertBetween(val: number, lo: number, hi: number, msg?: string): void {
  if (!(val >= lo && val <= hi)) throw new Error(msg ?? `期望 ${val} 在 [${lo}, ${hi}] 之间`);
}

async function main() {
  console.log('\n=== Token 计数器测试 ===\n');

  // ============================================================
  //  TokenCounter 实例化
  // ============================================================

  testCount++;
  try {
    const counter = new TokenCounter();
    assert(counter instanceof TokenCounter, '应成功创建 TokenCounter');
    passCount++;
    console.log('  ✅ TokenCounter 实例化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ TokenCounter 实例化: ${(e as Error).message}`);
  }

  const counter = new TokenCounter();

  // ============================================================
  //  count - 空字符串
  // ============================================================

  testCount++;
  try {
    assert(counter.count('') === 0, '空字符串应为 0 Token');
    passCount++;
    console.log('  ✅ count 空字符串');
  } catch (e) {
    failCount++;
    console.log(`  ❌ count 空字符串: ${(e as Error).message}`);
  }

  // ============================================================
  //  count - 英文文本
  // ============================================================

  testCount++;
  try {
    const result = counter.count('Hello world');
    assertGt(result, 0, '英文文本应有 Token');
    assertLt(result, 10, '短英文文本 Token 应 < 10');
    passCount++;
    console.log(`  ✅ count 英文文本 (${result} tokens)`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ count 英文文本: ${(e as Error).message}`);
  }

  // ============================================================
  //  count - 中文文本
  // ============================================================

  testCount++;
  try {
    const result = counter.count('你好世界');
    assertGt(result, 4, '中文文本应有较多 Token');
    passCount++;
    console.log(`  ✅ count 中文文本 (${result} tokens)`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ count 中文文本: ${(e as Error).message}`);
  }

  // ============================================================
  //  count - 混合文本
  // ============================================================

  testCount++;
  try {
    const cn = counter.count('我爱编程');
    const en = counter.count('I love coding');
    // 中文每个字通常更多 Token
    assertGt(cn, en, `中文 Token(${cn}) 应多于英文 Token(${en})`);
    passCount++;
    console.log(`  ✅ count 中英对比 (CN=${cn}, EN=${en})`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ count 中英对比: ${(e as Error).message}`);
  }

  // ============================================================
  //  countMessages - 单条消息
  // ============================================================

  testCount++;
  try {
    const messages: Message[] = [
      { role: 'user', content: '你好' },
    ];
    const total = counter.countMessages(messages);
    assertGt(total, 2, `单条消息应有开销 + 内容，实际 ${total}`);
    passCount++;
    console.log(`  ✅ countMessages 单条消息 (${total} tokens)`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ countMessages 单条消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  countMessages - 多轮对话
  // ============================================================

  testCount++;
  try {
    const messages: Message[] = [
      { role: 'system', content: '你是一个有用的助手' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮你的？' },
      { role: 'user', content: '介绍一下自己' },
    ];
    const total = counter.countMessages(messages);
    assertGt(total, 20, `多轮对话应有较多 Token，实际 ${total}`);
    passCount++;
    console.log(`  ✅ countMessages 多轮对话 (${total} tokens)`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ countMessages 多轮对话: ${(e as Error).message}`);
  }

  // ============================================================
  //  countMessages - 递增性
  // ============================================================

  testCount++;
  try {
    const a = counter.countMessages([
      { role: 'user', content: 'A' },
    ]);
    const b = counter.countMessages([
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'BBB' },
    ]);
    assert(b > a, `更长的对话应有更多 Token (${a} → ${b})`);
    passCount++;
    console.log('  ✅ countMessages 递增性');
  } catch (e) {
    failCount++;
    console.log(`  ❌ countMessages 递增性: ${(e as Error).message}`);
  }

  // ============================================================
  //  fitsInBudget - 在预算内
  // ============================================================

  testCount++;
  try {
    assert(counter.fitsInBudget('Hi', 100), '短文本应在 100 Token 预算内');
    passCount++;
    console.log('  ✅ fitsInBudget 在预算内');
  } catch (e) {
    failCount++;
    console.log(`  ❌ fitsInBudget 在预算内: ${(e as Error).message}`);
  }

  // ============================================================
  //  fitsInBudget - 超过预算
  // ============================================================

  testCount++;
  try {
    const longText = '你好世界'.repeat(100); // ~ 400 chars = ~ 800 tokens
    // 只用 10 Token 预算 → 肯定超
    assert(!counter.fitsInBudget(longText, 10), '长文本不应在 10 Token 预算内');
    passCount++;
    console.log('  ✅ fitsInBudget 超过预算');
  } catch (e) {
    failCount++;
    console.log(`  ❌ fitsInBudget 超过预算: ${(e as Error).message}`);
  }

  // ============================================================
  //  truncateToBudget - 截断
  // ============================================================

  testCount++;
  try {
    const text = '这是需要被截断的长文本'.repeat(20);
    const truncated = counter.truncateToBudget(text, 50);
    assert(truncated.length < text.length, '应被截断');
    assert(counter.fitsInBudget(truncated, 50), '截断后应在预算内');
    passCount++;
    console.log('  ✅ truncateToBudget');
  } catch (e) {
    failCount++;
    console.log(`  ❌ truncateToBudget: ${(e as Error).message}`);
  }

  // ============================================================
  //  truncateToBudget - 空文本
  // ============================================================

  testCount++;
  try {
    assert(counter.truncateToBudget('', 100) === '', '空文本截断仍为空');
    assert(counter.truncateToBudget('hello', 0) === '', '0 Token 截断应为空');
    passCount++;
    console.log('  ✅ truncateToBudget 边界');
  } catch (e) {
    failCount++;
    console.log(`  ❌ truncateToBudget 边界: ${(e as Error).message}`);
  }

  // ============================================================
  //  count - 同文本相同计数（确定性）
  // ============================================================

  testCount++;
  try {
    const a = counter.count('测试文本');
    const b = counter.count('测试文本');
    assert(a === b, `相同文本应有相同计数 (${a} vs ${b})`);
    passCount++;
    console.log('  ✅ count 确定性');
  } catch (e) {
    failCount++;
    console.log(`  ❌ count 确定性: ${(e as Error).message}`);
  }

  // ============================================================
  //  countMessages - 空列表
  // ============================================================

  testCount++;
  try {
    const total = counter.countMessages([]);
    assertGt(total, 0, '即使空消息列表也有请求开销');
    assertLt(total, 5, '空消息开销不应太大');
    passCount++;
    console.log(`  ✅ countMessages 空列表 (${total} tokens)`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ countMessages 空列表: ${(e as Error).message}`);
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
