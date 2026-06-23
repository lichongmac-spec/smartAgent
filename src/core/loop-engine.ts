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

import type { ILLMClient, Message, ChatResponse, ToolCall } from '../llm/types.js';
import type { LoopState, LoopConfig, StepCallback, StepRecord } from './types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ContextManager } from '../context/context-manager.js';

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

  /** 中断标志 */
  private _interrupted: boolean = false;

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
      systemPrompt: config.systemPrompt ?? '',
      verbose: config.verbose ?? true,
      injectHistory: config.injectHistory ?? false,
      contextManager: config.contextManager,
    } as Required<LoopConfig> & { contextManager?: ContextManager };

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
    // 重置状态
    this.state = this._createInitialState();
    // 注意：不重置 _interrupted —— 如果用户之前中断了，run() 仍会立即返回
    this.state.status = 'thinking';

    this.log(`🚀 开始执行任务: "${userInput.slice(0, 80)}${userInput.length > 80 ? '...' : ''}"`);

    // 1. 准备消息列表
    const messages: Message[] = [];

    // 系统提示词
    // 如果提供了 ContextManager，优先使用它的 toJSON 恢复系统消息
    const contextManager = this.config.contextManager;
    if (contextManager && contextManager.length > 0) {
      // 从 ContextManager 恢复已有上下文（系统消息 + 历史对话）
      const ctxMessages = contextManager.getMessages();
      for (const msg of ctxMessages) {
        messages.push(msg as Message);
      }
    } else {
      const toolsDescription = buildToolsDescription(this.tools);
      const systemPrompt = buildSystemPrompt(toolsDescription, this.config.systemPrompt);
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 如果 ContextManager 中有历史对话，注入到当前会话
    if (contextManager && contextManager.length > 0 && this.config.injectHistory) {
      const conversation = contextManager.getConversation();
      for (const msg of conversation) {
        messages.push(msg as Message);
      }
    }

    // 用户输入
    messages.push({ role: 'user', content: userInput });

    // 2. ReAct 循环
    let finalAnswer: string | null = null;

    while (this.state.step < this.config.maxSteps) {
      // 检查中断标志
      if (this._interrupted) {
        this.state.status = 'error';
        this.state.finalAnswer = '执行已被用户中断';
        this.state.finishedAt = new Date();
        this._interrupted = false;
        this.log('⏹️ 执行已被中断');
        return this.state.finalAnswer;
      }

      this.state.step++;

      this.log(`\n${'━'.repeat(50)}`);
      this.log(`📌 步骤 ${this.state.step}/${this.config.maxSteps}`);

      // ---- 2.1 思考 (Think) ----
      this.state.status = 'thinking';
      this.log('🤔 思考中...');

      let response: ChatResponse;
      try {
        response = await this.llm.chat(messages, {
          tools: this.tools.getDefinitions(),
          temperature: 0.3, // 低温度，让 AI 更专注于任务
        });
      } catch (error) {
        this._handleError(error, messages);
        continue; // 尝试继续（可能下一轮就恢复了）
      }

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
      this.log(`⚠️ ${reason}`);
      return reason;
    }

    // 4. 返回结果
    this._interrupted = false;
    this.log(`\n🎉 任务完成！共 ${this.state.step} 步，消耗约 ${this.state.tokensUsed} Token`);
    this._notifyStep();

    return finalAnswer;
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
    this.log('⏹️ 收到中断信号');
  }

  /**
   * 获取当前状态（只读副本）
   */
  getState(): Readonly<LoopState> {
    return { ...this.state, history: [...this.state.history] };
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
