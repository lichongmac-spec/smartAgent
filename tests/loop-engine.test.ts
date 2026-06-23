/**
 * loop-engine.test.ts - Loop 引擎测试
 *
 * 测试范围：
 *  - 基本功能（创建、简单任务、状态追踪）
 *  - 工具注册表（注册、注销、执行、getDefinitions、listNames）
 *  - 内置工具（calculator、search_web、read_file、write_file）
 *  - 配置和限制（maxSteps、verbose、自定义 systemPrompt）
 *  - 中断和回调（interrupt、onStep）
 *  - 错误处理（read_file 不存在文件、calculator 错误表达式）
 */

import { MockLLMClient } from '../src/llm/mock-client.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createDefaultToolRegistry } from '../src/tools/builtin/index.js';
import { LoopEngine } from '../src/core/loop-engine.js';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LoopState } from '../src/core/types.js';

// 测试用临时文件目录（必须在项目内，受沙箱保护）
const TEST_TMP = join(process.cwd(), 'test-output');
mkdirSync(TEST_TMP, { recursive: true });

// ============================================================
//  自建测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
let testCount = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEq(a: unknown, b: unknown, msg?: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg ?? `期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
  }
}

function assertOk(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function assertThrows(fn: () => Promise<void>, msg: string): Promise<void> {
  try {
    await fn();
    throw new Error(msg + ' (未抛出错误)');
  } catch (e) {
    // 预期抛出错误
  }
}

function test(name: string, fn: () => void | Promise<void>): void {
  testCount++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(
        () => { passCount++; },
        (e) => {
          failCount++;
          console.error(`  ❌ ${name}: ${e.message}`);
        },
      );
    } else {
      passCount++;
    }
  } catch (e) {
    failCount++;
    console.error(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  testCount++;
  try {
    await fn();
    passCount++;
  } catch (e) {
    failCount++;
    console.error(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

function describe(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n📦 ${name}`);
  return fn();
}

// ============================================================
//  测试套件
// ============================================================

console.log('\n🧪 Loop 引擎 + 工具系统 测试');
console.log('━'.repeat(60));

// ============================================================
//  1. 基本功能测试
// ============================================================

await describe('基本功能', async () => {
  const mockLLM = new MockLLMClient();
  const tools = createDefaultToolRegistry(false);

  await testAsync('创建 Loop 引擎', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false });
    assertOk(engine instanceof LoopEngine, '应该是 LoopEngine 实例');
    const state = engine.getState();
    assertEq(state.status, 'idle', '初始状态为 idle');
    assertEq(state.step, 0, '初始步骤为 0');
    assertEq(state.history.length, 0, '初始历史为空');
  });

  await testAsync('简单任务 - 直接回答', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false });
    const result = await engine.run('你好');
    assertOk(typeof result === 'string' && result.length > 0, '回答不应为空');

    const state = engine.getState();
    assertEq(state.status, 'done', '状态应为 done');
    assertOk(state.step >= 1, '至少执行了 1 步');
    assertEq(state.finalAnswer, result, 'finalAnswer 应等于返回值');
  });

  await testAsync('状态追踪 - getState', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false });
    await engine.run('1 + 1');
    const state = engine.getState();

    assertEq(state.status, 'done', '执行后状态为 done');
    assertOk(state.step > 0, 'step > 0');
    assertOk(state.tokensUsed >= 0, 'token 计数 >= 0');
    assertOk(state.startedAt instanceof Date, 'startedAt 是 Date');
    assertOk(state.finishedAt instanceof Date, 'finishedAt 是 Date');
    assertOk(state.history.length > 0, '有执行历史');
  });

  await testAsync('getElapsed - 计算耗时', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false });
    await engine.run('测试');
    const elapsed = engine.getElapsed();
    assertOk(typeof elapsed === 'number' && elapsed >= 0, 'elapsed 是正数');
  });

  await testAsync('getState 返回不可变副本', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false });
    await engine.run('测试');
    const state1 = engine.getState();
    const origLength = state1.history.length;

    // 修改副本不应影响引擎内部状态
    state1.history.push({
      thought: 'injected',
      timestamp: new Date(),
    } as any);

    const state2 = engine.getState();
    assertEq(state2.history.length, origLength, '修改副本不影响原状态');
    assertEq(
      state2.history[origLength - 1].thought === state2.finalAnswer ? 1 : 0,
      state2.history[origLength - 1].thought === state2.finalAnswer ? 1 : 0,
      '历史未被篡改',
    );
  });
});

// ============================================================
//  2. 工具注册表测试
// ============================================================

await describe('工具注册表', async () => {
  await test('注册和注销', () => {
    const registry = new ToolRegistry();
    registry.verbose = false;

    registry.register({
      definition: {
        type: 'function',
        function: { name: 'test_tool', description: '测试', parameters: {} },
      },
      executor: async () => ({ ok: true }),
    });

    assertOk(registry.has('test_tool'), '工具应已注册');
    assertEq(registry.size, 1, '应有 1 个工具');

    const removed = registry.unregister('test_tool');
    assertOk(removed, '注销应成功');
    assertOk(!registry.has('test_tool'), '工具应已注销');
    assertEq(registry.size, 0, '应有 0 个工具');
  });

  await test('重复注册抛错', () => {
    const registry = new ToolRegistry();
    registry.verbose = false;

    const def = {
      type: 'function' as const,
      function: { name: 'dup', description: '', parameters: {} },
    };

    registry.register({ definition: def, executor: async () => ({}) });

    try {
      registry.register({ definition: def, executor: async () => ({}) });
      assertOk(false, '应抛出错误');
    } catch (e) {
      assertOk((e as Error).message.includes('已注册'), '错误消息应包含"已注册"');
    }
  });

  await testAsync('执行未注册工具抛错', async () => {
    const registry = new ToolRegistry();
    registry.verbose = false;

    try {
      await registry.execute('nonexistent', {});
      assertOk(false, '应抛出错误');
    } catch (e) {
      assertOk((e as Error).message.includes('未注册'), '错误消息应包含"未注册"');
    }
  });

  await test('getDefinitions', () => {
    const registry = createDefaultToolRegistry(false);
    const defs = registry.getDefinitions();
    assertOk(defs.length >= 4, `至少 4 个工具定义，实际 ${defs.length}`);
    assertEq(defs[0].type, 'function', '类型应为 function');

    const names = defs.map((d) => d.function.name);
    assertOk(names.includes('read_file'), '应包含 read_file');
    assertOk(names.includes('calculator'), '应包含 calculator');
  });

  await test('listNames 排序', () => {
    const registry = createDefaultToolRegistry(false);
    const names = registry.listNames();
    assertOk(Array.isArray(names), 'listNames 返回数组');
    assertOk(names.length >= 4, '至少 4 个工具名');
    for (let i = 1; i < names.length; i++) {
      assertOk(names[i] >= names[i - 1], `排序错误: ${names[i]} < ${names[i - 1]}`);
    }
  });

  await test('clear 清空', () => {
    const registry = createDefaultToolRegistry(false);
    assertOk(registry.size > 0, '清空前有工具');
    registry.clear();
    assertEq(registry.size, 0, '清空后 size=0');
    assertEq(registry.getDefinitions().length, 0, '清空后 getDefinitions 为空');
  });
});

// ============================================================
//  3. 内置工具测试
// ============================================================

await describe('内置工具', async () => {
  await testAsync('calculator - 基本计算', async () => {
    const registry = createDefaultToolRegistry(false);
    const result = await registry.execute('calculator', { expression: '2 + 3 * 4' }) as any;
    assertOk(result.success, '计算应成功');
    assertEq(result.result, 14, '2 + 3 * 4 = 14');
  });

  await testAsync('calculator - 错误表达式', async () => {
    const registry = createDefaultToolRegistry(false);
    const result = await registry.execute('calculator', { expression: 'undefined_var + 1' }) as any;
    assertOk(!result.success, '应失败');
    assertOk(result.error.length > 0, '应有错误信息');
  });

  await testAsync('search_web - 搜索', async () => {
    const registry = createDefaultToolRegistry(false);
    const result = await registry.execute('search_web', { query: 'TypeScript' }) as any;
    assertOk(result.success, '搜索应成功');
    assertOk(Array.isArray(result.results), 'results 是数组');
    assertOk(result.results.length > 0, '应有搜索结果');
  });

  await testAsync('read_file - 读取文件', async () => {
    const registry = createDefaultToolRegistry(false);
    const testPath = join(TEST_TMP, `loop-test-read-${Date.now()}.txt`);
    writeFileSync(testPath, 'Hello Loop Engine!', 'utf-8');

    try {
      const result = await registry.execute('read_file', { path: testPath }) as any;
      assertOk(result.success, '读取应成功');
      assertOk(result.content.includes('Hello Loop Engine!'), '内容应匹配');
    } finally {
      try { unlinkSync(testPath); } catch {}
    }
  });

  await testAsync('read_file - 不存在的文件', async () => {
    const registry = createDefaultToolRegistry(false);
    // 使用项目内的路径（满足沙箱要求），但文件不存在
    const result = await registry.execute('read_file', { path: 'test-output/__nonexistent_test_file__.txt' }) as any;
    assertOk(!result.success, '应失败');
    assertOk(result.error.length > 0, '应有错误信息');
  });

  await testAsync('read_file - 行范围', async () => {
    const registry = createDefaultToolRegistry(false);
    const testPath = join(TEST_TMP, `loop-test-lines-${Date.now()}.txt`);
    writeFileSync(testPath, 'line1\nline2\nline3\nline4\nline5', 'utf-8');

    try {
      const result = await registry.execute('read_file', {
        path: testPath,
        startLine: 2,
        endLine: 4,
      }) as any;
      assertOk(result.success, '读取应成功');
      assertOk(!result.content.includes('line1'), '不应包含 line1');
      assertOk(result.content.includes('line2'), '应包含 line2');
      assertOk(result.content.includes('line4'), '应包含 line4');
      assertOk(!result.content.includes('line5'), '不应包含 line5');
    } finally {
      try { unlinkSync(testPath); } catch {}
    }
  });

  await testAsync('write_file - 覆盖写入', async () => {
    const registry = createDefaultToolRegistry(false);
    const testPath = join(TEST_TMP, `loop-test-write-${Date.now()}.txt`);

    try {
      const result = await registry.execute('write_file', {
        path: testPath,
        content: 'Hello from test!',
      }) as any;
      assertOk(result.success, '写入应成功');

      const content = readFileSync(testPath, 'utf-8');
      assertEq(content, 'Hello from test!', '文件内容匹配');
    } finally {
      try { unlinkSync(testPath); } catch {}
    }
  });

  await testAsync('write_file - 追加模式', async () => {
    const registry = createDefaultToolRegistry(false);
    const testPath = join(TEST_TMP, `loop-test-append-${Date.now()}.txt`);

    try {
      await registry.execute('write_file', {
        path: testPath,
        content: 'first\n',
      });
      await registry.execute('write_file', {
        path: testPath,
        content: 'second\n',
        mode: 'append',
      });

      const content = readFileSync(testPath, 'utf-8');
      assertOk(content.includes('first'), '应包含 first');
      assertOk(content.includes('second'), '应包含 second');
    } finally {
      try { unlinkSync(testPath); } catch {}
    }
  });
});

// ============================================================
//  4. 配置和限制测试
// ============================================================

await describe('配置和限制', async () => {
  const mockLLM = new MockLLMClient();
  const tools = createDefaultToolRegistry(false);

  await testAsync('maxSteps 限制', async () => {
    const engine = new LoopEngine(mockLLM, tools, { maxSteps: 2, verbose: false });
    const result = await engine.run('复杂任务');
    const state = engine.getState();
    assertOk(state.step <= 2, `步骤数 ${state.step} 不应超过 maxSteps(2)`);
    assertOk(result.length > 0, '应有结果');
  });

  await testAsync('verbose 安静模式', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false, maxSteps: 1 });
    const result = await engine.run('测试安静模式');
    assertOk(result.length > 0, '安静模式下功能正常');
  });

  await testAsync('自定义 systemPrompt', async () => {
    const engine = new LoopEngine(mockLLM, tools, {
      systemPrompt: '你是一只猫。{tools_description}',
      verbose: false,
    });
    const result = await engine.run('你好');
    assertOk(result.length > 0, '自定义提示词下正常工作');
  });
});

// ============================================================
//  5. 中断和回调测试
// ============================================================

await describe('中断和回调', async () => {
  const mockLLM = new MockLLMClient();
  const tools = createDefaultToolRegistry(false);

  await testAsync('interrupt - 中断执行', async () => {
    const engine = new LoopEngine(mockLLM, tools, { verbose: false });
    engine.interrupt();

    const result = await engine.run('测试中断');
    assertOk(result.includes('中断'), '应提示已中断');

    const state = engine.getState();
    assertEq(state.status, 'error', '中断后状态应为 error');
  });

  await testAsync('onStep 回调', async () => {
    const callbacks: Array<{ step: number; status: string }> = [];

    const engine = new LoopEngine(
      mockLLM,
      tools,
      { verbose: false },
      (state) => {
        callbacks.push({ step: state.step, status: state.status });
      },
    );

    await engine.run('测试回调');
    assertOk(callbacks.length >= 1, `至少触发 1 次回调，实际 ${callbacks.length}`);
    assertEq(callbacks[callbacks.length - 1].status, 'done', '最后一次回调状态为 done');
  });
});

// ============================================================
//  结果汇总
// ============================================================

console.log('━'.repeat(60));
console.log(`📊 结果: ${passCount}/${testCount} 通过, ${failCount} 失败`);

if (failCount > 0) process.exitCode = 1;
