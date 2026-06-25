/**
 * core/index.ts - Loop 引擎入口 + 交互式演示
 *
 * 运行方式（直接演示）：
 *   pnpm tsx src/core/index.ts
 *
 * 运行方式（带参数）：
 *   pnpm tsx src/core/index.ts "帮我计算 3 + 5 * 2"
 *
 * 参考文献：
 *   Yao, S., et al. (2022). "ReAct: Synergizing Reasoning and Acting
 *   in Language Models." arXiv:2210.03629.
 */

import { LoopEngine } from './loop-engine.js';
export { LoopEngine } from './loop-engine.js';
export type { LoopState, LoopConfig, StepRecord, LoopStatus, StepCallback } from './types.js';

import { createLLMClientSync } from '../llm/client-factory.js';
import { createDefaultToolRegistry } from '../tools/index.js';

// ============================================================
//  仅在直接运行时执行演示
// ============================================================

const isMainModule = process.argv[1]?.includes('core/index');

if (isMainModule) {
  main().catch(console.error);
}

async function main() {
  console.log('━'.repeat(60));
  console.log('🔄 ReAct Loop 引擎演示');
  console.log('📖 基于 ReAct 论文: arXiv:2210.03629');
  console.log('━'.repeat(60));

  // ============================================================
  //  1. 初始化 LLM 客户端
  // ============================================================

  console.log('\n🤖 初始化 LLM 客户端...');
  const llm = createLLMClientSync({ provider: 'mock' });
  console.log('✅ 使用 Mock 客户端（离线演示模式）');

  // ============================================================
  //  2. 初始化工具注册表
  // ============================================================

  console.log('\n🔧 初始化工具系统...');
  const tools = createDefaultToolRegistry(true);

  console.log(`\n📦 可用工具 (${tools.size} 个):`);
  for (const name of tools.listNames()) {
    const entry = tools.get(name)!;
    console.log(`  - ${name}: ${entry.definition.function.description}`);
  }

  // ============================================================
  //  3. 创建 Loop 引擎
  // ============================================================

  console.log('\n🔄 创建 Loop 引擎...');

  const engine = new LoopEngine(
    llm,
    tools,
    {
      maxSteps: 5,
      verbose: true,
    },
    (_state) => {
      // 步骤回调：每一步完成时触发
    },
  );

  // ============================================================
  //  4. 运行测试任务
  // ============================================================

  const testTasks = [
    '帮我计算 2 + 2',
    '帮我搜索一下 TypeScript 的相关信息',
  ];

  for (let i = 0; i < testTasks.length; i++) {
    const task = testTasks[i];
    console.log('\n' + '━'.repeat(60));
    console.log(`🧪 测试 ${i + 1}/${testTasks.length}`);
    console.log(`🧑 用户: ${task}`);
    console.log('━'.repeat(60));

    try {
      const startTime = Date.now();
      const result = await engine.run(task);
      const elapsed = Date.now() - startTime;

      console.log('\n' + '━'.repeat(60));
      console.log(`🤖 最终回答: ${result}`);
      console.log('━'.repeat(60));

      // 显示统计
      const state = engine.getState();
      console.log('\n📊 执行统计:');
      console.log(`  步骤数: ${state.step}/${state.maxSteps}`);
      console.log(`  工具调用: ${state.history.filter((h: any) => h.action).length} 次`);
      console.log(`  消耗 Token: ~${state.tokensUsed}`);
      console.log(`  耗时: ${elapsed}ms`);
      console.log(`  状态: ${state.status}`);

      // 显示历史
      console.log('\n📜 执行历程:');
      for (const [j, record] of state.history.entries()) {
        console.log(`  步骤 ${j + 1}:`);
        console.log(`    思考: ${record.thought.slice(0, 80)}`);
        if (record.action) {
          console.log(`    行动: ${record.action.name}(${record.action.arguments.slice(0, 60)})`);
        }
        if (record.observation) {
          console.log(`    观察: ${record.observation.slice(0, 100)}`);
        }
      }
    } catch (error) {
      console.error(`\n❌ 测试 ${i + 1} 失败:`, error);
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('🎉 演示完成！');
  console.log('━'.repeat(60));
  console.log('\n💡 提示:');
  console.log('  使用真实 LLM: pnpm tsx -e "');
  console.log('    import { LoopEngine } from \"./src/core/loop-engine.js\";');
  console.log('    const llm = createLLMClientSync({ provider: \"deepseek\" });');
  console.log('    ..."');
  console.log('');
}
