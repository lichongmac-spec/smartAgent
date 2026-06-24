/**
 * MCP (Model Context Protocol) 类型定义
 *
 * 基于 JSON-RPC 2.0，为 AI 模型与外部工具/资源的标准化通信定义接口。
 * 本模块定义了 MCP 协议的所有核心类型，不包含任何运行逻辑。
 *
 * ## MCP 协议基础概念
 *
 * MCP 使用 JSON-RPC 2.0 作为消息格式：
 *   - 每个消息是一个 JSON 对象
 *   - 请求有 `id`（用于匹配响应），通知没有 `id`
 *   - 错误通过标准 JSON-RPC 错误码报告
 *
 * MCP 的核心能力（capabilities）：
 *   - **tools**：可被 AI 调用的函数（类似 OpenAI Function Calling）
 *   - **resources**：AI 可以读取的数据（文件、数据库记录等）
 *   - **prompts**：预定义的提示词模板
 *
 * ## 消息流示例
 *
 *   Client                          Server
 *     │                                │
 *     │── initialize ─────────────────→│  握手，交换能力
 *     │←─ {capabilities} ─────────────│
 *     │── notifications/initialized ──→│  确认就绪
 *     │                                │
 *     │── tools/list ─────────────────→│  发现工具
 *     │←─ [{name, inputSchema}...] ────│
 *     │                                │
 *     │── tools/call {name, arguments}→│  调用工具
 *     │←─ {content: [...]} ───────────│
 */

// ================================================================
//  JSON-RPC 2.0 核心类型
// ================================================================

/** JSON-RPC 版本号（固定 2.0） */
export const JSONRPC_VERSION = '2.0' as const;

/** JSON-RPC 请求（Client → Server） */
export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  /** 请求 ID（数字或字符串），通知没有此字段 */
  id?: number | string;
  /** 方法名，如 "tools/list" */
  method: string;
  /** 方法参数（可选） */
  params?: Record<string, unknown>;
}

/** JSON-RPC 成功响应（Server → Client） */
export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  /** 对应请求的 ID */
  id: number | string;
  /** 成功结果 */
  result: unknown;
  /** 响应中不应有 error 字段（与错误响应互斥） */
  error?: undefined;
}

/** JSON-RPC 错误响应（Server → Client） */
export interface JsonRpcError {
  jsonrpc: typeof JSONRPC_VERSION;
  /** 对应请求的 ID（解析失败时为 null） */
  id: number | string | null;
  error: {
    /** 错误码 */
    code: number;
    /** 人类可读的错误描述 */
    message: string;
    /** 额外错误数据（可选） */
    data?: unknown;
  };
}

/** JSON-RPC 通知（没有 id，不需要响应） */
export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 消息联合类型 */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcError
  | JsonRpcNotification;

// ================================================================
//  标准 JSON-RPC 错误码
// ================================================================

export const ErrorCode = {
  /** 无效的 JSON（-32700） */
  PARSE_ERROR: -32700,
  /** 无效的请求对象（-32600） */
  INVALID_REQUEST: -32600,
  /** 方法不存在（-32601） */
  METHOD_NOT_FOUND: -32601,
  /** 无效的方法参数（-32602） */
  INVALID_PARAMS: -32602,
  /** 内部 JSON-RPC 错误（-32603） */
  INTERNAL_ERROR: -32603,
} as const;

// ================================================================
//  MCP 协议类型
// ================================================================

/** MCP 协议版本 */
export const MCP_VERSION = '2024-11-05' as const;

/** 客户端实现信息 */
export interface Implementation {
  name: string;
  version: string;
}

/** 客户端能力声明 */
export interface ClientCapabilities {
  /** 支持的特性 */
  roots?: { listChanged?: boolean };
  sampling?: Record<string, never>;
  /** 实验性功能 */
  experimental?: Record<string, unknown>;
}

/** 服务端能力声明 */
export interface ServerCapabilities {
  /** 工具能力 */
  tools?: {
    /** 工具列表是否可变（支持 notifications） */
    listChanged?: boolean;
  };
  /** 资源能力 */
  resources?: {
    /** 是否支持订阅更新 */
    subscribe?: boolean;
    /** 资源列表是否可变 */
    listChanged?: boolean;
  };
  /** 提示词能力 */
  prompts?: {
    /** 提示词列表是否可变 */
    listChanged?: boolean;
  };
  /** 日志能力 */
  logging?: Record<string, never>;
  /** 实验性功能 */
  experimental?: Record<string, unknown>;
}

// ================================================================
//  MCP 工具（Tools）
// ================================================================

/**
 * MCP 工具定义
 *
 * 与 OpenAI ToolDefinition 的区别：
 *   - MCP 使用 `inputSchema` 而非 `parameters`
 *   - MCP 的 schema 使用 JSON Schema 而非 OpenAI 的 function.parameters
 *   - 结构上兼容，可以互相转换
 */
export interface MCPTool {
  /** 工具名称（全局唯一，建议使用 server/tool 命名空间） */
  name: string;
  /** 人类可读的描述 */
  description?: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** tools/list 请求参数（当前为空） */
export interface ListToolsParams {
  /** 游标分页（可选） */
  cursor?: string;
}

/** tools/list 响应结果 */
export interface ListToolsResult {
  tools: MCPTool[];
  /** 下一页游标（null 表示没有更多） */
  nextCursor?: string | null;
}

/** 工具调用参数 */
export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** 工具调用结果中的内容块 */
export interface ToolContentItem {
  type: 'text' | 'image' | 'resource';
  /** text 类型时的文本内容 */
  text?: string;
  /** image 类型的 base64 数据 */
  data?: string;
  /** image 类型的 MIME 类型 */
  mimeType?: string;
  /** resource 类型的嵌入资源 */
  resource?: MCPResourceContent;
}

/** tools/call 响应结果 */
export interface CallToolResult {
  content: ToolContentItem[];
  /** 是否为错误结果 */
  isError?: boolean;
}

// ================================================================
//  MCP 资源（Resources）
// ================================================================

/** MCP 资源定义 */
export interface MCPResource {
  /** 资源 URI（如 file:///path/to/file） */
  uri: string;
  /** 人类可读的名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** MIME 类型（如 text/plain, image/png） */
  mimeType?: string;
}

/** resources/list 请求参数 */
export interface ListResourcesParams {
  cursor?: string;
}

/** resources/list 响应结果 */
export interface ListResourcesResult {
  resources: MCPResource[];
  nextCursor?: string | null;
}

/** resources/read 请求参数 */
export interface ReadResourceParams {
  uri: string;
}

/** 资源内容 */
export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  /** 文本内容（text/plain 等） */
  text?: string;
  /** 二进制内容（base64 编码） */
  blob?: string;
}

/** resources/read 响应结果 */
export interface ReadResourceResult {
  contents: MCPResourceContent[];
}

// ================================================================
//  MCP 提示词（Prompts）
// ================================================================

/** 提示词消息角色 */
export type PromptRole = 'user' | 'assistant';

/** 提示词中的单条消息 */
export interface PromptMessage {
  role: PromptRole;
  content: {
    type: 'text';
    text: string;
  };
}

/** MCP 提示词定义 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/** prompts/list 请求参数 */
export interface ListPromptsParams {
  cursor?: string;
}

/** prompts/list 响应结果 */
export interface ListPromptsResult {
  prompts: MCPPrompt[];
  nextCursor?: string | null;
}

/** prompts/get 请求参数 */
export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

/** prompts/get 响应结果 */
export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

// ================================================================
//  MCP 初始化
// ================================================================

/** initialize 请求参数 */
export interface InitializeParams {
  /** 客户端支持的协议版本 */
  protocolVersion: string;
  /** 客户端能力声明 */
  capabilities: ClientCapabilities;
  /** 客户端信息 */
  clientInfo: Implementation;
}

/** initialize 响应结果 */
export interface InitializeResult {
  /** 服务端支持的协议版本 */
  protocolVersion: string;
  /** 服务端能力声明 */
  capabilities: ServerCapabilities;
  /** 服务端信息 */
  serverInfo: Implementation;
  /** 使用说明（可选） */
  instructions?: string;
}

// ================================================================
//  MCP 日志
// ================================================================

/** 日志级别 */
export type LoggingLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

/** logging/setLevel 请求参数 */
export interface SetLevelParams {
  level: LoggingLevel;
}

/** 日志消息通知参数 */
export interface LoggingMessageParams {
  level: LoggingLevel;
  /** 日志来源 */
  logger?: string;
  /** 日志数据（任意可序列化对象） */
  data: unknown;
}

// ================================================================
//  传输层抽象
// ================================================================

/**
 * MCP 传输层接口
 *
 * MCP 支持多种传输方式：
 *   - **stdio**：标准输入输出（本地进程）
 *   - **HTTP + SSE**：HTTP POST 请求 + 服务端推送事件（远程服务器）
 *
 * 每种传输只需要实现发送和接收 JSON-RPC 消息的能力。
 */
export interface MCPTransport {
  /** 传输名称（用于日志） */
  readonly name: string;

  /** 启动传输（建立连接） */
  start(): Promise<void>;

  /** 发送 JSON-RPC 消息 */
  send(message: JsonRpcMessage): Promise<void>;

  /** 接收下一条 JSON-RPC 消息 */
  receive(): Promise<JsonRpcMessage>;

  /** 关闭传输 */
  close(): Promise<void>;
}

// ================================================================
//  MCP 客户端错误
// ================================================================

/** MCP 操作中发生的错误 */
export class MCPError extends Error {
  constructor(
    message: string,
    /** JSON-RPC 错误码 */
    public readonly code: number = ErrorCode.INTERNAL_ERROR,
    /** 附加数据 */
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

/** 连接级别的错误（传输失败、握手失败等） */
export class MCPConnectionError extends MCPError {
  constructor(message: string, data?: unknown) {
    super(message, -32000, data);
    this.name = 'MCPConnectionError';
  }
}

/** 方法不支持的错误 */
export class MCPMethodNotFoundError extends MCPError {
  constructor(method: string) {
    super(`方法不存在: ${method}`, ErrorCode.METHOD_NOT_FOUND);
    this.name = 'MCPMethodNotFoundError';
  }
}

/** 参数无效的错误 */
export class MCPInvalidParamsError extends MCPError {
  constructor(message: string) {
    super(message, ErrorCode.INVALID_PARAMS);
    this.name = 'MCPInvalidParamsError';
  }
}
