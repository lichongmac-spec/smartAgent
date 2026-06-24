/**
 * MCP 服务端
 *
 * MCPServer 将 SmartAgent 的 ToolRegistry 暴露为 MCP 标准工具，
 * 使外部 MCP 客户端可以连接并调用这些工具。
 *
 * ## 架构
 *
 *   MCP Client (外部)           MCPServer                 SmartAgent ToolRegistry
 *   ────────────────            ─────────                 ──────────────────────
 *   │── initialize ───────────→│                          │
 *   │←─ {capabilities} ───────│                          │
 *   │── initialized ──────────→│                          │
 *   │                           │                          │
 *   │── tools/list ───────────→│                          │
 *   │                           │── getDefinitions() ────→│
 *   │                           │←─ ToolDefinition[] ──────│
 *   │←─ {tools: [...]} ───────│  (转换为 MCP 格式)        │
 *   │                           │                          │
 *   │── tools/call {n,args} ──→│                          │
 *   │                           │── execute(name, args) ──→│
 *   │                           │←─ result ────────────────│
 *   │←─ {content: [...]} ─────│  (转换为 MCP 格式)        │
 *
 * ## 服务端支持的传输方式
 *
 * MCPServer 本身是传输无关的——它只处理 JSON-RPC 消息的收发。
 * 具体的 I/O 绑定在 Demo 中通过 StdioTransport 或简单的 stdio 循环实现。
 *
 * 如果未来需要 HTTP 服务端，可以通过 HttpTransport 的回调模式支持。
 */

import { ToolRegistry } from '../tools/registry.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  MCPTool,
  MCPResource,
  MCPPrompt,
  InitializeParams,
  InitializeResult,
  ListToolsResult,
  CallToolParams,
  CallToolResult,
  ListResourcesResult,
  ListPromptsResult,
  ServerCapabilities,
  Implementation,
} from './types.js';
import {
  JSONRPC_VERSION,
  MCP_VERSION,
  ErrorCode,
  MCPError,
} from './types.js';

// ================================================================
//  内部类型
// ================================================================

/** 方法处理器签名 */
type MethodHandler = (
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** MCPServer 配置 */
export interface MCPServerConfig {
  /** 服务端实现信息 */
  serverInfo: Implementation;
  /** 使用说明（在 initialize 响应中返回） */
  instructions?: string;
  /** 是否开启调试日志 */
  debug?: boolean;
  /** 额外声明的能力（默认根据 ToolRegistry 自动生成） */
  capabilities?: Partial<ServerCapabilities>;
}

// ================================================================
//  MCPServer 类
// ================================================================

export class MCPServer {
  /** 工具注册表 */
  private toolRegistry: ToolRegistry;
  /** 服务端配置 */
  private config: Required<MCPServerConfig>;
  /** 方法路由表 */
  private handlers = new Map<string, MethodHandler>();
  /** 是否已完成初始化 */
  private _initialized = false;

  constructor(toolRegistry: ToolRegistry, config: MCPServerConfig) {
    this.toolRegistry = toolRegistry;
    this.config = {
      serverInfo: config.serverInfo,
      instructions: config.instructions ?? '',
      debug: config.debug ?? false,
      capabilities: config.capabilities ?? {},
    };

    // 注册所有 JSON-RPC 方法处理器
    this._registerHandlers();
  }

  // ================================================================
  //  核心方法：处理 JSON-RPC 消息
  // ================================================================

  /**
   * 处理单条 JSON-RPC 消息
   *
   * 这是 MCPServer 的入口方法。传入一条 JSON-RPC 请求或通知，
   * 返回对应的 JSON-RPC 响应（通知不需要响应，返回 null）。
   *
   * @param message - 原始 JSON-RPC 消息
   * @returns JSON-RPC 响应，或 null（如果是通知）
   */
  async handleMessage(
    message: JsonRpcRequest | JsonRpcNotification,
  ): Promise<JsonRpcResponse | JsonRpcError | null> {
    try {
      // 验证 JSON-RPC 版本
      if (message.jsonrpc !== JSONRPC_VERSION) {
        return this._errorResponse(
          message as JsonRpcRequest,
          ErrorCode.INVALID_REQUEST,
          `不支持的 JSON-RPC 版本: ${message.jsonrpc}`,
        );
      }

      // 通知不需要响应
      if (!('id' in message) || message.id === undefined || message.id === null) {
        await this._handleNotification(message as JsonRpcNotification);
        return null;
      }

      // 处理请求
      const request = message as JsonRpcRequest;
      const { id, method, params } = request;

      this._log(`← 收到请求: ${method} (id=${id})`);

      const handler = this.handlers.get(method);
      if (!handler) {
        this._log(`✗ 未找到方法: ${method}`);
        return this._errorResponse(
          request,
          ErrorCode.METHOD_NOT_FOUND,
          `方法不存在: ${method}`,
        );
      }

      // 调用处理器
      const startTime = Date.now();
      const result = await handler(params);
      this._log(
        `→ 响应: ${method} (${Date.now() - startTime}ms)`,
      );

      return {
        jsonrpc: JSONRPC_VERSION,
        id,
        result,
      };
    } catch (err) {
      const req = message as JsonRpcRequest;
      if (err instanceof MCPError) {
        return this._errorResponse(req, err.code, err.message, err.data);
      }
      const msg = err instanceof Error ? err.message : String(err);
      this._log(`✗ 内部错误: ${msg}`);
      return this._errorResponse(req, ErrorCode.INTERNAL_ERROR, msg);
    }
  }

  // ================================================================
  //  属性
  // ================================================================

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /** 工具注册表 */
  get tools(): ToolRegistry {
    return this.toolRegistry;
  }

  // ================================================================
  //  方法处理器注册
  // ================================================================

  private _registerHandlers(): void {
    this.handlers.set('initialize', this._handleInitialize.bind(this));
    this.handlers.set('ping', this._handlePing.bind(this));
    this.handlers.set('tools/list', this._handleListTools.bind(this));
    this.handlers.set('tools/call', this._handleCallTool.bind(this));
    this.handlers.set('resources/list', this._handleListResources.bind(this));
    this.handlers.set('prompts/list', this._handleListPrompts.bind(this));
  }

  // ================================================================
  //  MCP 协议处理器
  // ================================================================

  /**
   * initialize — 协议握手
   *
   * 客户端发送协议版本和能力声明，服务端返回自己的能力和信息。
   * 初始化完成后才允许调用其他方法。
   */
  private async _handleInitialize(
    params?: Record<string, unknown>,
  ): Promise<InitializeResult> {
    const initParams = params as unknown as InitializeParams;

    if (!initParams?.protocolVersion) {
      throw new MCPError('缺少 protocolVersion', ErrorCode.INVALID_PARAMS);
    }

    // 版本协商（当前只支持 2024-11-05）
    if (initParams.protocolVersion !== MCP_VERSION) {
      throw new MCPError(
        `不支持的协议版本: ${initParams.protocolVersion}（期望 ${MCP_VERSION}）`,
        ErrorCode.INVALID_PARAMS,
      );
    }

    this._initialized = true;

    const clientInfo = initParams.clientInfo;
    this._log(
      `握手完成: 客户端=${clientInfo?.name} v${clientInfo?.version}`,
    );

    // 根据 ToolRegistry 状态生成能力声明
    const capabilities: ServerCapabilities = {
      tools: {
        listChanged: false, // SmartAgent 的工具列表运行时不变
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
      prompts: {
        listChanged: false,
      },
      ...this.config.capabilities,
    };

    return {
      protocolVersion: MCP_VERSION,
      capabilities,
      serverInfo: this.config.serverInfo,
      ...(this.config.instructions
        ? { instructions: this.config.instructions }
        : {}),
    };
  }

  /** ping — 心跳检测 */
  private async _handlePing(): Promise<Record<string, never>> {
    return {};
  }

  /**
   * tools/list — 列出所有工具
   *
   * 将 SmartAgent 的 ToolDefinition[] 转换为 MCP 的 MCPTool[]。
   *
   * 转换要点：
   *   - OpenAI 的 `parameters` 是 JSON Schema，MCP 的 `inputSchema` 也是 JSON Schema
   *   - 移除 `type: 'function'` 外层包装
   *   - 确保 `inputSchema.type = 'object'`
   */
  private async _handleListTools(): Promise<ListToolsResult> {
    const definitions = this.toolRegistry.getDefinitions();

    const tools: MCPTool[] = definitions.map((def) => {
      const { name, description, parameters } = def.function;

      return {
        name,
        description,
        inputSchema: {
          type: 'object',
          properties: (parameters as Record<string, unknown>).properties as Record<
            string,
            unknown
          >,
          required: (parameters as Record<string, unknown>).required as
            | string[]
            | undefined,
        },
      };
    });

    this._log(`工具列表: ${tools.map((t) => t.name).join(', ')}`);
    return { tools };
  }

  /**
   * tools/call — 调用工具
   *
   * 将 MCP 的工具调用请求转发到 SmartAgent 的 ToolRegistry.execute()。
   *
   * 转换要点：
   *   - MCP 的 arguments 是 Record<string, unknown>
   *   - ToolRegistry 的 execute(name, args) 也接受 Record<string, unknown>
   *   - 工具执行结果包装为 MCP 的 content 格式
   */
  private async _handleCallTool(
    params?: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const callParams = params as unknown as CallToolParams;

    if (!callParams?.name) {
      throw new MCPError('缺少工具名称', ErrorCode.INVALID_PARAMS);
    }

    const { name, arguments: args = {} } = callParams;

    this._log(`执行工具: ${name}(${JSON.stringify(args).slice(0, 100)})`);

    // 检查工具是否存在
    if (!this.toolRegistry.has(name)) {
      throw new MCPError(
        `工具不存在: ${name}`,
        ErrorCode.METHOD_NOT_FOUND,
      );
    }

    // 执行工具
    const rawResult = await this.toolRegistry.execute(name, args);

    // 将结果转换为 MCP 格式
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(rawResult, null, 2),
        },
      ],
    };
  }

  /**
   * resources/list — 列出资源
   *
   * 当前 SmartAgent 没有资源系统，返回空列表。
   * 未来可以接入文件系统等作为资源。
   */
  private async _handleListResources(): Promise<ListResourcesResult> {
    // TODO: 未来可以暴露文件系统、数据库等作为 MCP 资源
    return { resources: [] };
  }

  /**
   * prompts/list — 列出提示词
   *
   * 当前返回空列表。未来可以暴露系统提示词等作为 MCP prompts。
   */
  private async _handleListPrompts(): Promise<ListPromptsResult> {
    return { prompts: [] };
  }

  // ================================================================
  //  通知处理
  // ================================================================

  private async _handleNotification(
    notification: JsonRpcNotification,
  ): Promise<void> {
    const { method } = notification;

    switch (method) {
      case 'notifications/initialized':
        this._log('客户端确认初始化完成');
        break;
      case 'notifications/cancelled':
        // 取消请求通知
        this._log('客户端取消请求');
        break;
      default:
        this._log(`收到通知: ${method}`);
    }
  }

  // ================================================================
  //  辅助方法
  // ================================================================

  /** 构建错误响应 */
  private _errorResponse(
    request: JsonRpcRequest,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcError {
    return {
      jsonrpc: JSONRPC_VERSION,
      id: request.id ?? null,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    };
  }

  /** 调试日志 */
  private _log(message: string): void {
    if (this.config.debug) {
      console.log(`[MCPServer] ${message}`);
    }
  }
}
