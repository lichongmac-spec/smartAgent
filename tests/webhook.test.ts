/**
 * tests/webhook.test.ts - Webhook 通知器单元测试
 *
 * 运行：npx tsx tests/webhook.test.ts
 *
 * 注意：Webhook 测试需要网络访问 httpbin.org 来验证实际 HTTP 请求。
 * 如果网络不可用，httpbin 相关测试会跳过。
 */

import { createServer } from 'http';
import type { IncomingMessage, ServerResponse, Server } from 'http';
import { WebhookNotifier } from '../src/webhook/index.js';
import type { WebhookConfig, WebhookPayload } from '../src/webhook/types.js';

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

/** 创建一个简单的 HTTP 服务器用于测试 webhook */
function createTestServer(): Promise<{
  server: Server;
  port: number;
  onRequest: (callback: (req: IncomingMessage, body: string) => void) => void;
}> {
  return new Promise((resolve) => {
    const server = createServer();
    let requestCallback: ((req: IncomingMessage, body: string) => void) | null = null;

    server.on('request', (req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
        if (requestCallback) requestCallback(req, body);
      });
    });

    server.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({
        server,
        port,
        onRequest: (cb) => { requestCallback = cb; },
      });
    });
  });
}

// ============================================================
//  分组测试
// ============================================================

async function testRegistration(): Promise<void> {
  console.log('\n📋 端点注册');

  await runTest('add 注册新端点', async () => {
    const n = new WebhookNotifier();
    n.add('https://example.com/hook');
    assert(n.count === 1, '注册后 count 应为 1');
  });

  await runTest('add 触发 registered 事件', async () => {
    const n = new WebhookNotifier();
    let registeredUrl = '';

    n.on('registered', (config: WebhookConfig) => {
      registeredUrl = config.url;
    });

    n.add('https://example.com/callback');
    assert(registeredUrl === 'https://example.com/callback',
      `registered 事件应携带 URL，实际: ${registeredUrl}`);
  });

  await runTest('add 重复 URL 产生多个端点', async () => {
    const n = new WebhookNotifier();
    n.add('https://example.com/hook');
    n.add('https://example.com/hook');
    assert(n.count === 2, '重复 URL 应产生 2 个端点');
  });

  await runTest('remove 移除指定 URL', async () => {
    const n = new WebhookNotifier();
    n.add('https://example.com/hook');
    const removed = n.remove('https://example.com/hook');
    assert(removed === true, 'remove 应返回 true');
    assert(n.count === 0, '移除后 count 应为 0');
  });

  await runTest('remove 不存在的 URL 返回 false', async () => {
    const n = new WebhookNotifier();
    n.add('https://example.com/hook');
    const removed = n.remove('https://nonexistent.com/hook');
    assert(removed === false, '移除不存在的 URL 应返回 false');
    assert(n.count === 1, 'count 不应变化');
  });

  await runTest('list 返回所有端点副本', async () => {
    const n = new WebhookNotifier();
    n.add('https://a.com', { 'X-Key': '1' });
    n.add('https://b.com', { 'X-Key': '2' });

    const list = n.list();
    assert(list.length === 2, 'list 应返回 2 个端点');
    assert(list[0].url === 'https://a.com', '第一个端点 URL 正确');
    assert(list[0].headers!['X-Key'] === '1', '第一个端点 header 正确');
  });

  await runTest('clear 清空所有端点', async () => {
    const n = new WebhookNotifier();
    n.add('https://a.com');
    n.add('https://b.com');
    n.clear();
    assert(n.count === 0, '清空后 count 应为 0');
  });
}

// ============================================================
//  本地服务器通知测试
// ============================================================

async function testLocalNotify(): Promise<void> {
  console.log('\n📤 通知发送（本地服务器）');

  await runTest('notify 发送 JSON POST 到本地服务器', async () => {
    const { server, port, onRequest } = await createTestServer();

    let receivedBody: any = null;
    let receivedHeaders: Record<string, string> = {};

    onRequest((req, body) => {
      receivedBody = JSON.parse(body);
      receivedHeaders = { ...req.headers } as Record<string, string>;
    });

    const n = new WebhookNotifier();
    n.add(`http://localhost:${port}/hook`);

    await n.notify('test.event', { key: 'value' });

    // 等待异步处理
    await sleep(50);

    assert(receivedBody !== null, '应收到 POST 请求');
    assert(receivedBody.event === 'test.event', `event 应为 test.event，实际: ${receivedBody?.event}`);
    assert(receivedBody.data.key === 'value', `data.key 应为 value，实际: ${receivedBody?.data?.key}`);
    assert(receivedBody.timestamp !== undefined, '应包含 timestamp');
    assert(receivedHeaders['content-type'] === 'application/json',
      `Content-Type 应为 application/json，实际: ${receivedHeaders['content-type']}`);

    server.close();
  });

  await runTest('notify 包含自定义 headers', async () => {
    const { server, port, onRequest } = await createTestServer();

    let receivedHeaders: Record<string, string> = {};

    onRequest((req) => {
      receivedHeaders = { ...req.headers } as Record<string, string>;
    });

    const n = new WebhookNotifier();
    n.add(`http://localhost:${port}/hook`, { 'X-Custom-Token': 'abc123' });

    await n.notify('test.event', {});
    await sleep(50);

    assert(receivedHeaders['x-custom-token'] === 'abc123',
      `自定义 header 应传递，实际: ${receivedHeaders['x-custom-token']}`);

    server.close();
  });

  await runTest('notify 触发 delivered 事件', async () => {
    const { server, port } = await createTestServer();

    let delivered = false;
    const n = new WebhookNotifier();
    n.on('delivered', () => { delivered = true; });
    n.add(`http://localhost:${port}/hook`);

    await n.notify('test.event', {});
    await sleep(50);

    assert(delivered, '成功时应触发 delivered 事件');

    server.close();
  });
}

// ============================================================
//  错误处理测试
// ============================================================

async function testErrorHandling(): Promise<void> {
  console.log('\n🛡️ 错误处理');

  await runTest('notify 服务器不存在时触发 failed 事件', async () => {
    const n = new WebhookNotifier({ maxRetries: 0 });

    let failedPayload: WebhookPayload | null = null;
    n.on('failed', (_config: WebhookConfig, payload: WebhookPayload) => {
      failedPayload = payload;
    });

    // 使用未监听的端口
    n.add('http://127.0.0.1:19999/nonexistent');

    await n.notify('test.event', { test: true });
    await sleep(100);

    assert(failedPayload !== null, '应触发 failed 事件');
    assert(failedPayload!.event === 'test.event', 'failed 事件应包含 payload');
    n.clear();
  });

  await runTest('notify 失败不抛出异常', async () => {
    const n = new WebhookNotifier({ maxRetries: 0 });
    n.add('http://127.0.0.1:19999/nonexistent');

    let threw = false;
    try {
      await n.notify('test.event', {});
    } catch {
      threw = true;
    }

    assert(!threw, 'notify 失败不应抛出异常');
    n.clear();
  });

  await runTest('多个端点互不影响', async () => {
    const { server, port } = await createTestServer();

    let successCount = 0;
    let failCount = 0;

    const n = new WebhookNotifier({ maxRetries: 0 });
    n.on('delivered', () => { successCount++; });
    n.on('failed', () => { failCount++; });

    n.add(`http://localhost:${port}/hook`); // 成功
    n.add('http://127.0.0.1:19999/nonexistent'); // 失败

    await n.notify('test.event', {});
    await sleep(100);

    assert(successCount === 1, '成功的端点应触发 1 次 delivered');
    assert(failCount === 1, '失败的端点应触发 1 次 failed');

    server.close();
  });
}

// ============================================================
//  事件类型
// ============================================================

async function testEventTypes(): Promise<void> {
  console.log('\n🏷️ 事件类型');

  await runTest('delivered 事件携带正确参数', async () => {
    const { server, port } = await createTestServer();

    let capturedConfig: WebhookConfig | null = null;
    let capturedPayload: WebhookPayload | null = null;

    const n = new WebhookNotifier();
    n.on('delivered', (config: WebhookConfig, payload: WebhookPayload) => {
      capturedConfig = config;
      capturedPayload = payload;
    });

    n.add(`http://localhost:${port}/hook`, { 'X-Id': 'test-1' });
    await n.notify('job.completed', { jobId: 'j1' });
    await sleep(50);

    assert(capturedConfig !== null, '应捕获 config');
    assert(capturedConfig!.url.includes(`:${port}`), 'config.url 正确');
    assert(capturedConfig!.headers!['X-Id'] === 'test-1', 'config.headers 正确');
    assert(capturedPayload !== null, '应捕获 payload');
    assert(capturedPayload!.event === 'job.completed', 'payload.event 正确');
    assert(capturedPayload!.data.jobId === 'j1', 'payload.data 正确');
    assert(typeof capturedPayload!.timestamp === 'string', 'payload.timestamp 为字符串');
    // 验证 ISO 8601 格式
    assert(!isNaN(Date.parse(capturedPayload!.timestamp)), 'timestamp 应为有效日期');

    server.close();
  });

  await runTest('failed 事件携带错误信息', async () => {
    const n = new WebhookNotifier({ maxRetries: 0 });

    let capturedError: Error | null = null;
    n.on('failed', (_config: WebhookConfig, _payload: WebhookPayload, error: Error) => {
      capturedError = error;
    });

    n.add('http://127.0.0.1:19999/nonexistent');
    await n.notify('test.event', {});
    await sleep(100);

    assert(capturedError !== null, 'failed 事件应携带错误');
    n.clear();
  });
}

// ============================================================
//  URL 协议验证
// ============================================================

async function testUrlProtocols(): Promise<void> {
  console.log('\n🔗 URL 验证');

  await runTest('支持多个不同 URL 的端点', async () => {
    const { server, port } = await createTestServer();

    let callCount = 0;
    const n = new WebhookNotifier({ maxRetries: 0 });
    n.on('delivered', () => { callCount++; });

    n.add(`http://localhost:${port}/a`);
    n.add(`http://localhost:${port}/b`);

    await n.notify('test', {});
    await sleep(50);

    assert(callCount === 2, '2 个端点应收到 2 次通知');

    server.close();
  });

  await runTest('timestamps 在每次通知中不同', async () => {
    const { server, port, onRequest } = await createTestServer();

    const timestamps: string[] = [];
    onRequest((_req, body) => {
      const parsed = JSON.parse(body);
      timestamps.push(parsed.timestamp);
    });

    const n = new WebhookNotifier({ maxRetries: 0 });
    n.add(`http://localhost:${port}/hook`);

    await n.notify('event1', {});
    await sleep(50);
    await n.notify('event2', {});
    await sleep(50);

    assert(timestamps.length === 2, '应收到 2 个请求');
    assert(timestamps[0] !== timestamps[1], '两次通知的 timestamp 应不同');

    server.close();
  });

  await runTest('count 属性反映当前注册数', async () => {
    const n = new WebhookNotifier();
    assert(n.count === 0, '初始 count 为 0');
    n.add('https://a.com');
    assert(n.count === 1, '添加后 count 为 1');
    n.add('https://b.com');
    assert(n.count === 2, '添加第二个后 count 为 2');
    n.remove('https://a.com');
    assert(n.count === 1, '移除后 count 为 1');
  });
}

// ============================================================
//  主函数
// ============================================================

async function main(): Promise<void> {
  console.log('🧪 Webhook 通知器（WebhookNotifier）单元测试\n');

  await testRegistration();
  await testLocalNotify();
  await testErrorHandling();
  await testEventTypes();
  await testUrlProtocols();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 结果: ${pass}/${pass + fail} 通过`);
  console.log(`${'='.repeat(50)}\n`);

  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
