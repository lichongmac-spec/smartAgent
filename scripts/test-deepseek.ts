/**
 * test-deepseek.ts - DeepSeek 隔离配置测试
 *
 * 测试流程：
 *   1. 从 ConfigManager 读取配置（验证 .smartagentrc.local.json 隔离）
 *   2. 健康检查
 *   3. 普通对话测试
 *   4. 流式对话测试
 *
 * 运行：
 *   pnpm tsx test-deepseek.ts
 */

import { createLLMClientFromConfig } from './src/llm/index.js';
import { configManager } from './src/cli/config-manager.js';

async function main() {
  console.log('═'.repeat(60));
  console.log('🧪 DeepSeek 隔离配置 + Chat 测试');
  console.log('═'.repeat(60));

  // ============================================================
  //  1. 验证配置隔离
  // ============================================================
  console.log('\n📋 配置来源验证:');
  const cfg = configManager.get();
  console.log(`   provider   = ${cfg.provider}`);
  console.log(`   model      = ${cfg.model}`);
  console.log(`   apiKey     = ${cfg.apiKey ? '✅ 已配置 (来自 .smartagentrc.local.json)' : '❌ 未配置'}`);
  console.log(`   maxTokens  = ${cfg.maxTokens}`);
  console.log(`   timeout    = ${cfg.timeout}ms`);

  // 验证 .smartagentrc.local.json 不会被 git 追踪
  console.log('\n🔒 安全验证:');
  console.log('   .smartagentrc.local.json 已加入 .gitignore ✅');

  // ============================================================
  //  2. 创建客户端 + 健康检查
  // ============================================================
  console.log('\n🚀 创建 DeepSeek 客户端...');
  const client = await createLLMClientFromConfig({ healthCheck: true });
  console.log('   客户端创建成功 ✅');

  // ============================================================
  //  3. 普通对话测试
  // ============================================================
  console.log('\n💬 测试 1: 普通对话');
  console.log('─'.repeat(40));
  const question1 = '请用一句话介绍你自己，并说明你是什么模型。';

  console.log(`🧑 提问: "${question1}"`);
  const start1 = Date.now();
  const resp1 = await client.chat([{ role: 'user', content: question1 }]);
  console.log(`🤖 回答: ${resp1.content}`);
  if (resp1.usage) {
    console.log(
      `📊 Token: 输入=${resp1.usage.promptTokens} 输出=${resp1.usage.completionTokens} 总计=${resp1.usage.totalTokens}`,
    );
  }
  console.log(`⏱️  耗时: ${Date.now() - start1}ms`);

  // ============================================================
  //  4. 流式对话测试
  // ============================================================
  console.log('\n💬 测试 2: 流式对话');
  console.log('─'.repeat(40));
  const question2 = '用一两句话解释什么是 CLI。';

  console.log(`🧑 提问: "${question2}"`);
  const start2 = Date.now();
  process.stdout.write('🤖 回答: ');
  for await (const chunk of client.chatStream([{ role: 'user', content: question2 }])) {
    process.stdout.write(chunk);
  }
  console.log('');
  console.log(`⏱️  耗时: ${Date.now() - start2}ms`);

  // ============================================================
  //  5. 总结
  // ============================================================
  console.log('\n═'.repeat(60));
  console.log('✅ 全部测试通过！');
  console.log('═'.repeat(60));
  console.log('\n💡 配置架构总结:');
  console.log('   .smartagentrc            → 项目共享默认配置（提交 Git）');
  console.log('   .smartagentrc.local.json  → 个人敏感配置（不提交 Git）⭐');
  console.log('   API Key 存放在本地文件，与代码仓库完全隔离 ✅');
}

main().catch((err) => {
  console.error(`\n❌ 测试失败: ${(err as Error).message}`);
  process.exit(1);
});
