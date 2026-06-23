/**
 * memory/memory-demo.ts
 *
 * 演示程序：展示 Memory 系统的完整使用流程
 *
 * 运行方式：
 *   pnpm tsx src/memory/memory-demo.ts
 *
 * 演示内容：
 * 1. 创建记忆管理器（Mock 嵌入）
 * 2. 添加 5 条不同类型记忆
 * 3. 检索与问题相关的记忆
 * 4. 手动修改时间戳模拟衰减
 * 5. 执行遗忘并展示统计
 */

import { MemoryManager } from './memory-manager.js';
import { MockEmbeddingModel } from './embedding.js';

const SEP = '━'.repeat(60);

async function main(): Promise<void> {
  console.log('\n🧠 记忆系统演示');
  console.log(SEP);

  // ── 1. 选择嵌入模型 ──
  const embedder = new MockEmbeddingModel();
  console.log('✅ 使用嵌入模型:', embedder.constructor.name);

  // ── 2. 创建记忆管理器 ──
  const manager = new MemoryManager(embedder, {
    defaultK: 3,
    similarityThreshold: 0.25,
    decayRate: 0.02,
    forgetThreshold: 0.05,
    autoForget: true,
  });

  // ── 3. 添加记忆 ──
  console.log('\n📝 添加记忆...');
  await manager.addMemory('我的名字是小明，我喜欢编程和数学。', 0.9, { type: 'profile' });
  await manager.addMemory('我昨天去公园散步，天气很好。', 0.6, { type: 'activity' });
  await manager.addMemory('我正在学习 TypeScript，觉得很有趣。', 0.8, { type: 'learning' });
  await manager.addMemory('我的宠物猫叫咪咪，它很可爱。', 0.7, { type: 'pet' });
  await manager.addMemory('我最喜欢的电影是《星际穿越》。', 0.5, { type: 'entertainment' });

  console.log(`✅ 已添加 ${manager.getStore().size} 条记忆`);

  // ── 4. 检索测试 ──
  console.log('\n🔍 检索测试：');

  await searchAndPrint(manager, '我喜欢什么运动？');
  await searchAndPrint(manager, '我学了什么编程语言？');

  // ── 5. 模拟时间流逝（手动修改时间戳） ──
  console.log('\n⏳ 模拟两天后...');
  const allMem = manager.getStore().getAll();
  if (allMem.length > 0) {
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    // 仅演示 — 直接修改内部时间戳
    (allMem[0] as Record<string, unknown>).timestamp = oldDate;
  }

  // 执行遗忘
  const forgotten = manager.forget();
  console.log(`🧹 遗忘了 ${forgotten.length} 条记忆`);

  // 再次统计
  const stats = manager.stats();
  console.log('\n📊 当前记忆统计:');
  console.log(`  总数: ${stats.total}`);
  console.log(`  平均重要性: ${stats.avgImportance.toFixed(3)}`);
  console.log(`  最老记忆: ${stats.oldest?.toLocaleString() || '无'}`);
  console.log(`  最新记忆: ${stats.newest?.toLocaleString() || '无'}`);

  console.log(`\n🎉 演示完成！\n`);
}

async function searchAndPrint(manager: MemoryManager, query: string): Promise<void> {
  const results = await manager.retrieve(query);
  console.log(`  问题: "${query}"`);
  if (results.length === 0) {
    console.log('  → 未找到相关记忆。');
  } else {
    for (let i = 0; i < results.length; i++) {
      const mem = results[i];
      console.log(`  ${i + 1}. ${mem.text} (重要性: ${mem.importance.toFixed(2)})`);
    }
  }
  console.log();
}

main().catch((e) => {
  console.error('演示出错:', e);
  process.exit(1);
});
