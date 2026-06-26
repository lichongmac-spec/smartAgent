/**
 * sandbox/sandbox-demo.ts
 *
 * 演示沙箱的各项安全功能
 *
 * 运行方式：
 *   pnpm tsx src/sandbox/sandbox-demo.ts
 *
 * 演示内容：
 * 1. 创建沙箱，限制只能访问当前目录
 * 2. 读取沙箱内的安全文件 → 成功
 * 3. 读取越界文件 /etc/passwd → 被拦截
 * 4. 执行安全命令 echo → 成功
 * 5. 执行危险命令 rm → 被拦截
 * 6. 文件大小限制 → 截断
 */

import { Sandbox, createDefaultSandbox } from './sandbox.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const SEP = '━'.repeat(60);

async function main(): Promise<void> {
  console.log('\n🛡️ 安全沙箱演示');
  console.log(SEP);

  // ── 1. 创建沙箱 ──
  const sandbox = createDefaultSandbox();
  console.log(`✅ 沙箱已创建`);
  console.log(`   允许根目录: ${sandbox.getConfig().allowedRoot}`);
  console.log(`   禁止命令: ${sandbox.getConfig().forbiddenCommands.join(', ')}`);
  console.log(`   最大文件: ${(sandbox.getConfig().maxFileSize / 1024).toFixed(0)}KB`);
  console.log(`   超时: ${sandbox.getConfig().timeout}ms`);

  // ── 2. 准备测试文件 ──
  const testDir = join(process.cwd(), 'sandbox-test');
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  const safeFile = join(testDir, 'hello.txt');
  writeFileSync(safeFile, '这是沙箱内的文件，安全！');
  console.log(`\n📄 创建测试文件: sandbox-test/hello.txt`);

  // ── 3. 读取允许的文件 ──
  console.log('\n📖 读取允许的文件 hello.txt ...');
  const r1 = await sandbox.readFile(safeFile);
  printResult(r1);

  // ── 4. 尝试读取越界文件 ──
  console.log('\n🔓 尝试读取越界文件 /etc/passwd ...');
  const r2 = await sandbox.readFile('/etc/passwd');
  printResult(r2);

  // ── 5. 执行安全命令 ──
  console.log('\n💻 执行安全命令: echo hello ...');
  const r3 = await sandbox.executeCommand('echo hello');
  printResult(r3);

  // ── 6. 执行危险命令 ──
  console.log('\n💀 尝试执行危险命令: rm -rf / ...');
  const r4 = await sandbox.executeCommand('rm -rf /');
  printResult(r4);

  // ── 7. 文件大小截断 ──
  const largeContent = 'A'.repeat(2000);
  const largeFile = join(testDir, 'large.txt');
  writeFileSync(largeFile, largeContent);

  const smallSandbox = new Sandbox({ maxFileSize: 100 });
  console.log(`\n📏 读取大文件（2000字节）→ 限制 100 字节...`);
  const r5 = await smallSandbox.readFile(largeFile);
  printResult(r5);

  // ── 8. 写入超大内容 ──
  console.log('\n✍️ 尝试写入超出限制的内容...');
  const r6 = await smallSandbox.writeFile(join(testDir, 'output.txt'), largeContent);
  printResult(r6);

  // ── 清理 ──
  rmSync(testDir, { recursive: true, force: true });

  console.log(`\n🎉 演示完成！\n`);
}

function printResult<T>(r: { success: boolean; data?: T; error?: string; duration: number }): void {
  if (r.success) {
    const preview = typeof r.data === 'string' ? r.data.slice(0, 60).replace(/\n/g, '↵') : String(r.data);
    console.log(`  ✅ 成功 (${r.duration}ms): ${preview}`);
  } else {
    console.log(`  ❌ 被拦截 (${r.duration}ms): ${r.error}`);
  }
}

main().catch((e) => {
  console.error('演示出错:', e);
  process.exit(1);
});
