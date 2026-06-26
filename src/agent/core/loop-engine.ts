/**
 * loop-engine.ts - ReAct Loop 引擎
 *
 * 理解：这个文件是 Agent 的"大脑"——控制整个 思考→行动→观察 循环。
 *
 * 这就是 ReAct 论文的核心实现！
 *
 * 工作流程：
 *   用户提问 → [思考] → [需要工具？调用工具] → [观察结果] → [再思考] → 回答用户
 *   └──────────────── 循环（最多 maxSteps 步）────────────────────┘
 *
 * 参考文献：
 *   Yao, S., et al. (2022). "ReAct: Synergizing Reasoning and Acting
 *   in Language Models." arXiv:2210.03629.
 *
 * 使用方式：
 *   import { LoopEngine } from './core/loop-engine.js';
 *   import { createDefaultToolRegistry } from './tools/index.js';
 *
 *   const llm = createLLMClientSync({ provider: 'mock' });
 *   const tools = createDefaultToolRegistry();
 *   const engine = new LoopEngine(llm, tools);
 *   const answer = await engine.run('帮我计算 2 + 2');
 */

import { ToolRegistry } from '../tools/registry.js';
import type { ContextManager } from '../context/context-manager.js';
import { isRetryableError } from '../llm/errors.js';
import type { ChatResponse, ILLMClient, Message, ToolCall } from '../llm/types.js';
import type { LoopConfig, LoopState, StepCallback } from './types.js';

// ============================================================
//  ReAct 系统提示词
// ============================================================

/**
 * 构建 ReAct 系统提示词
 *
 * 理解：告诉 AI 如何工作——思考、使用工具、回答问题
 */
function buildSystemPrompt(toolsDescription: string, customPrompt?: string): string {
  if (customPrompt) {
    return customPrompt.replace('{tools_description}', toolsDescription);
  }

  return `你是一个智能助手，能够通过思考和使用工具来解决问题。

你的工作方式是：
1. 分析用户的问题
2. 如果需要获取信息或执行操作，使用提供的工具
3. 根据工具返回的结果，决定下一步
4. 当你有足够的信息时，直接回答用户

可用的工具：
${toolsDescription}

重要规则：
- 如果可以直接回答，就回答，不需要调用工具
- 如果信息不足，使用工具获取信息
- 工具调用失败时，尝试其他方法或告知用户
- 用中文回答用户的问题`;
}

/**
 * 构建工具描述文本
 */
function buildToolsDescription(tools: ToolRegistry): string {
  const defs = tools.getDefinitions();
  if (defs.length === 0) return '（无可用工具）';

  return defs
    .map((t) => {
      const params = Object.entries(
        (t.function.parameters as { properties?: Record<string, { description?: string }> })
          .properties ?? {}
      )
        .map(([name, schema]) => `    - ${name}: ${schema.description || '无描述'}`)
        .join('\n');
      return `- **${t.function.name}**: ${t.function.description}\n  参数:\n${params}`;
    })
    .join('\n\n');
}

// ============================================================
//  Loop 引擎
// ============================================================

/**
 * ReAct Loop 引擎
 *
 * 理解：这个类就是"做菜的流程控制器"——管理 AI 的思考-行动-观察循环
 *
 * 核心方法：
 *   run(userInput) → 启动 ReAct 循环，返回最终回答
 *   getState()    → 获取当前状态
 *   interrupt()   → 中断当前执行
 */
export class LoopEngine {
  // ============================================================
  //  私有属性
  // ============================================================

  /** LLM 客户端（AI 的"嘴"和"脑"） */
  private llm: ILLMClient;

  /** 工具注册表（AI 的"手"） */
  private tools: ToolRegistry;

  /** 配置 */
  private config: Required<LoopConfig>;

  /** 当前状态 */
  private state: LoopState;

  /** 中断标志（快速轮询路径，用于步骤间中断） */
  private _interrupted: boolean = false;

  /** AbortController（用于取消正在进行的 LLM 请求） */
  private _abortController: AbortController | null = null;

  /** 连续 LLM 调用失败重试计数 */
  private _retryCount: number = 0;

  /** 最大重试次数 */
  private _maxRetries: number = 3;

  /** 步骤回调 */
  private onStep?: StepCallback;

  // ============================================================
  //  构造函数
  // ============================================================

  /**
   * 创建 Loop 引擎
   *
   * @param llm - LLM 客户端（真实或 Mock）
   * @param tools - 工具注册表
   * @param config - 可选配置
   * @param onStep - 可选步骤回调
   *
   * @example
   *   const engine = new LoopEngine(llm, tools, {
   *     maxSteps: 5,
   *     verbose: true,
   *   });
   */
  constructor(
    llm: ILLMClient,
    tools: ToolRegistry,
    config: LoopConfig = {},
    onStep?: StepCallback,
  ) {
    this.llm = llm;
    this.tools = tools;
    this.onStep = onStep;

    this.config = {
      maxSteps: config.maxSteps ?? 10,
      maxRetries: config.maxRetries ?? 3,
      systemPrompt: config.systemPrompt ?? '',
      verbose: config.verbose ?? true,
      injectHistory: config.injectHistory ?? false,
      maxContextTokens: config.maxContextTokens ?? 0,
      contextManager: config.contextManager,
    } as Required<LoopConfig> & { contextManager?: ContextManager };

    this._maxRetries = this.config.maxRetries;

    this.state = this._createInitialState();
  }

  // ============================================================
  //  核心方法：run()
  // ============================================================

  /**
   * 运行 ReAct 循环
   *
   * 理解：就像"开始做菜"——按照流程一步步执行
   *
   * @param userInput - 用户的问题/任务
   * @returns AI 的最终回答
   *
   * @example
   *   const answer = await engine.run('帮我读取 README.md 的内容');
   */
  async run(userInput: string): Promise<string> {
    this._initRunState(userInput, '');
    const messages = this._prepareMessages(userInput);

    // 2. ReAct 循环
    let finalAnswer: string | null = null;

    while (this.state.step < this.config.maxSteps) {
      // 检查中断标志
      if (this._interrupted) {
        this.state.status = 'error';
        this.state.finalAnswer = '执行已被用户中断';
        this.state.finishedAt = new Date();
        this._interrupted = false;
        this._abortController = null;
        this.log('⏹️ 执行已被中断');
        return this.state.finalAnswer;
      }

      this.state.step++;

      this.log(`\n${'━'.repeat(50)}`);
      this.log(`📌 步骤 ${this.state.step}/${this.config.maxSteps}`);

      // ---- 2.0 上下文裁剪（防止 Token 溢出） ----
      if (this.config.maxContextTokens > 0 && messages.length > 2) {
        const estimatedTokens = this._estimateTotalTokens(messages);
        if (estimatedTokens > this.config.maxContextTokens) {
          const trimmed = this._trimMessages(messages, this.config.maxContextTokens);
          this.log(`✂️ 上下文超限 (${estimatedTokens}/${this.config.maxContextTokens} Token)，裁剪了 ${trimmed} 条消息`);
        }
      }

      // ---- 2.1 思考 (Think) ----
      this.state.status = 'thinking';
      this.log('🤔 思考中...');

      let response: ChatResponse;
      try {
        response = await this.llm.chat(messages, {
          tools: this.tools.getDefinitions(),
          temperature: 0.3, // 低温度，让 AI 更专注于任务
          signal: this._abortController!.signal,
        });
      } catch (error) {
        // 如果是 AbortError（用户取消），立即退出
        if (error instanceof Error && error.name === 'AbortError') {
          this.state.status = 'error';
          this.state.finalAnswer = '执行已被用户中断';
          this.state.finishedAt = new Date();
          this._interrupted = false;
          this._abortController = null;
          this.log('⏹️ 执行已被中断（请求级别取消）');
          return this.state.finalAnswer;
        }

        // 智能重试：区分可重试和不可重试错误
        if (isRetryableError(error)) {
          this._retryCount++;
          if (this._retryCount <= this._maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, this._retryCount - 1), 10000);
            const errMsg = error instanceof Error ? error.message : String(error);
            this.log(`🔄 可重试错误: ${errMsg}`);
            this.log(`   第 ${this._retryCount}/${this._maxRetries} 次重试（${delay}ms 后）...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          // 超过最大重试次数
          this.state.status = 'error';
          this.state.finalAnswer = `LLM 调用连续失败 ${this._maxRetries} 次，请检查网络连接或 API 配置后重试。`;
          this.state.finishedAt = new Date();
          this._interrupted = false;
          this._abortController = null;
          this.log(`❌ 超过最大重试次数 (${this._maxRetries})，终止执行`);
          return this.state.finalAnswer;
        }

        // 不可重试错误：记录并终止
        this._handleError(error, messages);
        this.state.status = 'error';
        const errMsg = error instanceof Error ? error.message : String(error);
        this.state.finalAnswer = `LLM 调用发生不可恢复的错误: ${errMsg}`;
        this.state.finishedAt = new Date();
        this._interrupted = false;
        this._abortController = null;
        this.log(`❌ 不可重试错误，终止执行: ${errMsg}`);
        return this.state.finalAnswer;
      }

      // LLM 调用成功，重置重试计数
      this._retryCount = 0;

      // 统计 Token
      if (response.usage) {
        this.state.tokensUsed += response.usage.totalTokens;
      } else {
        // 粗略估算
        this.state.tokensUsed += Math.ceil(response.content.length / 4);
      }

      // ---- 2.2 判断：是否有工具调用？ ----
      if (response.toolCalls && response.toolCalls.length > 0) {
        // 有工具调用 → 行动 (Act)
        await this._executeToolCalls(response, messages);
        continue; // 继续循环
      }

      // ---- 2.3 没有工具调用 → 直接回答 ----
      // 如果内容为空（可能是 API 异常），继续循环而不是当作最终答案
      if (!response.content || response.content.trim() === '') {
        this.log('⚠️ 模型返回空内容，继续下一轮...');
        messages.push({
          role: 'user',
          content: '请继续回答，如果需要使用工具请调用对应工具。',
        });
        continue;
      }

      finalAnswer = response.content;
      this.state.status = 'done';
      this.state.finalAnswer = finalAnswer;
      this.state.finishedAt = new Date();

      // 记录最后一步
      this.state.history.push({
        thought: response.content,
        timestamp: new Date(),
      });

      this.log(`✅ 回答: ${finalAnswer.slice(0, 200)}${finalAnswer.length > 200 ? '...' : ''}`);
      break;
    }

    // 3. 检查是否达到最大步骤
    if (!finalAnswer) {
      this.state.status = 'error';
      const reason = this.state.step >= this.config.maxSteps
        ? `达到最大步骤数 (${this.config.maxSteps})，任务未完成`
        : '任务执行异常，未获得有效回答';
      this.state.finalAnswer = reason;
      this.state.finishedAt = new Date();
      this._interrupted = false;
      this._abortController = null;
      this.log(`⚠️ ${reason}`);
      return reason;
    }

    // 4. 返回结果
    this._interrupted = false;
    this._abortController = null;
    this.log(`\n🎉 任务完成！共 ${this.state.step} 步，消耗约 ${this.state.tokensUsed} Token`);
    this._notifyStep();

    return finalAnswer;
  }

  /**
   * 运行 ReAct 循环（流式模式）
   *
   * 理解：就像 run() 的"直播版本"——AI 边思考边输出，用户可以实时看到内容。
   *
   * 工作流程：
   *   1. 思考步骤 → 内部非流式调用（快速检测是否需要工具）
   *   2. 最终回答 → 流式输出（逐字返回给用户）
   *
   * 注意：工具调用检测仍使用非流式 chat，因为 chatStream 的工具调用
   * 解析是 provider-specific 的（delta chunks），统一处理复杂度太高。
   *
   * @param userInput - 用户的问题/任务
   * @yields 文本片段（逐字或逐块流式输出）
   *
   * @example
   *   for await (const chunk of engine.runStream('介绍一下 TypeScript')) {
   *     process.stdout.write(chunk);  // 打字机效果
   *   }
   */
  async *runStream(userInput: string): AsyncGenerator<string> {
    this._initRunState(userInput, '(流式)');
    const messages = this._prepareMessages(userInput);

    // 2. ReAct 循环（思考步骤用非流式，最终回答用流式）
    while (this.state.step < this.config.maxSteps) {
      // 检查中断标志
      if (this._interrupted) {
        this.state.status = 'error';
        this.state.finalAnswer = '执行已被用户中断';
        this.state.finishedAt = new Date();
        this._interrupted = false;
        this._abortController = null;
        yield '\n⏹️ 执行已被中断\n';
        return;
      }

      this.state.step++;

      // 上下文裁剪
      if (this.config.maxContextTokens > 0 && messages.length > 2) {
        const estimatedTokens = this._estimateTotalTokens(messages);
        if (estimatedTokens > this.config.maxContextTokens) {
          const trimmed = this._trimMessages(messages, this.config.maxContextTokens);
          yield `\n✂️ 上下文已裁剪 (${trimmed} 条旧消息)\n`;
        }
      }

      // --- 思考步骤：内部非流式调用，检测工具调用 ---
      this.state.status = 'thinking';
      this.log(`🔍 流式循环第 ${this.state.step} 步 - 思考中...`);

      let thinkResponse: ChatResponse;
      try {
        thinkResponse = await this.llm.chat(messages, {
          tools: this.tools.getDefinitions(),
          temperature: 0.3,
          signal: this._abortController!.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          this.state.status = 'error';
          this.state.finalAnswer = '执行已被用户中断';
          this.state.finishedAt = new Date();
          this._interrupted = false;
          this._abortController = null;
          yield '\n⏹️ 执行已被中断\n';
          return;
        }
        if (isRetryableError(error)) {
          this._retryCount++;
          if (this._retryCount <= this._maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, this._retryCount - 1), 10000);
            yield `\n🔄 重试中 (${this._retryCount}/${this._maxRetries})...\n`;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          yield `\n❌ LLM 连续失败 ${this._maxRetries} 次，请检查网络\n`;
          return;
        }
        const errMsg = error instanceof Error ? error.message : String(error);
        yield `\n❌ 错误: ${errMsg}\n`;
        return;
      }

      this._retryCount = 0;

      // Token 统计
      if (thinkResponse.usage) {
        this.state.tokensUsed += thinkResponse.usage.totalTokens;
      } else {
        this.state.tokensUsed += Math.ceil(thinkResponse.content.length / 4);
      }

      // 有工具调用？
      if (thinkResponse.toolCalls && thinkResponse.toolCalls.length > 0) {
        yield `\n🔧 调用工具: ${thinkResponse.toolCalls.map(t => t.name).join(', ')}\n`;
        await this._executeToolCalls(thinkResponse, messages);
        continue;
      }

      // --- 最终回答：流式输出 ---
      this.state.status = 'thinking';
      yield '\n'; // 分隔符

      try {
        for await (const chunk of this.llm.chatStream(messages, {
          signal: this._abortController!.signal,
        })) {
          yield chunk;
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          yield '\n\n⏹️ 输出已被中断\n';
          return;
        }
        yield `\n\n❌ 流式输出错误: ${error instanceof Error ? error.message : String(error)}\n`;
        return;
      }

      this.state.status = 'done';
      this.state.finishedAt = new Date();
      this.log('✅ 流式输出完成');
      break;
    }

    // 3. 清理
    this._interrupted = false;
    this._abortController = null;
    this.log(`🎉 流式任务完成！共 ${this.state.step} 步`);
  }

  // ============================================================
  //  工具执行
  // ============================================================

  /**
   * 执行 AI 请求的工具调用
   *
   * 理解：AI 说"我要用 XX 工具"，引擎就帮它执行
   */
  private async _executeToolCalls(
    response: ChatResponse,
    messages: Message[],
  ): Promise<void> {
    const toolCalls = response.toolCalls!;
    this.state.status = 'acting';

    // 把 AI 的回复（含工具调用请求）加入消息
    messages.push({
      role: 'assistant',
      content: response.content || '',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id ?? `call_${tc.name}_${Date.now()}`,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const toolCall of toolCalls) {
      this.log(`🔧 调用工具: ${toolCall.name}`);
      this.log(`📝 参数: ${toolCall.arguments.slice(0, 200)}`);

      let observation: string;

      // 1. 解析参数（与执行分开捕获，提供精确错误信息）
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.arguments);
      } catch (parseError) {
        observation = `❌ 工具参数格式错误: ${parseError instanceof Error ? parseError.message : String(parseError)}。收到的参数: ${toolCall.arguments.slice(0, 100)}`;
        this._pushObservation(messages, observation, toolCall, response);
        continue;
      }

      // 2. 执行工具
      try {
        const result = await this.tools.execute(toolCall.name, args);
        observation = JSON.stringify(result, null, 2);
        this.log(`✅ 工具执行成功 (${observation.length} 字符)`);
      } catch (execError) {
        observation = `❌ 工具执行错误: ${execError instanceof Error ? execError.message : String(execError)}`;
        this.log(observation);
      }

      // 3. 观察结果并注入消息
      this._pushObservation(messages, observation, toolCall, response);
    }

    this.state.status = 'thinking';
  }

  // ============================================================
  //  工具观察结果处理
  // ============================================================

  /**
   * 将工具观察结果推入消息列表和历史记录
   */
  private _pushObservation(
    messages: Message[],
    observation: string,
    toolCall: ToolCall,
    response: ChatResponse,
  ): void {
    this.log(`👀 观察结果: ${observation.slice(0, 150)}${observation.length > 150 ? '...' : ''}`);

    messages.push({
      role: 'tool',
      content: observation,
      tool_call_id: toolCall.id ?? toolCall.name,
    });

    this.state.history.push({
      thought: response.content,
      action: toolCall,
      observation,
      timestamp: new Date(),
    });

    this._notifyStep();
  }

  // ============================================================
  //  错误处理
  // ============================================================

  /**
   * 处理 LLM 调用错误
   */
  private _handleError(error: unknown, messages: Message[]): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.log(`❌ LLM 调用失败: ${errorMsg}`);

    // 记录错误
    this.state.history.push({
      thought: `LLM 调用失败: ${errorMsg}`,
      timestamp: new Date(),
    });

    // 将错误信息注入，让 AI 知道发生了什么并继续
    messages.push({
      role: 'user',
      content: `[系统提示] 上一次操作失败: ${errorMsg}。请尝试其他方法或告知用户当前情况。`,
    });

    this._notifyStep();
  }

  // ============================================================
  //  控制方法
  // ============================================================

  /**
   * 中断当前执行
   *
   * 理解：就像在做菜时按下"停止"按钮
   */
  interrupt(): void {
    this._interrupted = true;
    // 立即中止正在进行的 LLM 请求（而非等待轮询）
    if (this._abortController) {
      this._abortController.abort();
    }
    this.log('⏹️ 收到中断信号（已取消进行中的请求）');
  }

  /**
   * 获取当前状态（只读副本）
   */
  getState(): Readonly<LoopState> {
    return { ...this.state, history: [...this.state.history] };
  }

  // ============================================================
  //  run() / runStream() 共享辅助方法
  // ============================================================

  /**
   * 初始化运行状态（run/runStream 共用）
   *
   * 重置 state、清除中断标志、创建新的 AbortController。
   */
  private _initRunState(userInput: string, mode: string): void {
    this.state = this._createInitialState();
    this._retryCount = 0;
    this._interrupted = false;
    this._abortController = new AbortController();
    this.state.status = 'thinking';

    const preview = userInput.slice(0, 80) + (userInput.length > 80 ? '...' : '');
    this.log(`🚀 开始执行任务${mode}: "${preview}"`);
  }

  /**
   * 准备消息列表（run/runStream 共用）
   *
   * 根据 injectHistory 配置从 ContextManager 恢复上下文，
   * 确保系统提示词存在，并添加用户输入。
   */
  private _prepareMessages(userInput: string): Message[] {
    const messages: Message[] = [];

    const contextManager = this.config.contextManager;
    if (contextManager && contextManager.length > 0) {
      if (this.config.injectHistory) {
        // 交互模式：只注入历史对话（不含系统消息）
        const conversation = contextManager.getConversation();
        for (const msg of conversation) {
          messages.push(msg as Message);
        }
      } else {
        // 一次性任务模式：恢复完整上下文
        const ctxMessages = contextManager.getMessages();
        for (const msg of ctxMessages) {
          messages.push(msg as Message);
        }
      }
    }

    // 确保系统提示词存在
    if (messages.length === 0 || messages[0].role !== 'system') {
      const toolsDescription = buildToolsDescription(this.tools);
      const systemPrompt = buildSystemPrompt(toolsDescription, this.config.systemPrompt);
      messages.unshift({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: userInput });
    return messages;
  }

  /**
   * 获取执行耗时（毫秒）
   */
  getElapsed(): number {
    const end = this.state.finishedAt ?? new Date();
    return end.getTime() - this.state.startedAt.getTime();
  }

  // ============================================================
  //  内部工具
  // ============================================================

  /** 创建初始状态 */
  private _createInitialState(): LoopState {
    return {
      status: 'idle',
      step: 0,
      maxSteps: this.config.maxSteps,
      tokensUsed: 0,
      history: [],
      startedAt: new Date(),
    };
  }

  /** 打印日志（根据 verbose 配置） */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }

  /**
   * 估算消息列表的 Token 总量
   *
   * 启发式算法：英文 ~4 字符/token，中文 ~1.5 字符/token
   */
  private _estimateTotalTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      // 每条消息的 role 及格式开销约 4 Token
      total += 4;
      // 内容文本
      total += this._estimateTextTokens(msg.content);
    }
    return total;
  }

  /** 估算单段文本的 Token 数 */
  private _estimateTextTokens(text: string): number {
    if (!text) return 0;
    let cnChars = 0;
    let total = 0;
    for (const ch of text) {
      total++;
      const code = ch.codePointAt(0) ?? 0;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x20000 && code <= 0x2A6DF) ||
        (code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)
      ) {
        cnChars++;
      }
    }
    if (total === 0) return 0;
    const cnRatio = cnChars / total;
    return cnRatio > 0.3
      ? Math.ceil(total / 1.5)
      : Math.ceil(total / 4);
  }

  /**
   * 裁剪消息列表以保持在 Token 上限内
   *
   * 策略：
   *   - 保留所有 system 角色消息
   *   - 保留最后一条 user 消息（当前问题不能丢）
   *   - 从前面开始删除，直到 Token 数符合要求
   *
   * @returns 被删除的消息数
   */
  private _trimMessages(messages: Message[], maxTokens: number): number {
    const safetyMargin = 0.85; // 留 15% 余量
    const targetTokens = Math.floor(maxTokens * safetyMargin);

    // 分离 system 消息和非 system 消息
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const systemTokens = this._estimateTotalTokens(systemMsgs);
    const available = targetTokens - systemTokens;

    if (available <= 0 || nonSystemMsgs.length <= 2) return 0;

    // 从后往前累加 Token，找到可以保留的最早位置
    let usedTokens = 0;
    let keepFrom = nonSystemMsgs.length;

    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
      const msgTokens = 4 + this._estimateTextTokens(nonSystemMsgs[i].content);
      if (usedTokens + msgTokens <= available) {
        usedTokens += msgTokens;
        keepFrom = i;
      } else {
        break;
      }
    }

    // 至少保留最后 2 条（user + assistant pair）
    const minKeep = Math.min(2, nonSystemMsgs.length);
    const actualKeepFrom = Math.min(keepFrom, nonSystemMsgs.length - minKeep);
    const removed = actualKeepFrom;

    if (removed > 0) {
      // 就地修改消息数组
      messages.length = 0;
      messages.push(...systemMsgs, ...nonSystemMsgs.slice(actualKeepFrom));
    }

    return removed;
  }

  /** 通知步骤回调 */
  private _notifyStep(): void {
    if (this.onStep) {
      try {
        this.onStep(this.getState());
      } catch {
        // 回调异常不应中断引擎
      }
    }
  }
}
