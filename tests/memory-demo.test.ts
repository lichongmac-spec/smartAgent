/**
 * memory-demo.test.ts — Memory 系统单元测试
 *
 * 覆盖：
 *  - 嵌入模型（MockEmbeddingModel）
 *  - 向量存储（VectorStore 增删查 + 余弦相似度）
 *  - 记忆管理器（MemoryManager 添加/检索/衰减/遗忘/更新重要性）
 */

import { MockEmbeddingModel } from '../src/memory/embedding.js';
import { VectorStore, cosineSimilarity } from '../src/memory/vector-store.js';
import { MemoryManager } from '../src/memory/memory-manager.js';

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(a: T, b: T, msg?: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg ?? `期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
  }
}

function assertGt(a: number, b: number, msg?: string): void {
  if (!(a > b)) throw new Error(msg ?? `期望 ${a} > ${b}`);
}

// ─────────────────────────────────────────────────────────
//  辅助：运行单个测试
// ─────────────────────────────────────────────────────────

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────
//  主入口
// ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== Memory 系统测试 ===\n');

  const embedder = new MockEmbeddingModel();

  // ── 测试 1: 嵌入模型基本功能 ──

  await test('embed 返回固定维度向量', async () => {
    const vec = await embedder.embed('hello');
    assertEq(vec.length, 128, '向量维度应为 128');
  });

  await test('embedBatch 批量嵌入', async () => {
    const vecs = await embedder.embedBatch(['a', 'b', 'c']);
    assertEq(vecs.length, 3, '应返回 3 个向量');
    assertEq(vecs[0].length, 128, '每个向量应为 128 维');
  });

  // ── 测试 2: 余弦相似度 ──

  await test('余弦相似度 — 相同向量为 1', async () => {
    const score = cosineSimilarity([1, 0, 0], [1, 0, 0]);
    assert(Math.abs(score - 1.0) < 0.0001, '相同向量相似度应为 1');
  });

  await test('余弦相似度 — 正交向量为 0', async () => {
    const score = cosineSimilarity([1, 0], [0, 1]);
    assert(Math.abs(score - 0) < 0.0001, '正交向量相似度应为 0');
  });

  await test('余弦相似度 — 零向量返回 0', async () => {
    const score = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    assertEq(score, 0, '零向量相似度应为 0');
  });

  // ── 测试 3: 向量存储增删查 ──

  await test('VectorStore add 返回唯一 ID', async () => {
    const store = new VectorStore();
    const id1 = store.add({ text: 'a', vector: [1, 0], timestamp: new Date(), importance: 0.5 });
    const id2 = store.add({ text: 'b', vector: [0, 1], timestamp: new Date(), importance: 0.5 });
    assert(id1 !== id2, 'ID 应唯一');
    assert(id1.startsWith('mem_'), 'ID 应以 mem_ 开头');
  });

  await test('VectorStore search 按相似度排序', async () => {
    const store = new VectorStore();
    store.add({ text: 'apple', vector: [1, 0, 0], timestamp: new Date(), importance: 0.5 });
    store.add({ text: 'banana', vector: [0, 1, 0], timestamp: new Date(), importance: 0.5 });
    store.add({ text: 'apricot', vector: [0.9, 0.1, 0], timestamp: new Date(), importance: 0.5 });

    const results = store.search([1, 0, 0], 2);
    assertEq(results.length, 2, '应返回 2 条结果');
    assertEq(results[0].text, 'apple', '最相似应为 apple');
  });

  await test('VectorStore search 阈值过滤', async () => {
    const store = new VectorStore();
    store.add({ text: 'near', vector: [1, 0], timestamp: new Date(), importance: 0.5 });
    store.add({ text: 'far', vector: [0, 1], timestamp: new Date(), importance: 0.5 });

    const results = store.search([1, 0], 10, 0.9);
    assertEq(results.length, 1, '只有 near 通过阈值');
    assertEq(results[0].text, 'near');
  });

  await test('VectorStore delete 按 ID 删除', async () => {
    const store = new VectorStore();
    const id = store.add({ text: 'x', vector: [1], timestamp: new Date(), importance: 0.5 });
    assertEq(store.size, 1);
    const deleted = store.delete(id);
    assert(deleted, '删除应成功');
    assertEq(store.size, 0);
    const again = store.delete(id);
    assert(!again, '重复删除应返回 false');
  });

  await test('VectorStore clear 清空', async () => {
    const store = new VectorStore();
    store.add({ text: 'a', vector: [1], timestamp: new Date(), importance: 0.5 });
    store.add({ text: 'b', vector: [1], timestamp: new Date(), importance: 0.5 });
    store.clear();
    assertEq(store.size, 0);
  });

  // ── 测试 4: 记忆管理器 — 添加与检索 ──

  await test('addMemory 添加并检索', async () => {
    const m = new MemoryManager(embedder, { defaultK: 10, similarityThreshold: 0.0 });
    await m.addMemory('我喜欢吃苹果', 0.8);
    await m.addMemory('我讨厌吃香蕉', 0.2);
    await m.addMemory('我喜欢编程', 0.9);

    const results = await m.retrieve('喜欢');
    assertGt(results.length, 0, '应检索到至少一条记忆');
    const texts = results.map((r) => r.text);
    assert(texts.some((t) => t.includes('苹果')), '应包含苹果记忆');
    assert(texts.some((t) => t.includes('编程')), '应包含编程记忆');
  });

  await test('addMemory 限制重要性范围', async () => {
    const m = new MemoryManager(embedder);
    await m.addMemory('test', 1.5); // 应被限制为 1
    const all = m.getStore().getAll();
    assertEq(all[0].importance, 1, '重要性应限制为 1');
  });

  // ── 测试 5: 衰减与遗忘 ──

  await test('forget 衰减后遗忘过期记忆', async () => {
    const m = new MemoryManager(embedder, {
      decayRate: 0.5,       // 快速衰减
      forgetThreshold: 0.3,
      autoForget: false,
    });
    const id = await m.addMemory('临时记忆', 0.5);

    // 手动将时间戳改为 2 天前
    const mem = m.getStore().getById(id);
    assert(mem !== undefined, '记忆应存在');
    (mem as Record<string, unknown>).timestamp = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000,
    );

    // 衰减后重要性 = 0.5 × (1-0.5)² = 0.125 < 0.3 → 应被遗忘
    const forgotten = m.forget();
    assert(forgotten.includes(id), '该记忆应被遗忘');
    assert(!m.getStore().getById(id), '存储中不应再有该记忆');
  });

  await test('forget 保留高重要性记忆', async () => {
    const m = new MemoryManager(embedder, {
      decayRate: 0.1,
      forgetThreshold: 0.05,
      autoForget: false,
    });
    const id = await m.addMemory('重要记忆', 0.9);

    // 设为 10 天前
    const mem = m.getStore().getById(id);
    assert(mem !== undefined);
    (mem as Record<string, unknown>).timestamp = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    );

    // 衰减后 = 0.9 × 0.9^10 ≈ 0.313 > 0.05 → 保留
    const forgotten = m.forget();
    assert(!forgotten.includes(id), '重要记忆不应被遗忘');
    assert(m.getStore().getById(id) !== undefined);
  });

  // ── 测试 6: 更新重要性 ──

  await test('updateImportance 更新记忆重要性', async () => {
    const m = new MemoryManager(embedder);
    const id = await m.addMemory('重要知识', 0.3);
    const updated = m.updateImportance(id, 0.9);
    assert(updated, '更新应成功');
    const mem = m.getStore().getById(id);
    assertEq(mem?.importance, 0.9, '重要性应更新为 0.9');
  });

  await test('updateImportance 不存在的 ID 返回 false', async () => {
    const m = new MemoryManager(embedder);
    const ok = m.updateImportance('nonexistent', 0.5);
    assert(!ok, '不存在的 ID 应返回 false');
  });

  // ── 测试 7: 统计 ──

  await test('stats 返回正确统计', async () => {
    const m = new MemoryManager(embedder, { autoForget: false });
    await m.addMemory('记忆1', 0.5);
    await m.addMemory('记忆2', 0.7);

    const s = m.stats();
    assertEq(s.total, 2);
    assertGt(s.avgImportance, 0.5);
    assert(s.newest instanceof Date);
    assert(s.oldest instanceof Date);
  });

  // ── 测试 8: 空状态处理 ──

  await test('空 store 检索返回空数组', async () => {
    const m = new MemoryManager(embedder);
    const results = await m.retrieve('test');
    assertEq(results.length, 0);
  });

  await test('空 store 统计', async () => {
    const m = new MemoryManager(embedder);
    const s = m.stats();
    assertEq(s.total, 0);
    assertEq(s.oldest, null);
    assertEq(s.newest, null);
  });

  // ── 测试 9: clear ──

  await test('clear 清空所有记忆', async () => {
    const m = new MemoryManager(embedder, { autoForget: false });
    await m.addMemory('a', 0.5);
    await m.addMemory('b', 0.5);
    m.clear();
    assertEq(m.getStore().size, 0);
  });

  // ── 结果汇总 ──
  console.log('\n' + '━'.repeat(60));
  console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`);
  if (failCount === 0) {
    console.log('🎉 所有测试通过！\n');
  } else {
    console.log('❌ 存在失败测试\n');
    process.exit(1);
  }
}

main();
