/**
 * 会话管理模块集成测试
 * 运行: pnpm test:session
 *
 * 测试覆盖：
 *   - 会话 CRUD（创建、查看、切换、删除）
 *   - 持久化（重启后恢复）
 *   - ContextManager 序列化/反序列化
 *   - 会话导出
 *
 * 注意：使用 SMARTAGENT_SESSIONS_DIR 环境变量隔离测试目录。
 * 必须用动态 import 确保环境变量在模块初始化前生效（ESM 静态导入会被提升）。
 */

import { mkdtempSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// 使用临时目录隔离测试
const TEST_DIR = mkdtempSync(join(tmpdir(), 'session-integration-'));
const SESSIONS_DIR = join(TEST_DIR, 'sessions');
process.env.SMARTAGENT_SESSIONS_DIR = SESSIONS_DIR;

// 动态导入（确保 env var 已设置后再初始化 session 模块）
const { SessionManager } = await import('../../src/cli/utils/session.js');
const { ContextManager } = await import('../../src/cli/context-aware.js');

// ============================================================
//  测试工具
// ============================================================

let testCount = 0;
let passCount = 0;
let failCount = 0;
const pendingAsync: Promise<void>[] = [];

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function assertEq<T>(a: T, b: T, msg: string = ''): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error(`${msg ? msg + ': ' : ''}期望 ${JSON.stringify(b)}, 实际 ${JSON.stringify(a)}`);
    }
}

function test(name: string, fn: () => void | Promise<void>): void {
    testCount++;
    try {
        const result = fn();
        if (result instanceof Promise) {
            pendingAsync.push(
                result.then(() => {
                    passCount++;
                    console.log(`  ✅ ${name}`);
                }).catch((err) => {
                    failCount++;
                    console.log(`  ❌ ${name}: ${(err as Error).message}`);
                }),
            );
        } else {
            passCount++;
            console.log(`  ✅ ${name}`);
        }
    } catch (err) {
        failCount++;
        console.log(`  ❌ ${name}: ${(err as Error).message}`);
    }
}

/**
 * 清理测试 sessions 目录中所有文件
 */
function cleanSessions(): void {
    if (!existsSync(SESSIONS_DIR)) return;
    const files = readdirSync(SESSIONS_DIR);
    for (const f of files) {
        try { rmSync(join(SESSIONS_DIR, f), { force: true }); } catch { /* */ }
    }
}

// ============================================================
//  Setup: 清理前测试残留
// ============================================================
cleanSessions();

// ============================================================
//  同步测试
// ============================================================

test('创建会话 — create() 返回有效 ID', () => {
    cleanSessions();
    const mgr = new SessionManager();
    const id = mgr.create('测试会话', 'deepseek-chat');
    assert(typeof id === 'string', '会话 ID 应为字符串');
    assert(id.length > 0, '会话 ID 不应为空');
});

test('列出会话 — list() 返回会话列表', async () => {
    cleanSessions();
    const mgr = new SessionManager();
    mgr.create('会话1');
    // 延迟确保时间戳不同
    await new Promise(r => setTimeout(r, 2));
    mgr.create('会话2');

    const sessions = mgr.list();
    assert(sessions.length === 2, `应有 2 个会话，实际 ${sessions.length}`);
    assertEq(sessions[0].name, '会话2', '最新会话应排在最前');
});

test('切换会话 — switch() 更改 currentId', () => {
    cleanSessions();
    const mgr = new SessionManager();
    const id1 = mgr.create('会话1');
    const id2 = mgr.create('会话2');

    assertEq(mgr.currentId, id2, '当前应为最后创建的会话');

    const success = mgr.switch(id1);
    assert(success, '切换应成功');
    assertEq(mgr.currentId, id1, '当前应切换到会话1');
});

test('删除会话 — delete() 移除会话并更新 currentId', () => {
    cleanSessions();
    const mgr = new SessionManager();
    const id = mgr.create('待删除');
    assert(mgr.list().length === 1, `应有 1 个会话，实际 ${mgr.list().length}`);

    const deleted = mgr.delete(id);
    assert(deleted, '删除应成功');
    assert(mgr.list().length === 0, `删除后应为 0 个会话，实际 ${mgr.list().length}`);
});

test('重命名会话 — rename() 更新名称', () => {
    cleanSessions();
    const mgr = new SessionManager();
    const id = mgr.create('原名');
    mgr.rename(id, '新名');
    const meta = mgr.getMeta(id);
    assert(meta !== null, '应获取到元数据');
    assertEq(meta!.name, '新名', '名称应更新');
});

// ============================================================
//  异步测试
// ============================================================

async function runAsyncTests(): Promise<void> {
    console.log('  🔄 异步持久化 / 导出测试...');

    // 持久化测试
    testCount++;
    try {
        cleanSessions();
        const mgr1 = new SessionManager();
        const id = mgr1.create('持久化测试');
        const list1 = mgr1.list();
        assert(list1.length === 1, `第一次应有 1 个会话，实际 ${list1.length}`);

        // 模拟重启：创建新的 SessionManager 实例
        const mgr2 = new SessionManager();
        const list2 = mgr2.list();
        assert(list2.length === 1, `重启后应有 1 个会话，实际 ${list2.length}`);
        assertEq(list2[0].id, id, '会话 ID 应一致');
        assertEq(list2[0].name, '持久化测试', '会话名称应一致');

        passCount++;
        console.log('  ✅ 会话持久化（重启后恢复）');
    } catch (err) {
        failCount++;
        console.log(`  ❌ 会话持久化: ${(err as Error).message}`);
    }

    // ContextManager 序列化测试
    testCount++;
    try {
        const ctx = new ContextManager('系统提示');
        ctx.addUserMessage('你好');
        ctx.addAssistantMessage('你好！有什么可以帮助你的？');
        const json = ctx.toJSON();
        const restored = ContextManager.fromJSON(json);
        assertEq(restored.length, 3, '恢复后应有 3 条消息（system + user + assistant）');
        passCount++;
        console.log('  ✅ ContextManager JSON 序列化/反序列化');
    } catch (err) {
        failCount++;
        console.log(`  ❌ ContextManager 序列化: ${(err as Error).message}`);
    }

    // 导出测试
    testCount++;
    try {
        cleanSessions();
        const mgr = new SessionManager();
        const id = mgr.create('导出测试');
        const ctx = new ContextManager();
        ctx.addUserMessage('测试消息');
        mgr.saveContext(id, ctx);

        const textExport = mgr.exportAsText(id);
        assert(textExport.includes('测试消息'), '文本导出应包含消息内容');
        assert(textExport.includes('👤 用户'), '文本导出应包含角色标签');

        const jsonExport = mgr.exportAsJSON(id);
        const parsedExport = JSON.parse(jsonExport);
        assert(parsedExport.messages !== undefined, 'JSON 导出应包含 messages');

        passCount++;
        console.log('  ✅ 会话导出（文本/JSON）');
    } catch (err) {
        failCount++;
        console.log(`  ❌ 会话导出: ${(err as Error).message}`);
    }
}

await runAsyncTests();
await Promise.all(pendingAsync);

// ============================================================
//  清理
// ============================================================
try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* */ }

console.log(`\n=== session-integration: ${passCount}/${testCount} 通过, ${failCount} 失败 ===\n`);
process.exit(failCount > 0 ? 1 : 0);
