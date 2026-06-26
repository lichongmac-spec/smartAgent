/**
 * MCP 工具适配器
 *
 * 将 MCP 协议的工具定义和执行机制适配到 SmartAgent 现有的 ToolRegistry 系统。
 *
 * ## 核心问题：命名冲突
 *
 * SmartAgent 的 ToolRegistry 按 `name` 注册工具，所有工具共享一个全局命名空间。
 * 当接入多个 MCP Server 时，不同 Server 可能有同名工具（如多个 Server 都叫 `search`）。
 *
 * ## 解决方案：命名空间前缀
 *
 * 给 MCP 工具名添加 `mcp__<serverName>__` 前缀：
 *
 *   原始名称         注册名称
 *   ─────────       ─────────────────────
 *   search     →    mcp__github__search
 *   list_files →    mcp__filesystem__list_files
 *
 * 这样即使多个 Server 有同名工具也不会冲突。
 *
 * ## 适配流程
 *
 *   MCP Server                          SmartAgent ToolRegistry
 *   ─────────                           ──────────────────────
 *   tools/list                           registerTool()
 *     ↓                                       ↓
 *   MCPTool {                        ToolDefinition {
 *     name: 'search',                  type: 'function',
 *     inputSchema: {...}               function: {
 *   }                                    name: 'mcp__server__search',
 *        │                                description: '[MCP/server] ...',
 *        │                                parameters: inputSchema (JSON Schema)
 *        │                              }
 *        │                            }
 *        │
 *        └────→ ToolExecutor (适配器函数)
 *                    ↓
 *               MCPClient.callTool({ name: 'search', arguments })
 */

import type { ToolDefinition } from '../llm/types.js';
import type { MCPTool, CallToolResult, ToolContentItem } from './types.js';
import type { MCPClient } from './client.js';

// ================================================================
//  命名空间管理
// ================================================================

/** MCP 工具名前缀 */
const MCP_PREFIX = 'mcp__';

/** 分隔符 */
const SEPARATOR = '__';

/**
 * 给原始工具名添加 MCP Server 命名空间
 *
 * 示例: buildNamespacedName('github', 'search') → 'mcp__github__search'
 */
export function buildNamespacedName(serverName: string, toolName: string): string {
  return `${MCP_PREFIX}${serverName}${SEPARATOR}${toolName}`;
}

/**
 * 从命名空间工具名中提取 serverName 和原始 toolName
 *
 * 示例: parseNamespacedName('mcp__github__search')
 *     → { serverName: 'github', toolName: 'search' }
 *
 * 如果不是命名空间格式，返回 null
 */
export function parseNamespacedName(namespaced: string): {
  serverName: string;
  toolName: string;
} | null {
  if (!namespaced.startsWith(MCP_PREFIX)) return null;

  const withoutPrefix = namespaced.slice(MCP_PREFIX.length);
  const sepIndex = withoutPrefix.indexOf(SEPARATOR);
  if (sepIndex === -1) return null;

  return {
    serverName: withoutPrefix.slice(0, sepIndex),
    toolName: withoutPrefix.slice(sepIndex + SEPARATOR.length),
  };
}

/**
 * 判断一个工具名是否为 MCP 命名空间格式
 */
export function isMCPTool(name: string): boolean {
  return name.startsWith(MCP_PREFIX) && parseNamespacedName(name) !== null;
}

// ================================================================
//  MCP Tool → SmartAgent ToolDefinition 转换
// ================================================================

/**
 * 将 MCP 工具定义转换为 SmartAgent 的 ToolDefinition
 *
 * 两种格式的差异：
 *   MCP:     { name, description?, inputSchema: { type, properties?, required? } }
 *   OpenAI:  { type: 'function', function: { name, description, parameters } }
 *
 * 它们本质上是兼容的——都是 JSON Schema，只是外层包装不同。
 */
export function mcpToolToDefinition(
  mcpTool: MCPTool,
  serverName: string,
): ToolDefinition {
  const namespaced = buildNamespacedName(serverName, mcpTool.name);

  return {
    type: 'function',
    function: {
      name: namespaced,
      description: `[MCP/${serverName}] ${mcpTool.description || mcpTool.name}`,
      parameters: {
        type: 'object',
        properties: mcpTool.inputSchema.properties || {},
        ...(mcpTool.inputSchema.required?.length
          ? { required: mcpTool.inputSchema.required }
          : {}),
      },
    },
  };
}

// ================================================================
//  MCP 工具执行适配器
// ================================================================

/**
 * 将 MCP tools/call 的结果提取为文本
 *
 * MCP 工具可以返回多种内容类型（text/image/resource），
 * 这里将它们统一转为字符串，方便 LLM 处理。
 */
export function extractToolResultText(result: CallToolResult): string {
  if (!result.content || result.content.length === 0) {
    return result.isError ? '[MCP] 工具执行出错，无返回内容' : '[MCP] 工具执行完成，无返回内容';
  }

  return result.content
    .map((item: ToolContentItem) => {
      switch (item.type) {
        case 'text':
          return item.text || '';
        case 'image':
          return item.data
            ? `[图片: ${item.mimeType || '未知类型'}, base64 长度 ${item.data.length}]`
            : '[图片: 无数据]';
        case 'resource':
          if (item.resource) {
            const r = item.resource;
            return r.text
              ? `[资源: ${r.uri}]\n${r.text}`
              : `[资源: ${r.uri}, ${r.mimeType || '未知类型'}]`;
          }
          return '[资源: 无数据]';
        default:
          return `[未知内容类型: ${(item as { type: string }).type}]`;
      }
    })
    .join('\n');
}

/**
 * 创建执行 MCP 工具的适配器函数
 *
 * 这个函数返回一个 ToolExecutor，内部会：
 *   1. 从命名空间工具名中提取 serverName 和原始 toolName
 *   2. 将 args 转换为 MCP 的 CallToolParams
 *   3. 调用 MCP Client 的 callTool
 *   4. 将结果转换为统一格式
 *
 * @param mcpClient - MCP 客户端（已连接）
 * @param serverName - MCP Server 名称（用于日志）
 * @param toolName - 工具原始名称（不含命名空间前缀）
 */
export function createMCPToolExecutor(
  mcpClient: MCPClient,
  _serverName: string,
  toolName: string,
) {
  return async (args: Record<string, unknown>): Promise<unknown> => {
    const result = await mcpClient.callTool(toolName, args);
    const text = extractToolResultText(result);

    return {
      success: !result.isError,
      content: text,
      ...(result.isError ? { error: text } : {}),
    };
  };
}

/**
 * 创建批量 MCP 工具执行适配器
 *
 * 当多个工具来自同一 MCP Server 时，使用同一个 client 实例。
 * 这里用一个 Map 缓存每个 serverName 的执行器工厂。
 *
 * 为什么需要工厂模式？
 *   因为每个 serverName 对应不同的 MCP Client，executor 需要绑定到正确的 client。
 *
 * 使用示例：
 *   const factory = new MCPToolExecutorFactory();
 *   factory.registerClient('github', githubClient);
 *   const executor = factory.getExecutor('github');
 *   await executor({ query: 'repo search' });
 */
export class MCPToolExecutorFactory {
  /** serverName → MCPClient */
  private clients = new Map<string, MCPClient>();

  /** 注册 MCP Client */
  registerClient(serverName: string, client: MCPClient): void {
    this.clients.set(serverName, client);
  }

  /** 注销 MCP Client */
  unregisterClient(serverName: string): boolean {
    return this.clients.delete(serverName);
  }

  /** 获取指定 Server 的工具执行器 */
  getExecutor(serverName: string, toolName: string): (args: Record<string, unknown>) => Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`未注册的 MCP Server: ${serverName}`);
    }
    return createMCPToolExecutor(client, serverName, toolName);
  }
}
