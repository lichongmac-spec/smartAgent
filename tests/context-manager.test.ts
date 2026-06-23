/**
 * context-manager.test.ts - 上下文管理器测试
 *
 * 测试范围：
 *  - 创建上下文（带/不带 systemPrompt）
 *  - 添加消息（user/assistant/system/tool）
 *  - 查看消息（getMessages/getConversation/getLastN/getSystemMessages）
 *  - 统计信息（getStats/totalTokens/length）
 *  - 滑动窗口裁剪（trimTo）
 *  - 序列化/反序列化（toJSON/fromJSON）
 *  - 清空消息（clear）
 *  - 系统消息保留逻辑
 */

import { ContextManager } from '../src/context/context-manager.js';

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

function assertGt(a: number, b: number, msg?: string): void {
  if (!(a > b)) throw new Error(msg ?? `期望 ${a} > ${b}`);
}

function assertLt(a: number, b: number, msg?: string): void {
  if (!(a < b)) throw new Error(msg ?? `期望 ${a} < ${b}`);
}

function assertContains(haystack: string, needle: string, msg?: string): void {
  if (!haystack.includes(needle)) throw new Error(msg ?? `"${haystack}" 中未找到 "${needle}"`);
}

function assertBetween(val: number, lo: number, hi: number, msg?: string): void {
  if (!(val >= lo && val <= hi)) throw new Error(msg ?? `期望 ${val} 在 [${lo}, ${hi}] 之间`);
}

async function main() {
  console.log('\n=== 上下文管理器测试 ===\n');

  // ============================================================
  //  1. 创建上下文
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    assert(ctx instanceof ContextManager, '应成功创建 ContextManager');
    assert(typeof ctx.sessionId === 'string', 'sessionId 应为字符串');
    assert(ctx.sessionId.length > 0, 'sessionId 不应为空');
    assert(ctx.createdAt instanceof Date, 'createdAt 应为 Date');
    assert(ctx.updatedAt instanceof Date, 'updatedAt 应为 Date');
    assertEq(ctx.length, 0, '无 systemPrompt 时消息应为 0');
    passCount++;
    console.log('  ✅ 创建空上下文');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 创建空上下文: ${(e as Error).message}`);
  }

  // ============================================================
  //  2. 创建带 systemPrompt 的上下文
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('你是一个编程助手');
    assertEq(ctx.length, 1, '应有一条系统消息');
    const msgs = ctx.getMessages();
    assertEq(msgs[0].role, 'system');
    assertEq(msgs[0].content, '你是一个编程助手');
    passCount++;
    console.log('  ✅ 创建带系统提示的上下文');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 创建带系统提示的上下文: ${(e as Error).message}`);
  }

  // ============================================================
  //  3. 添加用户消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addUserMessage('你好');
    assertEq(ctx.length, 1, '应有一条消息');
    const last = ctx.getMessages()[0];
    assertEq(last.role, 'user');
    assertEq(last.content, '你好');
    passCount++;
    console.log('  ✅ 添加用户消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 添加用户消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  4. 添加助手消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addAssistantMessage('你好！我是 AI');
    assertEq(ctx.length, 1);
    const last = ctx.getMessages()[0];
    assertEq(last.role, 'assistant');
    assertEq(last.content, '你好！我是 AI');
    passCount++;
    console.log('  ✅ 添加助手消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 添加助手消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  5. 添加系统消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addSystemMessage('请用中文回答');
    assertEq(ctx.length, 1);
    const last = ctx.getMessages()[0];
    assertEq(last.role, 'system');
    assertEq(last.content, '请用中文回答');
    passCount++;
    console.log('  ✅ 添加系统消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 添加系统消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  6. 添加工具消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addToolMessage('文件读取成功: 100 行');
    assertEq(ctx.length, 1);
    const last = ctx.getMessages()[0];
    assertEq(last.role, 'tool');
    assertContains(last.content, '文件读取成功');
    passCount++;
    console.log('  ✅ 添加工具消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 添加工具消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  7. getMessages 返回消息副本（不可变）
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addUserMessage('hello');
    const msgs1 = ctx.getMessages();
    const msgs2 = ctx.getMessages();
    // 应该是不同的引用（返回副本）
    assert(msgs1 !== msgs2, 'getMessages 每次应返回新副本');
    // 修改副本不应影响原数据
    msgs1.push({ role: 'assistant', content: 'hi' });
    assertEq(ctx.length, 1, '修改副本不应影响上下文');
    passCount++;
    console.log('  ✅ getMessages 返回不可变副本');
  } catch (e) {
    failCount++;
    console.log(`  ❌ getMessages 返回不可变副本: ${(e as Error).message}`);
  }

  // ============================================================
  //  8. getConversation 排除系统消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addUserMessage('你好');
    ctx.addAssistantMessage('你好！');
    const conv = ctx.getConversation();
    assertEq(conv.length, 2, '应只有 user + assistant');
    assertEq(conv[0].role, 'user');
    assertEq(conv[1].role, 'assistant');
    passCount++;
    console.log('  ✅ getConversation 排除系统消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ getConversation 排除系统消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  9. getLastN 获取最后 N 条消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('提示');
    ctx.addUserMessage('1');
    ctx.addAssistantMessage('a');
    ctx.addUserMessage('2');
    ctx.addAssistantMessage('b');

    // 不含 system
    let last = ctx.getLastN(2);
    assertEq(last.length, 2, '应返回 2 条');
    assertEq(last[0].role, 'user');
    assertEq(last[0].content, '2');
    assertEq(last[1].role, 'assistant');
    assertEq(last[1].content, 'b');

    // 含 system
    last = ctx.getLastN(2, true);
    assertEq(last.length, 2, '含 system 时应返回 2 条');
    assert(last.some(m => m.role === 'assistant'), '应包含 assistant');

    // N 大于总消息数
    last = ctx.getLastN(100);
    assertEq(last.length, 4, 'N 大于总数时返回所有非系统消息');

    passCount++;
    console.log('  ✅ getLastN 获取最后 N 条');
  } catch (e) {
    failCount++;
    console.log(`  ❌ getLastN: ${(e as Error).message}`);
  }

  // ============================================================
  //  10. getSystemMessages
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addSystemMessage('第二条公告');
    ctx.addUserMessage('hello');
    const sys = ctx.getSystemMessages();
    assertEq(sys.length, 2, '应有 2 条系统消息');
    assertEq(sys[0].content, '系统提示');
    assertEq(sys[1].content, '第二条公告');
    passCount++;
    console.log('  ✅ getSystemMessages');
  } catch (e) {
    failCount++;
    console.log(`  ❌ getSystemMessages: ${(e as Error).message}`);
  }

  // ============================================================
  //  11. getStats 统计信息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addUserMessage('你好');
    ctx.addAssistantMessage('你好！');
    ctx.addUserMessage('帮助');
    ctx.addAssistantMessage('好的');

    const stats = ctx.getStats();
    assertEq(stats.messageCount, 5, '应共 5 条消息');
    assertEq(stats.byRole.system, 1);
    assertEq(stats.byRole.user, 2);
    assertEq(stats.byRole.assistant, 2);
    assertEq(stats.byRole.tool, 0);
    assertGt(stats.estimatedTokens, 0, 'Token 估数应 > 0');
    assertGt(stats.totalChars, 0, '字符数应 > 0');
    passCount++;
    console.log('  ✅ getStats 统计信息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ getStats: ${(e as Error).message}`);
  }

  // ============================================================
  //  12. totalTokens 属性
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addUserMessage('hello world');
    assertGt(ctx.totalTokens, 0, 'totalTokens 应 > 0');
    passCount++;
    console.log('  ✅ totalTokens 属性');
  } catch (e) {
    failCount++;
    console.log(`  ❌ totalTokens: ${(e as Error).message}`);
  }

  // ============================================================
  //  13. 滑动窗口裁剪 - trimTo
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    // 添加大量消息使其超过限制
    for (let i = 0; i < 20; i++) {
      ctx.addUserMessage(`用户消息 ${i + 1}`);
      ctx.addAssistantMessage(`助手回复 ${i + 1}`);
    }

    const beforeCount = ctx.length;
    const removed = ctx.trimTo(150, 1.2);
    const afterCount = ctx.length;

    assert(beforeCount > afterCount, '裁剪后消息数应减少');
    assert(removed > 0, '应删除一些消息');
    assert(afterCount >= 2, '至少保留 system + 1 条普通消息');

    // 系统消息应保留
    const sysMsgs = ctx.getSystemMessages();
    assertEq(sysMsgs.length, 1, '系统消息应保留');

    // 保留的是最近的消息
    const msgs = ctx.getMessages();
    const lastNonSys = msgs.filter(m => m.role !== 'system');
    assertContains(lastNonSys[lastNonSys.length - 1].content, '助手回复 20');

    passCount++;
    console.log('  ✅ trimTo 滑动窗口裁剪');
  } catch (e) {
    failCount++;
    console.log(`  ❌ trimTo: ${(e as Error).message}`);
  }

  // ============================================================
  //  14. trimTo 空消息不减
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    const removed = ctx.trimTo(100);
    assertEq(removed, 0, '无消息时不应删除');
    passCount++;
    console.log('  ✅ trimTo 空消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ trimTo 空消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  15. trimTo 不删除时返回 0
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    ctx.addUserMessage('hi');
    ctx.addAssistantMessage('hello');
    const removed = ctx.trimTo(100000, 1.2); // 很大的限制
    assertEq(removed, 0, '未超限时不应删除');
    passCount++;
    console.log('  ✅ trimTo 未超限不删除');
  } catch (e) {
    failCount++;
    console.log(`  ❌ trimTo 未超限: ${(e as Error).message}`);
  }

  // ============================================================
  //  16. 序列化 - toJSON
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addUserMessage('你好');
    ctx.addAssistantMessage('你好！');

    const json = ctx.toJSON();
    assert(typeof json === 'string', 'toJSON 应返回字符串');
    assertContains(json, 'sessionId');
    assertContains(json, 'messages');
    assertContains(json, '系统提示');
    assertContains(json, '你好');

    // 解析验证
    const parsed = JSON.parse(json);
    assertEq(parsed.messages.length, 3);
    assertEq(parsed.messages[0].role, 'system');
    assertEq(parsed.messages[1].role, 'user');
    assertEq(parsed.messages[2].role, 'assistant');

    passCount++;
    console.log('  ✅ toJSON 序列化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ toJSON: ${(e as Error).message}`);
  }

  // ============================================================
  //  17. 反序列化 - fromJSON
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addUserMessage('我叫小明');
    ctx.addAssistantMessage('你好小明！');

    const json = ctx.toJSON();
    const restored = ContextManager.fromJSON(json);

    assert(restored instanceof ContextManager, 'fromJSON 应返回 ContextManager');
    assertEq(restored.length, 3, '恢复后应有 3 条消息');
    assertEq(restored.sessionId, ctx.sessionId, '会话 ID 应一致');

    const msgs = restored.getMessages();
    assertEq(msgs[1].content, '我叫小明', '用户消息应恢复');
    assertEq(msgs[2].content, '你好小明！', '助手消息应恢复');

    passCount++;
    console.log('  ✅ fromJSON 反序列化');
  } catch (e) {
    failCount++;
    console.log(`  ❌ fromJSON: ${(e as Error).message}`);
  }

  // ============================================================
  //  18. fromJSON 缺少 messages 字段
  // ============================================================

  testCount++;
  try {
    let threw = false;
    try {
      ContextManager.fromJSON('{}');
    } catch (e) {
      threw = true;
      assert((e as Error).message.includes('缺少 messages'), '应提示缺少 messages');
    }
    assert(threw, '空 JSON 对象应抛出异常');
    passCount++;
    console.log('  ✅ fromJSON 缺少 messages');
  } catch (e) {
    failCount++;
    console.log(`  ❌ fromJSON 缺少 messages: ${(e as Error).message}`);
  }

  // ============================================================
  //  19. clear 保留系统消息
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addUserMessage('hello');
    ctx.addAssistantMessage('hi');

    ctx.clear(); // 默认 keepSystem=true
    assertEq(ctx.length, 1, '清除后应有 1 条系统消息');
    assertEq(ctx.getMessages()[0].role, 'system');
    assertEq(ctx.getMessages()[0].content, '系统提示');

    passCount++;
    console.log('  ✅ clear 保留系统消息');
  } catch (e) {
    failCount++;
    console.log(`  ❌ clear 保留系统消息: ${(e as Error).message}`);
  }

  // ============================================================
  //  20. clear(false) 全部清空
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('系统提示');
    ctx.addUserMessage('hello');

    ctx.clear(false);
    assertEq(ctx.length, 0, '应全部清空');

    passCount++;
    console.log('  ✅ clear(false) 全部清空');
  } catch (e) {
    failCount++;
    console.log(`  ❌ clear(false): ${(e as Error).message}`);
  }

  // ============================================================
  //  21. updatedAt 更新
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    const before = ctx.updatedAt.getTime();

    // 等待 1ms 以确保时间不同
    await new Promise(r => setTimeout(r, 2));

    ctx.addUserMessage('hello');
    const after = ctx.updatedAt.getTime();

    assert(after > before, 'updatedAt 应在添加消息后更新');

    passCount++;
    console.log('  ✅ updatedAt 自动更新');
  } catch (e) {
    failCount++;
    console.log(`  ❌ updatedAt: ${(e as Error).message}`);
  }

  // ============================================================
  //  22. sessionId 格式
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager();
    const id = ctx.sessionId;
    // 格式：YYYYMMDD-HHMMSS-xxxx
    assert(/^\d{8}-\d{6}-[a-z0-9]{4}$/.test(id), `sessionId 格式应为 YYYYMMDD-HHMMSS-xxxx: ${id}`);
    passCount++;
    console.log('  ✅ sessionId 格式');
  } catch (e) {
    failCount++;
    console.log(`  ❌ sessionId 格式: ${(e as Error).message}`);
  }

  // ============================================================
  //  23. 完整对话流程仿真
  // ============================================================

  testCount++;
  try {
    const ctx = new ContextManager('你是一个有用的助手');

    // 模拟 3 轮对话
    ctx.addUserMessage('我叫小明');
    ctx.addAssistantMessage('你好小明！');
    ctx.addUserMessage('帮我写个 hello world');
    ctx.addAssistantMessage('```js\nconsole.log("hello world");\n```');
    ctx.addUserMessage('谢谢');
    ctx.addAssistantMessage('不客气！');

    // 验证对话完整性
    const msgs = ctx.getMessages();
    assertEq(msgs.length, 7, '应共 7 条消息（含 system）');

    // 统计
    const stats = ctx.getStats();
    assertEq(stats.byRole.user, 3);
    assertEq(stats.byRole.assistant, 3);

    // 获取对话内容（不含 system）
    const conv = ctx.getConversation();
    assertEq(conv.length, 6);

    // 上下文中的名字应该存在
    assertContains(msgs[1].content, '小明', '第一轮对话应该保存');

    passCount++;
    console.log('  ✅ 完整对话流程仿真');
  } catch (e) {
    failCount++;
    console.log(`  ❌ 完整对话流程: ${(e as Error).message}`);
  }

  // ============================================================
  //  结果
  // ============================================================

  console.log(`\n📊 结果: ${passCount}/${testCount} 通过, ${failCount} 失败`);
  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error(`❌ 测试运行失败: ${(err as Error).message}`);
  process.exit(1);
});
