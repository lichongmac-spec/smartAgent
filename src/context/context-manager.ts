/**
 * context-manager.ts - 聊天记录管理器
 *
 * 理解：这就像微信的"聊天记录管理"功能
 * 你能：发消息、看历史、清空记录、导出聊天记录
 *
 * 这是 Agent 核心层最重要的模块之一！
 * 没有它，AI 每次对话都是"失忆"状态
 *
 * 依赖：
 *   - llm/types.ts: Message（消息格式）
 *   - llm/token-counter.ts: TokenCounter（字数统计）
 *
 * 使用方式：
 *   import { ContextManager } from './context/context-manager.js';
 *   const ctx = new ContextManager('你是一个编程助手');
 *   ctx.addUserMessage('你好');
 *   ctx.addAssistantMessage('你好！');
 */

import { TokenCounter } from '../llm/token-counter.js';
import type { Message, MessageRole, ContextStats } from './types.js';

/**
 * 上下文管理器
 *
 * 理解：这个类就是"聊天记录管理器"
 * 它保存了你和 AI 的所有对话
 *
 * 用法：
 *   const ctx = new ContextManager('你是一个编程助手');
 *   ctx.addUserMessage('你好');
 *   ctx.addAssistantMessage('你好！');
 *   console.log(ctx.getMessages());  // 查看所有消息
 */
export class ContextManager {
  // ============================================================
  //  私有属性（内部数据）
  // ============================================================

  /** 所有消息（就像微信的聊天记录列表） */
  private messages: Message[] = [];

  /** 会话 ID（就像微信的"群聊 ID"） */
  private _sessionId: string;

  /** 创建时间 */
  private _createdAt: Date;

  /** 最后更新时间 */
  private _updatedAt: Date;

  /** Token 计数器 */
  private tokenCounter: TokenCounter;

  // ============================================================
  //  构造函数（创建管理器）
  // ============================================================

  /**
   * 创建上下文管理器
   *
   * 理解：就像创建一个新的"聊天群"
   *
   * @param systemPrompt - 系统提示词（AI 的"人设"）
   *
   * @example
   *   // 创建一个上下文，设定 AI 是"编程助手"
   *   const ctx = new ContextManager('你是一个编程助手');
   */
  constructor(systemPrompt?: string) {
    this._sessionId = this.generateSessionId();
    this._createdAt = new Date();
    this._updatedAt = new Date();
    this.tokenCounter = new TokenCounter();

    // 如果有系统提示词，作为第一条消息
    if (systemPrompt && systemPrompt.trim()) {
      this.messages.push({
        role: 'system',
        content: systemPrompt.trim(),
      });
    }
  }

  // ============================================================
  //  会话 ID
  // ============================================================

  /** 获取会话 ID */
  get sessionId(): string {
    return this._sessionId;
  }

  /** 获取创建时间 */
  get createdAt(): Date {
    return this._createdAt;
  }

  /** 获取最后更新时间 */
  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * 生成会话 ID
   *
   * 理解：就像生成一个"群聊 ID"
   * 格式：20240615-143022-a3f9
   *   - 20240615: 日期
   *   - 143022: 时间
   *   - a3f9: 随机字符
   */
  private generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const rand = Math.random().toString(36).slice(2, 6);
    return `${date}-${time}-${rand}`;
  }

  // ============================================================
  //  添加消息（发消息）
  // ============================================================

  /**
   * 添加用户消息
   *
   * 理解：就像你在微信里发送一条消息
   *
   * @param content - 你说的话
   *
   * @example
   *   ctx.addUserMessage('你好');
   */
  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
    this._updatedAt = new Date();
  }

  /**
   * 添加助手消息（AI 的回复）
   *
   * 理解：就像 AI 在微信里回复你
   *
   * @param content - AI 说的话
   *
   * @example
   *   ctx.addAssistantMessage('你好！有什么可以帮助你的？');
   */
  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
    this._updatedAt = new Date();
  }

  /**
   * 添加系统消息
   *
   * 理解：就像在微信群里设置"群公告"
   *
   * @param content - 系统设定
   *
   * @example
   *   ctx.addSystemMessage('请用中文回答');
   */
  addSystemMessage(content: string): void {
    this.messages.push({ role: 'system', content });
    this._updatedAt = new Date();
  }

  /**
   * 添加工具消息（工具执行结果）
   *
   * 理解：工具执行完，把结果放进聊天记录里
   *
   * @param content - 工具执行结果
   */
  addToolMessage(content: string): void {
    this.messages.push({ role: 'tool', content });
    this._updatedAt = new Date();
  }

  // ============================================================
  //  查看消息（看聊天记录）
  // ============================================================

  /**
   * 获取所有消息
   *
   * 理解：就像打开微信，查看完整的聊天记录
   *
   * @returns 所有消息的副本（修改副本不会影响原数据）
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取所有消息（不含系统消息）
   *
   * 理解：只看对话内容，不看群公告
   */
  getConversation(): Message[] {
    return this.messages.filter(m => m.role !== 'system');
  }

  /**
   * 获取最后 N 条消息
   *
   * 理解：就像微信的"只显示最近 20 条"
   *
   * @param n - 要获取的消息数量
   * @param includeSystem - 是否包含系统消息
   * @returns 最后 N 条消息
   *
   * @example
   *   ctx.getLastN(5);  // 获取最近 5 条
   */
  getLastN(n: number, includeSystem: boolean = false): Message[] {
    const filtered = includeSystem
      ? this.messages
      : this.messages.filter(m => m.role !== 'system');
    return filtered.slice(-n);
  }

  /**
   * 获取系统消息
   *
   * 理解：查看"群公告"
   */
  getSystemMessages(): Message[] {
    return this.messages.filter(m => m.role === 'system');
  }

  /**
   * 消息总数
   *
   * 理解：统计"有多少条聊天记录"
   */
  get length(): number {
    return this.messages.length;
  }

  // ============================================================
  //  统计信息
  // ============================================================

  /**
   * 获取统计信息
   *
   * 理解：就像微信的"聊天记录统计"
   *
   * @returns 包含消息数、Token 数等信息的对象
   *
   * @example
   *   const stats = ctx.getStats();
   *   console.log(`共 ${stats.messageCount} 条消息，约 ${stats.estimatedTokens} Token`);
   */
  getStats(): ContextStats {
    const byRole: ContextStats['byRole'] = {
      user: 0,
      assistant: 0,
      system: 0,
      tool: 0,
    };

    for (const msg of this.messages) {
      byRole[msg.role as keyof typeof byRole] ??= 0;
      byRole[msg.role as keyof typeof byRole]++;
    }

    const totalTokens = this.tokenCounter.countMessages(this.messages);
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);

    return {
      messageCount: this.messages.length,
      byRole,
      estimatedTokens: totalTokens,
      totalChars,
    };
  }

  /**
   * 估算整个对话的 Token 数
   */
  get totalTokens(): number {
    return this.tokenCounter.countMessages(this.messages);
  }

  // ============================================================
  //  清空消息
  // ============================================================

  /**
   * 清空所有消息
   *
   * 理解：就像微信的"清空聊天记录"
   *
   * @param keepSystem - 是否保留系统消息（群公告）
   *
   * @example
   *   ctx.clear();           // 清空所有（保留系统消息）
   *   ctx.clear(false);      // 清空所有（包括系统消息）
   */
  clear(keepSystem: boolean = true): void {
    if (keepSystem) {
      this.messages = this.messages.filter(m => m.role === 'system');
    } else {
      this.messages = [];
    }
    this._updatedAt = new Date();
  }

  // ============================================================
  //  滑动窗口裁剪（核心功能！）
  // ============================================================

  /**
   * 裁剪消息列表以适应 Token 上限
   *
   * 理解：就像微信聊天记录太多时，自动删除最早的消息
   *
   * 策略：
   *   1. 保留所有系统消息（群公告不能删）
   *   2. 从最早的消息开始删除
   *   3. 保留最近的消息
   *   4. 至少保留最后 1 条消息
   *
   * @param maxTokens - 最大 Token 数（AI 的"字数限制"）
   * @param safetyFactor - 安全系数（1.2 = 留 20% 余量）
   * @returns 被删除的消息数
   *
   * @example
   *   // AI 最多能处理 4096 Token，留 20% 余量
   *   const removed = ctx.trimTo(4096, 1.2);
   *   console.log(`删除了 ${removed} 条消息`);
   */
  trimTo(maxTokens: number, safetyFactor: number = 1.2): number {
    // 有效上限（留出安全余量）
    const effectiveMax = Math.floor(maxTokens / safetyFactor);

    // 分离系统消息和普通消息
    const systemMessages = this.messages.filter(m => m.role === 'system');
    const nonSystemMessages = this.messages.filter(m => m.role !== 'system');

    // 如果根本没有普通消息，不用裁剪
    if (nonSystemMessages.length === 0) {
      return 0;
    }

    // 计算系统消息占用的 Token
    const systemTokens = this.tokenCounter.countMessages(systemMessages);

    // 留给普通消息的 Token 额度
    const availableForNonSystem = effectiveMax - systemTokens;

    // 如果额度不够，说明系统消息已经超了（不太可能发生）
    if (availableForNonSystem <= 0) {
      return 0;
    }

    // ============================================================
    //  核心算法：从后往前累加 Token，找到可以保留的最早位置
    // ============================================================

    let usedTokens = 0;
    let keepFrom = nonSystemMessages.length; // 默认全部保留

    // 从最后一条消息往前数
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msgTokens = 4 + this.tokenCounter.count(nonSystemMessages[i].content);

      // 如果加上这条消息不超限，就保留
      if (usedTokens + msgTokens <= availableForNonSystem) {
        usedTokens += msgTokens;
        keepFrom = i;
      } else {
        // 超了，停止（前面的都不保留了）
        break;
      }
    }

    // 确保至少保留最后 1 条消息（不能全删了）
    const minKeep = 1;
    const actualKeepFrom = Math.min(keepFrom, nonSystemMessages.length - minKeep);

    // 计算实际删除的数量
    const removed = actualKeepFrom;

    // 执行裁剪
    if (removed > 0) {
      this.messages = [
        ...systemMessages,
        ...nonSystemMessages.slice(actualKeepFrom),
      ];
      this._updatedAt = new Date();
    }

    return removed;
  }

  // ============================================================
  //  保存和恢复（导出/导入聊天记录）
  // ============================================================

  /**
   * 导出为 JSON 字符串
   *
   * 理解：就像微信的"导出聊天记录"
   * 可以保存到文件，以后恢复
   *
   * @returns JSON 字符串
   *
   * @example
   *   const json = ctx.toJSON();
   *   fs.writeFileSync('chat.json', json);
   */
  toJSON(): string {
    return JSON.stringify(
      {
        sessionId: this._sessionId,
        createdAt: this._createdAt.toISOString(),
        updatedAt: this._updatedAt.toISOString(),
        messages: this.messages,
      },
      null,
      2,
    );
  }

  /**
   * 从 JSON 字符串恢复
   *
   * 理解：就像微信的"导入聊天记录"
   *
   * @param json - JSON 字符串
   * @returns 恢复的 ContextManager 实例
   *
   * @example
   *   const json = fs.readFileSync('chat.json', 'utf-8');
   *   const ctx = ContextManager.fromJSON(json);
   */
  static fromJSON(json: string): ContextManager {
    const data = JSON.parse(json);

    // 创建新的上下文
    const ctx = new ContextManager();

    // 恢复数据
    ctx._sessionId = data.sessionId ?? ctx._sessionId;
    if (data.createdAt) {
      ctx._createdAt = new Date(data.createdAt);
    }
    if (data.updatedAt) {
      ctx._updatedAt = new Date(data.updatedAt);
    }

    // 恢复消息
    for (const msg of data.messages || []) {
      if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
        ctx.messages.push({
          role: msg.role as MessageRole,
          content: msg.content,
        });
      }
    }

    return ctx;
  }
}
