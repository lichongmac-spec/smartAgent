/**
 * test-deepseek-loop.ts - DeepSeek + Loop 引擎集成测试
 *
 * 运行方式：
 *   pnpm tsx test-deepseek-loop.ts
 */

import { createLLMClientFromConfig } from './src/llm/client-factory.js';
import { createDefaultToolRegistry } from './src/tools/builtin/index.js';
import { LoopEngine } from './src/core/loop-engine.js';

async function main() {
  console.log('━'.repeat(60));
  console.log('🧪 DeepSeek + Loop 引擎集成测试');
  console.log('━'.repeat(60));

  // 1. 创建 LLM 客户端（从隔离配置读取）
  console.log('\n🤖 创建 DeepSeek 客户端...');
  const llm = await createLLMClientFromConfig();
  console.log('✅ 客户端就绪\n');

  // 2. 创建工具注册表
  const tools = createDefaultToolRegistry(false);
  console.log(`📦 工具: ${tools.listNames().join(', ')}\n`);

  // 3. 创建 Loop 引擎
  const engine = new LoopEngine(llm, tools, {
    maxSteps: 5,
    verbose: true,
  });

  // 4. 运行测试
  const task = process.argv[2] || '帮我计算 15 * 7 + 23 的结果';

  console.log('━'.repeat(60));
  console.log(`🧑 用户: ${task}`);
  console.log('━'.repeat(60));

  try {
    const startTime = Date.now();
    const answer = await engine.run(task);
    const elapsed = Date.now() - startTime;

    console.log('\n' + '━'.repeat(60));
    console.log(`🤖 最终回答: ${answer}`);
    console.log('━'.repeat(60));

    const state = engine.getState();
    console.log(`\n📊 统计:`);
    console.log(`   步骤: ${state.step}/${state.maxSteps}`);
    console.log(`   工具调用: ${state.history.filter(h => h.action).length} 次`);
    console.log(`   Token: ~${state.tokensUsed}`);
    console.log(`   耗时: ${elapsed}ms`);
    console.log(`   状态: ${state.status}`);
  } catch (error) {
    console.error(`\n❌ 错误: ${error}`);
    process.exitCode = 1;
  }
}

main();
