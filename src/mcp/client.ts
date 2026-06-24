/**
 * MCP 客户端
 *
 * MCPClient 是 SmartAgent 与外部 MCP Server 通信的桥梁。
 * 它封装了 JSON-RPC 2.0 协议、传输层管理和工具发现/调用。
 *
 * ## 架构
 *
 *   MCPClient
 *     ├── transport: MCPTransport    ← 负责底层 I/O（stdio / HTTP+SSE）
 *     ├── _nextId: number            ← 请求 ID 自增计数器
 *     ├── _pending: Map              ← 待响应请求（id → { resolve, reject, timer }）
 *     └── _receiveLoop: Promise      ← 后台接收循环（持续读取响应/通知）
 *
 * ## 使用流程
 *
 *   1. 创建客户端:  new MCPClient(transport, 'my-agent')
 *   2. 连接:       await client.connect()
 *   3. 发现工具:   const tools = await client.listTools()
 *   4. 调用工具:   const result = await client.callTool('search', { query: '...' })
 *   5. 断开:       await client.disconnect()
 *
 * ## 协议握手
 *
 *   Client                              Server
 *     │──── initialize ────────────────→│  交换协议版本和能力
 *     │←─── { protocolVersion,          │
 *     │      capabilities,              │
 *     │      serverInfo } ──────────────│
 *     │──── notifications/initialized ──→│  确认连接就绪
 *
 * ## 工具调用流程
 *
 *   Client                              Server
 *     │──── tools/list ────────────────→│
 *     │←─── { tools: [{name,...}] } ────│
 *     │                                  │
 *     │──── tools/call {name, args} ────→│
 *     │←─── { content: [{type:'text',   │
 *     │        text: '...'}] } ──────────│
 */

import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  MCPTransport,
  MCPTool,
  InitializeResult,
  ListToolsResult,
  CallToolResult,
  ListResourcesResult,
  ListPromptsResult,
  Implementation,
  ServerCapabilities,
} from './types.js';
import {
  ErrorCode,
  MCP_VERSION,
  MCPError,
  MCPConnectionError,
  MCPMethodNotFoundError,
} from './types.js';

// ================================================================
//  内部类型
// ================================================================

/** 待处理请求的回调 */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  /** 超时定时器 */
  timer: ReturnType<typeof setTimeout>;
  /** 请求方法名（用于错误日志） */
  method: string;
}

/** MCP 客户端配置 */
export interface MCPClientConfig {
  /** 请求默认超时（毫秒，默认 30000） */
  defaultTimeout?: number;
  /** 客户端实现信息 */
  clientInfo?: Implementation;
  /** 是否开启调试日志 */
  debug?: boolean;
}

// 默认配置
const DEFAULT_CONFIG: Required<Omit<MCPClientConfig, 'clientInfo'>> & {
  clientInfo: Implementation;
} = {
  defaultTimeout: 30000,
  clientInfo: { name: 'SmartAgent', version: '0.1.0' },
  debug: false,
};

// ================================================================
//  MCPClient 类
// ================================================================

export class MCPClient {
  /** 传输层实例 */
  private transport: MCPTransport;
  /** 客户端配置 */
  private config: Required<Omit<MCPClientConfig, 'clientInfo'>> & {
    clientInfo: Implementation;
  };
  /** 请求 ID 自增计数器 */
  private _nextId = 1;
  /** 待响应请求表 */
  private _pending = new Map<number | string, PendingRequest>();
  /** 后台接收循环 */
  private _receiveLoop: Promise<void> | null = null;
  /** 接收循环的 AbortController */
  private _receiveAbort = new AbortController();
  /** 服务端能力（initialize 后获取） */
  private _serverCapabilities: ServerCapabilities | null = null;
  /** 服务端信息 */
  private _serverInfo: Implementation | null = null;
  /** 连接状态 */
  private _connected = false;

  constructor(transport: MCPTransport, config: MCPClientConfig = {}) {
    this.transport = transport;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================================================
  //  公开 API
  // ================================================================

  /**
   * 连接到 MCP Server 并完成协议握手
   *
   * 此方法执行 MCP 协议的完整握手流程：
   *   1. 启动底层传输
   *   2. 发送 initialize 请求
   *   3. 发送 initialized 通知
   */
  async connect(): Promise<void> {
    if (this._connected) {
      throw new MCPConnectionError('客户端已连接');
    }

    this._log('正在连接...');

    // 1. 启动传输
    await this.transport.start();

    // 2. 启动后台接收循环（必须在 send 之前启动，否则可能漏掉响应）
    this._startReceiveLoop();

    // 3. 发送 initialize 请求
    const initResult = await this._sendRequest('initialize', {
      protocolVersion: MCP_VERSION,
      capabilities: {
        // 声明客户端能力（当前最小集）
      },
      clientInfo: this.config.clientInfo,
    });

    const result = initResult as InitializeResult;
    this._serverCapabilities = result.capabilities;
    this._serverInfo = result.serverInfo;

    this._log(
      `已连接到 ${result.serverInfo.name} v${result.serverInfo.version}` +
        `（协议版本: ${result.protocolVersion}）`,
    );

    if (result.instructions) {
      this._log(`服务端说明: ${result.instructions}`);
    }

    // 4. 发送 initialized 通知（不需要响应）
    await this._sendNotification('notifications/initialized', {});

    this._connected = true;
    this._log('连接就绪');
  }

  /**
   * 列出所有可用工具
   *
   * 对应 MCP 协议的 tools/list 方法。
   * 返回 MCP 格式的工具列表，需要通过 mcpToolToDefinition 转换为 LLM 可用格式。
   */
  async listTools(cursor?: string): Promise<ListToolsResult> {
    this._ensureConnected();
    const result = await this._sendRequest('tools/list', { cursor });
    return result as ListToolsResult;
  }

  /**
   * 调用工具
   *
   * 对应 MCP 协议的 tools/call 方法。
   * 工具的 name 应为**原始名称**（不含命名空间前缀），
   * 命名空间由调用方（ToolAdapter）管理。
   *
   * @param toolName - 工具原始名称（如 'search' 而非 'mcp__github__search'）
   * @param args - 工具参数
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    this._ensureConnected();

    this._log(`调用工具: ${toolName}(${JSON.stringify(args).slice(0, 200)})`);

    const result = await this._sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    return result as CallToolResult;
  }

  /**
   * 列出所有可用资源
   *
   * 对应 MCP 协议的 resources/list 方法。
   */
  async listResources(cursor?: string): Promise<ListResourcesResult> {
    this._ensureConnected();
    const result = await this._sendRequest('resources/list', { cursor });
    return result as ListResourcesResult;
  }

  /**
   * 读取资源
   *
   * 对应 MCP 协议的 resources/read 方法。
   */
  async readResource(uri: string): Promise<unknown> {
    this._ensureConnected();
    return this._sendRequest('resources/read', { uri });
  }

  /**
   * 列出所有可用提示词模板
   *
   * 对应 MCP 协议的 prompts/list 方法。
   */
  async listPrompts(cursor?: string): Promise<ListPromptsResult> {
    this._ensureConnected();
    const result = await this._sendRequest('prompts/list', { cursor });
    return result as ListPromptsResult;
  }

  /**
   * 获取提示词模板
   *
   * 对应 MCP 协议的 prompts/get 方法。
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    this._ensureConnected();
    return this._sendRequest('prompts/get', { name, arguments: args });
  }

  /**
   * 设置日志级别
   */
  async setLogLevel(level: string): Promise<void> {
    this._ensureConnected();
    await this._sendRequest('logging/setLevel', { level });
  }

  /**
   * 发送 ping 请求（心跳检测）
   */
  async ping(): Promise<boolean> {
    this._ensureConnected();
    try {
      await this._sendRequest('ping', {}, 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this._log('正在断开连接...');

    // 取消所有待处理请求
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new MCPConnectionError('连接已断开'));
    }
    this._pending.clear();

    // 停止接收循环
    this._receiveAbort.abort();
    this._receiveLoop = null;
    this._receiveAbort = new AbortController();

    // 关闭传输
    await this.transport.close();

    this._connected = false;
    this._serverCapabilities = null;
    this._serverInfo = null;
    this._log('已断开连接');
  }

  // ================================================================
  //  属性
  // ================================================================

  /** 是否已连接 */
  get isConnected(): boolean {
    return this._connected;
  }

  /** 服务端能力 */
  get serverCapabilities(): ServerCapabilities | null {
    return this._serverCapabilities;
  }

  /** 服务端信息 */
  get serverInfo(): Implementation | null {
    return this._serverInfo;
  }

  /** 传输名称 */
  get transportName(): string {
    return this.transport.name;
  }

  // ================================================================
  //  内部方法
  // ================================================================

  /** 确保已连接 */
  private _ensureConnected(): void {
    if (!this._connected) {
      throw new MCPConnectionError('客户端未连接，请先调用 connect()');
    }
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   *
   * 内部流程：
   *   1. 生成唯一 ID
   *   2. 构造 JSON-RPC 请求
   *   3. 注册回调（存入 _pending Map）
   *   4. 通过 transport 发送
   *   5. 等待后台接收循环匹配响应（通过 ID）
   *   6. 超时则 reject
   */
  private async _sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown> {
    const id = this._nextId++;
    const effectiveTimeout = timeout ?? this.config.defaultTimeout;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(
          new MCPError(
            `请求超时: ${method}（${effectiveTimeout}ms）`,
            -32000,
          ),
        );
      }, effectiveTimeout);

      this._pending.set(id, {
        resolve,
        reject,
        timer,
        method,
      });

      // 发送请求（忽略发送失败——会在接收端处理）
      this.transport.send(request).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(new MCPConnectionError(`发送请求失败: ${err.message}`));
      });
    });
  }

  /** 发送 JSON-RPC 通知（不需要响应） */
  private async _sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    await this.transport.send(notification);
  }

  /** 启动后台接收循环 */
  private _startReceiveLoop(): void {
    if (this._receiveLoop) return;

    const signal = this._receiveAbort.signal;

    this._receiveLoop = (async () => {
      while (!signal.aborted) {
        try {
          const message = await this.transport.receive();

          // 检查是否是错误响应
          if ('error' in message && message.error) {
            this._handleErrorResponse(message as JsonRpcError);
            continue;
          }

          // 检查是否有 id（响应 vs 通知）
          if ('id' in message && message.id !== undefined && message.id !== null) {
            this._handleResponse(message as JsonRpcResponse);
          } else {
            // 通知消息——不需要响应
            this._handleNotification(message as JsonRpcNotification);
          }
        } catch (err) {
          if (signal.aborted) break;

          // 传输错误
          this._log(`接收循环错误: ${String(err)}`);

          // 拒绝所有待处理请求
          for (const [id, pending] of this._pending) {
            clearTimeout(pending.timer);
            pending.reject(new MCPConnectionError(`传输错误: ${String(err)}`));
          }
          this._pending.clear();
          break;
        }
      }
    })();
  }

  /** 处理成功响应 */
  private _handleResponse(response: JsonRpcResponse): void {
    const id = response.id;
    const pending = this._pending.get(id);

    if (!pending) {
      // 无匹配请求（可能已超时或不属于我们）
      this._log(`收到无匹配请求的响应: id=${id}`);
      return;
    }

    // 清除超时定时器
    clearTimeout(pending.timer);
    this._pending.delete(id);

    // 解析结果
    pending.resolve(response.result);
  }

  /** 处理错误响应 */
  private _handleErrorResponse(error: JsonRpcError): void {
    const id = error.id;
    if (id === null || id === undefined) {
      // 无法匹配请求的错误
      this._log(`收到错误响应（无法匹配请求）: ${error.error.message}`);
      return;
    }

    const pending = this._pending.get(id);
    if (!pending) {
      this._log(`收到错误响应（无匹配请求）: id=${id}, ${error.error.message}`);
      return;
    }

    clearTimeout(pending.timer);
    this._pending.delete(id);

    pending.reject(
      new MCPError(
        error.error.message,
        error.error.code,
        error.error.data,
      ),
    );
  }

  /** 处理服务端通知 */
  private _handleNotification(notification: JsonRpcNotification): void {
    const method = notification.method;

    // 根据通知类型分发
    switch (method) {
      case 'notifications/tools/list_changed':
        this._log('⚠️ 工具列表已变更（服务端通知）');
        break;
      case 'notifications/resources/list_changed':
        this._log('⚠️ 资源列表已变更（服务端通知）');
        break;
      case 'notifications/prompts/list_changed':
        this._log('⚠️ 提示词列表已变更（服务端通知）');
        break;
      default:
        this._log(`收到通知: ${method}`);
    }
  }

  /** 调试日志 */
  private _log(message: string): void {
    if (this.config.debug) {
      console.log(`[MCP ${this.transport.name}] ${message}`);
    }
  }
}
