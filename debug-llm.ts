/**
 * debug-llm.ts - LLM 客户端调试工具
 *
 * 用于快速测试 LLM 客户端连接，不依赖 CLI 框架。
 *
 * 运行方式:
 *   pnpm tsx debug-llm.ts                          # 自动检测
 *   SMARTAGENT_PROVIDER=ollama pnpm tsx debug-llm.ts  # 指定 Provider
 *   SMARTAGENT_LOG_LEVEL=debug pnpm tsx debug-llm.ts  # 开启调试日志
 *   SMARTAGENT_PROVIDER=mock pnpm tsx debug-llm.ts    # Mock 模式
 */

import { createLLMClient, createLLMClientSync } from './src/llm/index.js';
import type { ILLMClient } from './src/llm/types.js';

async function main() {
  console.log('━'.repeat(60));
  console.log('🔧 SmartAgent LLM 客户端调试工具');
  console.log('━'.repeat(60));

  // ============================================================
  //  1. 环境信息
  // ============================================================

  console.log('\n📋 环境信息:');
  console.log(`   SMARTAGENT_PROVIDER = ${process.env.SMARTAGENT_PROVIDER ?? '(未设置)'}`);
  console.log(`   SMARTAGENT_LOG_LEVEL = ${process.env.SMARTAGENT_LOG_LEVEL ?? '(未设置)'}`);
  console.log(`   DEEPSEEK_API_KEY = ${process.env.DEEPSEEK_API_KEY ? '已设置' : '(未设置)'}`);
  console.log(`   OPENAI_API_KEY = ${process.env.OPENAI_API_KEY ? '已设置' : '(未设置)'}`);
  console.log(`   OLLAMA_HOST = ${process.env.OLLAMA_HOST ?? '(未设置，使用默认)'}`);
  console.log(`   OLLAMA_MODEL = ${process.env.OLLAMA_MODEL ?? '(未设置，使用默认)'}`);

  // ============================================================
  //  2. 可用服务检测
  // ============================================================

  console.log('\n📡 检测可用 AI 服务...');

  // 检查 Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      const data = await res.json();
      const models = (data.models as Array<{ name: string }>) ?? [];
      if (models.length > 0) {
        console.log(`  ✅ Ollama 服务在线`);
        console.log(`  📦 可用模型: ${models.map((m) => m.name).join(', ')}`);
      } else {
        console.log('  ⚠️  Ollama 在线但没有模型，请运行 ollama pull qwen2.5:7b');
      }
    }
  } catch {
    console.log('  ❌ Ollama 服务不在线');
  }

  // ============================================================
  //  3. 创建客户端
  // ============================================================

  console.log('\n🤖 创建 LLM 客户端（异步自动检测）...');
  let client: ILLMClient;
  try {
    client = await createLLMClient({ healthCheck: true });
    console.log('  ✅ 客户端创建成功');
  } catch (err) {
    console.log(`  ❌ 客户端创建失败: ${err}`);
    console.log('  💡 降级到 Mock 模式');
    client = createLLMClientSync({ provider: 'mock' });
  }

  // ============================================================
  //  4. 交互式对话
  // ============================================================

  console.log('\n💬 交互式对话模式');
  console.log('  输入 "exit" 或 "quit" 退出');
  console.log('  输入 "stream:你的问题" 使用流式模式');
  console.log('  直接输入问题使用普通模式');
  console.log('━'.repeat(60));

  // 简单的命令行交互
  const readline = (await import('node:readline')).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => readline.question(q, resolve));

  while (true) {
    const userInput = await ask('\n🧑 你: ');
    if (userInput === 'exit' || userInput === 'quit') {
      console.log('👋 再见！');
      readline.close();
      break;
    }

    if (!userInput.trim()) continue;

    const isStream = userInput.startsWith('stream:');
    const question = isStream ? userInput.slice(7).trim() : userInput;

    if (!question) {
      console.log('  ⚠️ 请输入有效的问题');
      continue;
    }

    try {
      const startTime = Date.now();

      if (isStream) {
        // 流式模式
        process.stdout.write('🤖 AI: ');
        for await (const chunk of client.chatStream([
          { role: 'user', content: question },
        ])) {
          process.stdout.write(chunk);
        }
        console.log('');
      } else {
        // 普通模式
        const response = await client.chat([
          { role: 'user', content: question },
        ]);
        console.log(`🤖 AI: ${response.content}`);
        if (response.usage) {
          console.log(`   📊 Token: 输入=${response.usage.promptTokens} 输出=${response.usage.completionTokens} 总计=${response.usage.totalTokens}`);
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`   ⏱️ 耗时: ${elapsed}ms`);
    } catch (err) {
      console.log(`   ❌ 错误: ${(err as Error).message}`);
    }
  }
}

main().catch(console.error);
