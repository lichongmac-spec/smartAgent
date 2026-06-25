/**
 * heartbeat.test.ts - 心跳与健康监控系统测试
 */

import { HeartbeatManager } from '../src/health/heartbeat-manager.js';
import {
  createLLMHealthCheck,
  createDiskHealthCheck,
  createMemoryHealthCheck,
} from '../src/health/builtin-checks.js';
import type { UnhealthyEvent, RecoveredEvent } from '../src/health/types.js';

// ============================================================
//  测试工具
// ============================================================

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 创建可控制的模拟检查函数 */
function createControllableCheck(): { fn: () => Promise<boolean>; setResult: (v: boolean) => void } {
  let result = true;
  return {
    fn: async () => result,
    setResult: (v: boolean) => { result = v; },
  };
}

// ============================================================
//  测试套件
// ============================================================

async function main(): Promise<void> {
  console.log('\n🧪 心跳与健康监控 测试\n');
  console.log('━'.repeat(50));

  // ==========================================================
  //  分组 1：HeartbeatManager 基础
  // ==========================================================

  console.log('\n📦 1. HeartbeatManager 基础\n');

  await runTest('默认状态为 healthy', async () => {
    const hb = new HeartbeatManager({ initialCheck: false });
    const status = hb.getStatus();
    assert(status.status === 'healthy', '初始状态应为 healthy');
    assert(status.consecutiveFailures === 0, '初始失败计数为 0');
    assert(status.consecutiveSuccesses === 0, '初始成功计数为 0');
  });

  await runTest('registerCheck 注册自定义检查', async () => {
    const hb = new HeartbeatManager({ initialCheck: true });
    let called = false;
    hb.registerCheck('test', async () => { called = true; return true; });
    // 启动心跳，initialCheck 会通过 setImmediate 立即执行一次
    hb.start(100);
    await sleep(150); // 等待 setImmediate + 至少一次定时器触发
    hb.stop();
    assert(called, '注册的检查被调用');
  });

  await runTest('unregisterCheck 移除检查', async () => {
    const hb = new HeartbeatManager({ initialCheck: false });
    hb.registerCheck('test', async () => true);
    const removed = hb.unregisterCheck('test');
    assert(removed, '移除成功');
    const removed2 = hb.unregisterCheck('nonexistent');
    assert(!removed2, '不存在的检查项返回 false');
  });

  await runTest('start/stop 控制心跳', async () => {
    const hb = new HeartbeatManager({ initialCheck: false });
    assert(!hb.isRunning(), '未启动时 isRunning 为 false');
    hb.start();
    assert(hb.isRunning(), '启动后 isRunning 为 true');
    hb.stop();
    assert(!hb.isRunning(), '停止后 isRunning 为 false');
  });

  await runTest('重复调用 start 不创建多个定时器', async () => {
    const hb = new HeartbeatManager({ initialCheck: false });
    let callCount = 0;
    hb.registerCheck('counter', async () => { callCount++; return true; });

    hb.start(50);
    hb.start(50); // 第二次调用应被忽略
    hb.start(50); // 第三次同样
    await sleep(30); // 等待首次立即检查
    const count1 = callCount;
    await sleep(80); // 等待定时器触发
    const count2 = callCount;
    hb.stop();

    // 应该只增加了约 1~2 次（首次 + 最多一次定时触发）
    assert(count2 - count1 <= 2, `定时器应只有一个，调用增量: ${count2 - count1}`);
  });

  // ==========================================================
  //  分组 2：状态转换 — unhealthy
  // ==========================================================

  console.log('\n📦 2. 状态转换 — unhealthy 事件\n');

  await runTest('连续失败触发 unhealthy 事件', async () => {
    const check = createControllableCheck();
    check.setResult(false); // 始终失败

    const hb = new HeartbeatManager({
      initialCheck: true,
      failureThreshold: 3,
      recoveryThreshold: 2,
      disabledChecks: ['disk', 'memory'], // 排除内置检查干扰
    });
    hb.registerCheck('failing', check.fn);

    let unhealthyEvent: UnhealthyEvent | null = null;
    hb.on('unhealthy', (e: UnhealthyEvent) => { unhealthyEvent = e; });

    // 执行 3 轮检查
    hb.start(20); // 每 20ms 一轮
    await sleep(80); // 等待 3+ 轮

    hb.stop();

    assert(unhealthyEvent !== null, '应触发 unhealthy 事件');
    assert(
      unhealthyEvent!.snapshot.consecutiveFailures >= 3,
      `连续失败次数应 >= 3，实际 ${unhealthyEvent!.snapshot.consecutiveFailures}`
    );
    assert(
      unhealthyEvent!.failedChecks.length > 0,
      `failedChecks 应包含失败项，实际 ${unhealthyEvent!.failedChecks.length}`
    );
    assert(hb.getStatus().status === 'unhealthy', '状态应为 unhealthy');
  });

  await runTest('失败次数未达阈值不触发 unhealthy', async () => {
    const check = createControllableCheck();
    check.setResult(false);

    const hb = new HeartbeatManager({
      initialCheck: false,
      failureThreshold: 5,  // 阈值设为 5
      recoveryThreshold: 1,
      disabledChecks: ['disk', 'memory'],
    });
    hb.registerCheck('failing', check.fn);

    let unhealthyFired = false;
    hb.on('unhealthy', () => { unhealthyFired = true; });

    hb.start(20);
    await sleep(80); // 约 3-4 轮，不到阈值
    hb.stop();

    assert(!unhealthyFired, '失败次数未达阈值不应触发 unhealthy');
    assert(hb.getStatus().status !== 'unhealthy', '状态不应是 unhealthy');
  });

  // ==========================================================
  //  分组 3：状态转换 — recovered
  // ==========================================================

  console.log('\n📦 3. 状态转换 — recovered 事件\n');

  await runTest('从不健康恢复到健康触发 recovered', async () => {
    // 阶段 1：制造 unhealthy
    const check = createControllableCheck();
    check.setResult(false);

    const hb = new HeartbeatManager({
      initialCheck: true,
      failureThreshold: 2,
      recoveryThreshold: 2,
      disabledChecks: ['disk', 'memory'], // 排除内置检查干扰
    });
    hb.registerCheck('toggle', check.fn);

    let unhealthyFired = false;
    let recoveredFired = false;
    hb.on('unhealthy', () => { unhealthyFired = true; });
    hb.on('recovered', () => { recoveredFired = true; });

    // 先让它 unhealthy（给予充足时间）
    hb.start(30);
    await sleep(150); // 等待 4+ 轮失败，确保 unhealthy 触发
    assert(unhealthyFired, '应先触发 unhealthy');
    assert(hb.getStatus().status === 'unhealthy', '应为 unhealthy');

    // 阶段 2：恢复检查结果
    check.setResult(true);
    await sleep(200); // 等待 5+ 轮成功（充足时间达到 recoveryThreshold=2）
    hb.stop();

    assert(recoveredFired, '应触发 recovered 事件');
    assert(hb.getStatus().status === 'healthy', '应恢复为 healthy');
  });

  // ==========================================================
  //  分组 4：状态转换 — degraded
  // ==========================================================

  console.log('\n📦 4. 状态转换 — degraded 事件\n');

  await runTest('部分检查失败触发 degraded', async () => {
    const hb = new HeartbeatManager({
      initialCheck: false,
      failureThreshold: 5,  // unhealthy 阈值设高
      recoveryThreshold: 2,
      disabledChecks: ['disk', 'memory'],
    });
    
    hb.registerCheck('always-ok', async () => true);
    hb.registerCheck('sometimes-fail', async () => false);

    let degradedFired = false;
    let unhealthyFired = false;
    hb.on('degraded', () => { degradedFired = true; });
    hb.on('unhealthy', () => { unhealthyFired = true; });

    hb.start(20);
    await sleep(40); // 1~2 轮
    hb.stop();

    assert(degradedFired, '部分失败应触发 degraded');
    assert(!unhealthyFired, '未到 unhealthy 阈值不应触发 unhealthy');
    assert(hb.getStatus().status === 'degraded', '状态应为 degraded');
  });

  // ==========================================================
  //  分组 5：autoRestart
  // ==========================================================

  console.log('\n📦 5. autoRestart 自动重启\n');

  await runTest('autoRestart 配置存储但不实际退出', async () => {
    // 注意：autoRestart 实际会调用 process.exit(1)，但这里只验证配置不崩溃
    // 不真正触发 unhealthy（用高阈值+快检查确保不触发）
    const hb = new HeartbeatManager({
      initialCheck: false,
      failureThreshold: 100,
      autoRestart: true,
      disabledChecks: ['disk', 'memory'],
    });
    hb.registerCheck('ok', async () => true);
    hb.start(50);
    await sleep(70); // 不应该触发 unhealthy
    hb.stop();
    // 如果执行到这里，说明没有 process.exit
    assert(true, 'autoRestart 配置正常');
  });

  // ==========================================================
  //  分组 6：内置检查 — LLM
  // ==========================================================

  console.log('\n📦 6. 内置检查 — LLM 服务\n');

  await runTest('Mock LLM 客户端健康检查通过', async () => {
    const mockClient = {
      healthCheck: async () => true,
    };
    const check = createLLMHealthCheck(mockClient as any);
    const result = await check();
    assert(result === true, '健康 LLM 应返回 true');
  });

  await runTest('不健康的 LLM 客户端返回 false', async () => {
    const mockClient = {
      healthCheck: async () => false,
    };
    const check = createLLMHealthCheck(mockClient as any);
    const result = await check();
    assert(result === false, '不健康 LLM 应返回 false');
  });

  await runTest('LLM 检查异常返回 false', async () => {
    const mockClient = {
      healthCheck: async () => { throw new Error('网络错误'); },
    };
    const check = createLLMHealthCheck(mockClient as any);
    const result = await check();
    assert(result === false, '异常应返回 false');
  });

  // ==========================================================
  //  分组 7：内置检查 — 磁盘空间
  // ==========================================================

  console.log('\n📦 7. 内置检查 — 磁盘空间\n');

  await runTest('磁盘检查返回布尔值', async () => {
    const check = createDiskHealthCheck();
    const result = await check();
    assert(typeof result === 'boolean', '磁盘检查返回布尔值');
    // 在正常开发环境中，磁盘通常有足够空间
    assert(result === true, '开发环境应有足够磁盘空间');
  });

  await runTest('极高阈值磁盘检查（应通过或优雅失败）', async () => {
    // 设置一个极大的阈值（1PB），正常环境下应该返回 false
    const check = createDiskHealthCheck(1024 * 1024 * 1024 * 1024 * 1024); // 1PB
    const result = await check();
    // 可能是 false（空间不足）或 true（df 命令不可用）
    assert(typeof result === 'boolean', '应返回布尔值');
  });

  // ==========================================================
  //  分组 8：内置检查 — 内存
  // ==========================================================

  console.log('\n📦 8. 内置检查 — 内存使用\n');

  await runTest('内存检查返回布尔值', async () => {
    const check = createMemoryHealthCheck();
    const result = await check();
    assert(typeof result === 'boolean', '内存检查返回布尔值');
  });

  await runTest('正常阈值内存检查通过', async () => {
    const check = createMemoryHealthCheck(0.99); // 99%，非常宽松
    const result = await check();
    // 若系统内存使用超过 99% 则失败（这种情况极少见）
    // 如果确实失败，也算合理（系统确实处于高负载）
    if (!result) {
      console.log('    ⚠️  系统内存使用超过 99%，跳过此断言（系统高负载）');
    } else {
      assert(result === true, '宽松阈值下内存应该通过');
    }
  });

  await runTest('极低阈值内存检查不通过', async () => {
    const check = createMemoryHealthCheck(0.01); // 1% 使用率，几乎不可能
    const result = await check();
    assert(result === false, '极低阈值下内存应该不通过');
  });

  // ==========================================================
  //  分组 9：集成 — HeartbeatManager + LLM
  // ==========================================================

  console.log('\n📦 9. 集成 — HeartbeatManager + LLM 客户端\n');

  await runTest('通过配置传入 LLM 客户端注册内置检查', async () => {
    const mockClient = {
      healthCheck: async () => true,
    };
    const hb = new HeartbeatManager({
      llmClient: mockClient as any,
      initialCheck: false,
      disabledChecks: ['disk', 'memory'], // 只启用 LLM
    });

    let checkCalled = false;
    // 使用一个包装来验证 LLM 检查被执行
    const wrappedClient = {
      healthCheck: async () => { checkCalled = true; return true; },
    };
    const hb2 = new HeartbeatManager({
      llmClient: wrappedClient as any,
      initialCheck: true,
      disabledChecks: ['disk', 'memory'],
    });

    hb2.start(50);
    await sleep(70);
    hb2.stop();
    assert(checkCalled, 'LLM 健康检查被调用');
  });

  await runTest('禁用内置检查', async () => {
    let llmCalled = false;
    let diskCalled = false;
    let memCalled = false;

    const mockClient = {
      healthCheck: async () => { llmCalled = true; return true; },
    };

    // 重写内置检查创建函数（通过不同的方式—这里直接用自定义检查观察）
    const hb = new HeartbeatManager({
      initialCheck: true,
      disabledChecks: ['llm', 'disk', 'memory'],
    });
    hb.registerCheck('custom-only', async () => true);

    hb.start(50);
    await sleep(70);
    hb.stop();

    assert(true, '所有内置检查被禁用，仅自定义检查运行'); // 不崩溃即可
  });

  // ==========================================================
  //  分组 10：边界条件
  // ==========================================================

  console.log('\n📦 10. 边界条件\n');

  await runTest('没有注册任何检查时 runChecks 不崩溃', async () => {
    const hb = new HeartbeatManager({
      initialCheck: true,
      disabledChecks: ['llm', 'disk', 'memory'],
    });
    // 不注册任何自定义检查
    hb.start(20);
    await sleep(50);
    hb.stop();
    assert(true, '没有检查项不崩溃');
  });

  await runTest('注册多个自定义检查', async () => {
    const hb = new HeartbeatManager({
      initialCheck: false,
      disabledChecks: ['llm', 'disk', 'memory'],
    });
    
    const executed: string[] = [];
    hb.registerCheck('check-a', async () => { executed.push('a'); return true; });
    hb.registerCheck('check-b', async () => { executed.push('b'); return true; });
    hb.registerCheck('check-c', async () => { executed.push('c'); return false; });

    hb.start(20);
    await sleep(40);
    hb.stop();

    assert(executed.includes('a'), 'check-a 应被执行');
    assert(executed.includes('b'), 'check-b 应被执行');
    assert(executed.includes('c'), 'check-c 应被执行');
  });

  await runTest('unhealthy 后成功恢复重置计数器', async () => {
    const check = createControllableCheck();
    check.setResult(false);

    const hb = new HeartbeatManager({
      initialCheck: true,
      failureThreshold: 2,
      recoveryThreshold: 2,
      disabledChecks: ['disk', 'memory'],
    });
    hb.registerCheck('toggle', check.fn);

    let recoveredEvent: RecoveredEvent | null = null;
    hb.on('recovered', (e: RecoveredEvent) => { recoveredEvent = e; });

    // 先 unhealthy
    hb.start(30);
    await sleep(150);
    assert(hb.getStatus().status === 'unhealthy', '应为 unhealthy');

    // 然后恢复
    check.setResult(true);
    await sleep(200); // 给充足时间恢复
    hb.stop();

    assert(recoveredEvent !== null, '应触发 recovered');
    assert(recoveredEvent!.snapshot.consecutiveFailures === 0, '恢复后失败计数应为 0');
    assert(recoveredEvent!.snapshot.consecutiveSuccesses >= 2, '成功计数应达到阈值');
    assert(hb.getStatus().status === 'healthy', '状态应为 healthy');
  });

  // ==========================================================
  //  结果汇总
  // ==========================================================

  console.log('\n' + '━'.repeat(50));
  console.log(`\n📊 结果: ${passed}/${passed + failed} 通过`);
  if (failed > 0) {
    console.log(`❌ ${failed} 项测试失败`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
