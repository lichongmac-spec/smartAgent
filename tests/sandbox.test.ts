/**
 * sandbox.test.ts — 安全沙箱单元测试
 *
 * 覆盖：
 *  - 路径越界拦截（绝对路径、相对路径 .. 攻击）
 *  - 允许路径内读写
 *  - 文件大小截断
 *  - 命令黑白名单
 *  - 超时配置
 *  - 写入内容大小限制
 *  - 创建/读取/清理的完整流程
 */

import { Sandbox } from '../src/agent/sandbox/sandbox.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

async function main(): Promise<void> {
  console.log('\n=== 安全沙箱测试 ===\n');

  const testRoot = join(tmpdir(), 'sandbox-test-' + Date.now());
  await fs.mkdir(testRoot, { recursive: true });

  // ── 1: 路径越界拦截（绝对路径） ──

  await test('绝对路径越界拦截', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot });
    const result = await sandbox.readFile('/etc/passwd');
    assert(!result.success, '越界读取应失败');
    assert(result.error?.includes('不在允许的根目录内') ?? false, '错误信息应提示越界');
  });

  // ── 2: 相对路径 .. 越界 ──

  await test('相对路径 .. 越界拦截', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot });
    const result = await sandbox.readFile('../outside.txt');
    assert(!result.success, '.. 越界应被拦截');
  });

  // ── 3: 允许路径内读取 ──

  await test('允许路径内读取', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot });
    const filePath = join(testRoot, 'test.txt');
    await fs.writeFile(filePath, 'hello sandbox', 'utf-8');

    const result = await sandbox.readFile(filePath);
    assert(result.success, '读取应成功');
    assertEq(result.data, 'hello sandbox');
  });

  // ── 4: 允许路径内写入 ──

  await test('允许路径内写入', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot });
    const filePath = join(testRoot, 'write-test.txt');

    const result = await sandbox.writeFile(filePath, 'written content');
    assert(result.success, '写入应成功');

    const content = await fs.readFile(filePath, 'utf-8');
    assertEq(content, 'written content');
  });

  // ── 5: 越界写入拦截 ──

  await test('越界写入拦截', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot });
    const result = await sandbox.writeFile('/etc/malicious', 'bad');
    assert(!result.success, '越界写入应失败');
  });

  // ── 6: 文件大小截断 ──

  await test('文件大小截断', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot, maxFileSize: 10 });
    const filePath = join(testRoot, 'large.txt');
    const longText = '这是一个很长的文本内容，超过10字节' + 'x'.repeat(100);
    await fs.writeFile(filePath, longText, 'utf-8');

    const result = await sandbox.readFile(filePath);
    assert(result.success, '读取应成功（截断）');
    assert(result.data?.includes('已截断') ?? false, '应包含截断提示');
  });

  // ── 7: 写入内容大小限制 ──

  await test('写入内容大小限制', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot, maxFileSize: 5 });
    const result = await sandbox.writeFile(join(testRoot, 'big.txt'), 'too large content');
    assert(!result.success, '超大写入应失败');
    assert(result.error?.includes('超过最大限制') ?? false, '错误信息应提示大小限制');
  });

  // ── 8: 命令黑名单 ──

  await test('命令黑名单拦截 rm', async () => {
    const sandbox = new Sandbox({ forbiddenCommands: ['rm'] });
    const result = await sandbox.executeCommand('rm -rf /');
    assert(!result.success, 'rm 应被拦截');
    assert(result.error?.includes('禁止执行') ?? false, '错误信息应包含禁止提示');
  });

  await test('命令黑名单拦截 sudo', async () => {
    const sandbox = new Sandbox({ forbiddenCommands: ['sudo'] });
    const result = await sandbox.executeCommand('sudo echo hello');
    assert(!result.success, 'sudo 应被拦截');
  });

  // ── 9: 命令白名单 ──

  await test('命令白名单：允许 echo，拒绝 ls', async () => {
    const sandbox = new Sandbox({ allowedCommands: ['echo'] });

    const r1 = await sandbox.executeCommand('echo hello');
    assert(r1.success, '白名单中的 echo 应成功');

    const r2 = await sandbox.executeCommand('ls');
    assert(!r2.success, '不在白名单的 ls 应被拒绝');
  });

  // ── 10: 超时配置 ──

  await test('超时配置生效', async () => {
    const sandbox = new Sandbox({ timeout: 123 });
    assertEq(sandbox.getConfig().timeout, 123);
  });

  // ── 11: 不存在文件读取 ──

  await test('读取不存在的文件', async () => {
    const sandbox = new Sandbox({ allowedRoot: testRoot });
    const result = await sandbox.readFile(join(testRoot, 'nonexistent.txt'));
    assert(!result.success, '读取不存在文件应失败');
  });

  // ── 12: 默认配置 ──

  await test('默认沙箱配置', async () => {
    const sandbox = new Sandbox();
    const config = sandbox.getConfig();
    assertEq(config.maxFileSize, 1024 * 1024);
    assertEq(config.timeout, 30000);
    assertEq(config.allowNetwork, false);
    assert(config.forbiddenCommands.includes('rm'));
  });

  // ── 清理 ──
  await fs.rm(testRoot, { recursive: true, force: true });

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
