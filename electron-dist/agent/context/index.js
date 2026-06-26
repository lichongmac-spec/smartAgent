"use strict";
/**
 * index.ts - 上下文管理层入口 + 演示
 *
 * 理解：这是上下文的"大厅"——既能导出模块，又能运行演示
 *
 * 运行演示：
 *   pnpm tsx src/context/index.ts
 *
 * 使用模块：
 *   import { ContextManager } from './context/index.js';
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextManager = void 0;
var context_manager_js_1 = require("./context-manager.js");
Object.defineProperty(exports, "ContextManager", { enumerable: true, get: function () { return context_manager_js_1.ContextManager; } });
// ============================================================
//  演示代码（直接运行时执行）
// ============================================================
// 只在直接运行这个文件时执行演示，被 import 时不执行
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
    runDemo().catch(err => {
        console.error(`❌ 演示失败: ${err.message}`);
        process.exit(1);
    });
}
async function runDemo() {
    const { ContextManager } = await Promise.resolve().then(() => __importStar(require('./context-manager.js')));
    console.log('━'.repeat(60));
    console.log('🧠 上下文管理器演示');
    console.log('━'.repeat(60));
    // ============================================================
    //  1. 创建上下文（新建聊天）
    // ============================================================
    console.log('\n📋 1. 创建上下文');
    console.log('━'.repeat(40));
    const ctx = new ContextManager('你是一个友好的编程助手');
    console.log(`  会话 ID: ${ctx.sessionId}`);
    console.log(`  创建时间: ${ctx.createdAt.toISOString()}`);
    // ============================================================
    //  2. 添加消息（聊天）
    // ============================================================
    console.log('\n💬 2. 开始聊天');
    console.log('━'.repeat(40));
    // 用户说：你好
    ctx.addUserMessage('你好');
    console.log('🧑 用户: 你好');
    // AI 回复
    ctx.addAssistantMessage('你好！我是编程助手，有什么可以帮助你的？');
    console.log('🤖 AI: 你好！我是编程助手，有什么可以帮助你的？');
    // 用户问
    ctx.addUserMessage('什么是 TypeScript？');
    console.log('🧑 用户: 什么是 TypeScript？');
    // AI 回复
    ctx.addAssistantMessage('TypeScript 是 JavaScript 的超集，添加了类型系统。');
    console.log('🤖 AI: TypeScript 是 JavaScript 的超集，添加了类型系统。');
    // 用户继续问
    ctx.addUserMessage('为什么用 TypeScript？');
    console.log('🧑 用户: 为什么用 TypeScript？');
    // AI 回复
    ctx.addAssistantMessage('TypeScript 可以在编码阶段发现错误，提高代码质量。');
    console.log('🤖 AI: TypeScript 可以在编码阶段发现错误，提高代码质量。');
    // ============================================================
    //  3. 查看统计信息
    // ============================================================
    console.log('\n📊 3. 统计信息');
    console.log('━'.repeat(40));
    const stats = ctx.getStats();
    console.log(`📝 消息总数: ${stats.messageCount}`);
    console.log(`📖 总字符数: ${stats.totalChars}`);
    console.log(`🔢 估算 Token: ${stats.estimatedTokens}`);
    console.log('📋 各角色消息数:');
    console.log(`   👤 用户: ${stats.byRole.user}`);
    console.log(`   🤖 AI: ${stats.byRole.assistant}`);
    console.log(`   ⚙ 系统: ${stats.byRole.system}`);
    console.log(`   🔧 工具: ${stats.byRole.tool}`);
    // ============================================================
    //  4. 查看所有消息
    // ============================================================
    console.log('\n📜 4. 所有消息');
    console.log('━'.repeat(40));
    for (const msg of ctx.getMessages()) {
        const roleEmoji = msg.role === 'user' ? '🧑'
            : msg.role === 'assistant' ? '🤖'
                : msg.role === 'system' ? '⚙'
                    : '🔧';
        console.log(`${roleEmoji} [${msg.role}] ${msg.content}`);
    }
    // ============================================================
    //  5. 获取最后 N 条消息
    // ============================================================
    console.log('\n📌 5. 最近 2 条消息');
    console.log('━'.repeat(40));
    const last2 = ctx.getLastN(2);
    for (const msg of last2) {
        console.log(`[${msg.role}] ${msg.content}`);
    }
    // ============================================================
    //  6. 滑动窗口裁剪演示
    // ============================================================
    console.log('\n✂ 6. 滑动窗口裁剪演示');
    console.log('━'.repeat(40));
    // 添加很多消息（模拟长对话）
    console.log('📝 添加 10 条测试消息...');
    for (let i = 0; i < 10; i++) {
        ctx.addUserMessage(`测试消息 ${i + 1}`);
        ctx.addAssistantMessage(`这是对测试消息 ${i + 1} 的回复`);
    }
    const beforeCount = ctx.length;
    const beforeTokens = ctx.totalTokens;
    console.log(`📊 裁剪前: ${beforeCount} 条消息, ${beforeTokens} Token`);
    // 裁剪到 100 Token
    const removed = ctx.trimTo(100, 1.2);
    const afterCount = ctx.length;
    const afterTokens = ctx.totalTokens;
    console.log(`✂ 删除了 ${removed} 条消息`);
    console.log(`📊 裁剪后: ${afterCount} 条消息, ${afterTokens} Token`);
    // ============================================================
    //  7. 导出聊天记录
    // ============================================================
    console.log('\n💾 7. 导出聊天记录');
    console.log('━'.repeat(40));
    const json = ctx.toJSON();
    console.log(`📄 JSON 长度: ${json.length} 字符`);
    console.log(`📋 预览: ${json.slice(0, 200)}...`);
    // ============================================================
    //  8. 恢复聊天记录
    // ============================================================
    console.log('\n🔄 8. 从 JSON 恢复');
    console.log('━'.repeat(40));
    const restored = ContextManager.fromJSON(json);
    console.log(`✅ 恢复成功！${restored.length} 条消息`);
    console.log(`📋 会话 ID: ${restored.sessionId}`);
    // ============================================================
    //  9. 清空聊天记录
    // ============================================================
    console.log('\n🗑 9. 清空聊天记录');
    console.log('━'.repeat(40));
    ctx.clear();
    console.log(`✅ 清空后: ${ctx.length} 条消息（保留系统消息）`);
    ctx.clear(false);
    console.log(`✅ 完全清空: ${ctx.length} 条消息（包括系统消息）`);
    console.log('\n🎉 演示完成！');
}
//# sourceMappingURL=index.js.map