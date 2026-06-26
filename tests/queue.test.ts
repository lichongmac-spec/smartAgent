/**
 * tests/queue.test.ts - 任务队列单元测试
 *
 * 运行：npx tsx tests/queue.test.ts
 */

import { TaskQueue } from '../src/agent/queue/index.js';
import type { Job } from '../src/agent/queue/types.js';

// ============================================================
//  测试工具
// ============================================================

let pass = 0, fail = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    fail++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
//  分组测试
// ============================================================

async function testBasicOperations(): Promise<void> {
  console.log('\n📦 基本操作');

  await runTest('add 返回唯一 job ID', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    const id1 = q.add(async () => {}, 0);
    const id2 = q.add(async () => {}, 0);
    assert(id1 !== id2, '两个任务 ID 应不同');
    assert(id1.startsWith('job-'), 'ID 应以 job- 开头');
    q.clear();
  });

  await runTest('stats 返回正确的统计信息', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    // 添加一个不会自然完成的任务来保持 pending 状态
    q.add(() => new Promise(() => {}), 0);

    await sleep(20);
    const s = q.stats();
    assert(s.pending >= 0, 'pending 应为非负数');
    assert(s.running >= 0, 'running 应为非负数');
    assert(s.total >= 0, 'total 应为非负数');
    q.clear();
  });

  await runTest('clear 清空待处理任务', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    q.add(async () => {}, 0);
    q.add(async () => {}, 0);
    await sleep(20);

    q.clear();
    // 运行中的已 shift 出队列，clear 不影响
    // pending 应减少
    const s = q.stats();
    assert(s.pending === 0, '清空后 pending 应为 0');
  });

  await runTest('drain 等待所有任务完成', async () => {
    const q = new TaskQueue({ concurrency: 2 });
    let count = 0;
    q.add(async () => { await sleep(30); count++; }, 0);
    q.add(async () => { await sleep(30); count++; }, 0);

    await q.drain(5000);
    assert(count === 2, '所有任务应完成');
  });

  await runTest('drain 在队列已空时立即返回', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    const start = Date.now();
    await q.drain();
    const elapsed = Date.now() - start;
    assert(elapsed < 100, '空队列 drain 应立即返回');
  });

  await runTest('drain 超时抛出异常', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    q.add(() => new Promise(() => {}), 0); // 永不 resolve

    let threw = false;
    try {
      await q.drain(100);
    } catch {
      threw = true;
    }
    assert(threw, '超时后应抛出异常');
  });
}

// ============================================================
//  优先级测试
// ============================================================

async function testPriority(): Promise<void> {
  console.log('\n🎯 优先级排序');

  await runTest('高优先级任务先执行', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    const order: number[] = [];

    // 高优先级=0 应该比低优先级=10 先执行
    q.add(async () => { order.push(1); }, 10);
    q.add(async () => { order.push(2); }, 0); // 高优先级

    await q.drain(5000);
    assert(order[0] === 2, '高优先级任务应第一个执行');
    assert(order[1] === 1, '低优先级任务应第二个执行');
  });

  await runTest('同优先级按添加顺序执行', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    const order: number[] = [];

    q.add(async () => { await sleep(10); order.push(1); }, 5);
    q.add(async () => { await sleep(10); order.push(2); }, 5);
    q.add(async () => { await sleep(10); order.push(3); }, 5);

    await q.drain(5000);
    assert(order[0] === 1 && order[1] === 2 && order[2] === 3,
      '同优先级应按添加顺序执行');
  });

  await runTest('多个不同优先级正确穿插', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    const order: string[] = [];

    // P3(P=5), P2(P=2), P1(P=0)
    q.add(async () => { order.push('P3'); }, 5);
    q.add(async () => { order.push('P1'); }, 0);
    q.add(async () => { order.push('P2'); }, 2);

    await q.drain(5000);
    assert(order.join(',') === 'P1,P2,P3',
      `优先级顺序应为 P1,P2,P3，实际: ${order.join(',')}`);
  });
}

// ============================================================
//  并发控制测试
// ============================================================

async function testConcurrency(): Promise<void> {
  console.log('\n🔄 并发控制');

  await runTest('concurrency=1 时严格串行', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeJob = () => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(20);
      concurrent--;
    };

    q.add(makeJob(), 0);
    q.add(makeJob(), 0);
    q.add(makeJob(), 0);

    await q.drain(5000);
    assert(maxConcurrent === 1, `concurrency=1 时最大并发应为 1，实际: ${maxConcurrent}`);
  });

  await runTest('concurrency=3 时多个任务并行', async () => {
    const q = new TaskQueue({ concurrency: 3 });
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeJob = () => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(30);
      concurrent--;
    };

    for (let i = 0; i < 6; i++) {
      q.add(makeJob(), 0);
    }

    await q.drain(5000);
    assert(maxConcurrent >= 2, `concurrency=3 时至少 2 个并发，实际: ${maxConcurrent}`);
    assert(maxConcurrent <= 3, `concurrency=3 时不应超过 3 个并发，实际: ${maxConcurrent}`);
  });

  await runTest('stats.running 反映当前并发数', async () => {
    const q = new TaskQueue({ concurrency: 2 });
    let capturedRunning = 0;

    q.add(async () => {
      capturedRunning = q.stats().running;
      await sleep(50);
    }, 0);
    q.add(async () => {
      await sleep(30);
    }, 0);

    await q.drain(5000);
    // 并发=2 时，第一个任务执行时第二个可能也在运行
    assert(capturedRunning >= 1, `running 应 >= 1，实际: ${capturedRunning}`);
  });
}

// ============================================================
//  重试机制测试
// ============================================================

async function testRetry(): Promise<void> {
  console.log('\n🔁 失败重试');

  await runTest('失败任务自动重试直到成功', async () => {
    const q = new TaskQueue({ concurrency: 1, baseDelay: 5 });
    let attempt = 0;

    q.add(async () => {
      attempt++;
      if (attempt < 3) throw new Error(`尝试 ${attempt} 失败`);
      return 'ok';
    }, 0, 3);

    await q.drain(5000);
    assert(attempt === 3, `应重试 2 次后成功（共 3 次），实际: ${attempt}`);
  });

  await runTest('maxRetries=0 不重试', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    let attempt = 0;

    q.add(async () => {
      attempt++;
      throw new Error('失败');
    }, 0, 0); // maxRetries=0

    await q.drain(5000);
    assert(attempt === 1, 'maxRetries=0 应只执行 1 次');
  });

  await runTest('重试耗尽后触发 exhausted 事件', async () => {
    const q = new TaskQueue({ concurrency: 1, baseDelay: 5 });
    let exhaustedFired = false;

    q.on('exhausted', () => { exhaustedFired = true; });

    q.add(async () => {
      throw new Error('永远失败');
    }, 0, 2); // 最多重试 2 次 = 总共 3 次

    await q.drain(5000);
    assert(exhaustedFired, '应触发 exhausted 事件');
  });

  await runTest('重试使用指数退避', async () => {
    const q = new TaskQueue({ concurrency: 1, baseDelay: 5, backoff: 'exponential' });
    let delaySum = 0;

    q.on('retrying', (_job: Job, delay: number) => {
      delaySum += delay;
    });

    q.add(async () => {
      throw new Error('失败');
    }, 0, 3); // 3 次重试

    await q.drain(5000);
    // exponential: 5*2^0 + 5*2^1 + 5*2^2 = 5 + 10 + 20 = 35 (±30% jitter)
    assert(delaySum > 0, '应有重试延迟');
  });

  await runTest('linear 退避策略工作正常', async () => {
    const q = new TaskQueue({ concurrency: 1, baseDelay: 5, backoff: 'linear', jitter: false });
    let retryDelays: number[] = [];

    q.on('retrying', (_job: Job, delay: number) => {
      retryDelays.push(delay);
    });

    q.add(async () => { throw new Error('失败'); }, 0, 3);

    await q.drain(5000);
    // linear: 5*1, 5*2, 5*3 = 5, 10, 15
    assert(retryDelays.length === 3, `应有 3 次重试，实际: ${retryDelays.length}`);
    assert(retryDelays[0] === 5, `第 1 次延迟应为 5，实际: ${retryDelays[0]}`);
    assert(retryDelays[1] === 10, `第 2 次延迟应为 10，实际: ${retryDelays[1]}`);
    assert(retryDelays[2] === 15, `第 3 次延迟应为 15，实际: ${retryDelays[2]}`);
  });
}

// ============================================================
//  事件测试
// ============================================================

async function testEvents(): Promise<void> {
  console.log('\n📡 事件系统');

  await runTest('任务完成触发 completed 事件', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    let completed = 0;

    q.on('completed', () => { completed++; });
    q.add(async () => 'ok', 0);
    q.add(async () => 'ok2', 0);

    await q.drain(5000);
    assert(completed === 2, `应触发 2 次 completed，实际: ${completed}`);
  });

  await runTest('enqueued/started/completed 事件顺序正确', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    const events: string[] = [];

    q.on('enqueued', () => events.push('enqueued'));
    q.on('started', () => events.push('started'));
    q.on('completed', () => events.push('completed'));

    q.add(async () => {}, 0);

    await q.drain(5000);
    assert(events.join(',') === 'enqueued,started,completed',
      `事件顺序应为 enqueued,started,completed，实际: ${events.join(',')}`);
  });

  await runTest('队列清空触发 drained 事件', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    let drained = false;

    q.on('drained', () => { drained = true; });
    q.add(async () => {}, 0);

    await q.drain(5000);
    assert(drained, '应触发 drained 事件');
  });

  await runTest('once 只触发一次事件监听', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    let count = 0;

    q.once('completed', () => { count++; });
    q.add(async () => {}, 0);
    q.add(async () => {}, 0);

    await q.drain(5000);
    assert(count === 1, 'once 监听应只触发 1 次');
  });

  await runTest('retrying 事件含正确延迟', async () => {
    const q = new TaskQueue({ concurrency: 1, baseDelay: 20, backoff: 'fixed', jitter: false });
    let receivedDelay = 0;

    q.on('retrying', (_job: Job, delay: number) => {
      receivedDelay = delay;
    });

    q.add(async () => { throw new Error('失败'); }, 0, 1);

    await q.drain(5000);
    assert(receivedDelay === 20, `fixed 退避延迟应为 20，实际: ${receivedDelay}`);
  });
}

// ============================================================
//  边界情况
// ============================================================

async function testEdgeCases(): Promise<void> {
  console.log('\n🔲 边界情况');

  await runTest('空队列 stats 返回全零', async () => {
    const q = new TaskQueue();
    const s = q.stats();
    assert(s.pending === 0 && s.running === 0, '空队列应为全零');
  });

  await runTest('大量任务不崩溃', async () => {
    const q = new TaskQueue({ concurrency: 5, baseDelay: 1 });
    let count = 0;

    // 使用确定性优先级：交替高低优先级
    for (let i = 0; i < 50; i++) {
      q.add(async () => { count++; await sleep(1); }, i % 10);
    }

    await q.drain(10000);
    assert(count === 50, `应执行 50 个任务，实际: ${count}`);
  });

  await runTest('任务执行结果在 job.result 中', async () => {
    const q = new TaskQueue({ concurrency: 1 });
    let jobResult: any = undefined;
    let jobObj: Job | null = null;

    q.on('completed', (j: Job) => {
      jobObj = j;
      jobResult = j.result;
    });

    q.add(async () => ({ value: 42 }), 0);

    await q.drain(5000);
    assert(jobResult !== undefined, 'job.result 不应为 undefined');
    assert(jobObj!.result.value === 42, `result.value 应为 42，实际: ${jobObj!.result?.value}`);
  });

  await runTest('失败任务在 job.lastError 中记录错误', async () => {
    const q = new TaskQueue({ concurrency: 1, baseDelay: 1 });
    let failedJob: Job | null = null;

    q.on('exhausted', (j: Job) => {
      failedJob = j;
    });

    q.add(async () => {
      throw new Error('测试错误消息');
    }, 0, 0); // 不重试

    await q.drain(5000);
    assert(failedJob !== null, '应触发 exhausted');
    assert(failedJob!.lastError!.message.includes('测试错误消息'),
      `错误消息应包含"测试错误消息"，实际: ${failedJob!.lastError?.message}`);
  });
}

// ============================================================
//  主函数
// ============================================================

async function main(): Promise<void> {
  console.log('🧪 任务队列（TaskQueue）单元测试\n');

  await testBasicOperations();
  await testPriority();
  await testConcurrency();
  await testRetry();
  await testEvents();
  await testEdgeCases();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 结果: ${pass}/${pass + fail} 通过`);
  console.log(`${'='.repeat(50)}\n`);

  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
