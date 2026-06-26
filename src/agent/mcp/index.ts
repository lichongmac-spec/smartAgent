/**
 * MCP（Model Context Protocol）模块入口
 *
 * MCP 是 Anthropic 提出的标准化协议，让 AI 应用与外部工具/数据源
 * 通过统一接口通信。本模块实现了 MCP 协议的 Server 端和 Client 端。
 *
 * ## 快速开始
 *
 * ```typescript
 * import { MCPClient, MCPServer, StdioTransport } from './mcp/index.js';
 *
 * // 1. 创建 Server（暴露 SmartAgent 工具）
 * const server = new MCPServer(toolRegistry, {
 *   serverInfo: { name: 'SmartAgent', version: '1.0.0' },
 * });
 *
 * // 2. 创建 Client（通过 stdio 连接）
 * const transport = new StdioTransport({
 *   command: 'node', args: ['server.js'],
 * });
 * const client = new MCPClient(transport);
 *
 * // 3. 连接并发现工具
 * await client.connect();
 * const { tools } = await client.listTools();
 *
 * // 4. 调用工具
 * const result = await client.callTool('calculator', {
 *   expression: '2 + 2',
 * });
 * ```
 *
 * ## 模块结构
 *
 *   mcp/
 *   ├── types.ts          — JSON-RPC 2.0 类型 + MCP 协议类型
 *   ├── transport.ts      — stdio / HTTP+SSE 传输层
 *   ├── client.ts         — MCP 客户端（连接、发现、调用）
 *   ├── server.ts         — MCP 服务端（暴露 SmartAgent 工具）
 *   ├── tool-adapter.ts   — MCP 工具 ⇄ SmartAgent ToolDefinition 转换
 *   ├── mcp-demo.ts       — 端到端 Demo
 *   └── index.ts          — 本文件（统一导出）
 */

// 类型
export {
  JSONRPC_VERSION,
  MCP_VERSION,
  ErrorCode,
} from './types.js';
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcMessage,
  MCPTool,
  MCPResource,
  MCPResourceContent,
  MCPPrompt,
  PromptMessage,
  PromptRole,
  ToolContentItem,
  CallToolResult,
  CallToolParams,
  ListToolsResult,
  ListResourcesResult,
  ListPromptsResult,
  InitializeParams,
  InitializeResult,
  Implementation,
  ClientCapabilities,
  ServerCapabilities,
  MCPTransport,
  LoggingLevel,
} from './types.js';
export {
  MCPError,
  MCPConnectionError,
  MCPMethodNotFoundError,
  MCPInvalidParamsError,
} from './types.js';

// 传输层
export {
  StdioTransport,
  HttpTransport,
  serializeMessage,
  deserializeMessage,
} from './transport.js';
export type { StdioTransportConfig, HttpTransportConfig } from './transport.js';

// 客户端
export { MCPClient } from './client.js';
export type { MCPClientConfig } from './client.js';

// 服务端
export { MCPServer } from './server.js';
export type { MCPServerConfig } from './server.js';

// 工具适配器
export {
  buildNamespacedName,
  parseNamespacedName,
  isMCPTool,
  mcpToolToDefinition,
  extractToolResultText,
  createMCPToolExecutor,
  MCPToolExecutorFactory,
} from './tool-adapter.js';
