/**
 * MCP 协议测试套件
 *
 * 覆盖 MCP 模块的所有核心功能：
 *   - 类型序列化/反序列化
 *   - 工具命名空间管理
 *   - Server 消息处理
 *   - Client 生命周期
 *   - 端到端集成
 */

import { strict as nodeAssert } from 'assert';

// ================================================================
//  自包含测试框架
// ================================================================

let passCount = 0;
let failCount = 0;
let testCount = 0;

const assert = nodeAssert;

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

function test(name: string, fn: () => void): void {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failCount++;
    console.log(`  ❌ ${name}: ${(e as Error).message}`);
  }
}

function summarize(): void {
  console.log(`\n──────────────────────────────`);
  console.log(`  MCP 测试：✅ ${passCount}  ❌ ${failCount}  总计 ${testCount}`);
  console.log(`──────────────────────────────\n`);

  if (failCount > 0) process.exit(1);
}

import { ToolRegistry } from '../src/tools/registry.js';
import {
  CALCULATOR_DEFINITION,
  calculatorExecutor,
} from '../src/tools/builtin/calculator.js';

import { MCPServer } from '../src/mcp/server.js';
import { MCPClient } from '../src/mcp/client.js';
import {
  serializeMessage,
  deserializeMessage,
} from '../src/mcp/transport.js';
import {
  buildNamespacedName,
  parseNamespacedName,
  isMCPTool,
  mcpToolToDefinition,
  extractToolResultText,
  createMCPToolExecutor,
  MCPToolExecutorFactory,
} from '../src/mcp/tool-adapter.js';
import {
  MCPError,
  MCPConnectionError,
  MCPMethodNotFoundError,
  MCPInvalidParamsError,
  ErrorCode,
  MCP_VERSION,
} from '../src/mcp/types.js';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  MCPTransport,
  CallToolResult,
  MCPTool,
} from '../src/mcp/types.js';

// ================================================================
//  辅助：进程内测试 Transport（复用 Demo 模式）
// ================================================================

class TestTransport implements MCPTransport {
  readonly name = 'test';
  private server: MCPServer;
  private incoming: JsonRpcMessage[] = [];
  private resolve: ((msg: JsonRpcMessage) => void) | null = null;
  private _closed = false;

  constructor(server: MCPServer) {
    this.server = server;
  }

  async start(): Promise<void> {}

  async send(message: JsonRpcMessage): Promise<void> {
    if (this._closed) throw new Error('closed');
    const request = message as JsonRpcRequest;
    const response = await this.server.handleMessage(request);
    if (response) {
      if (this.resolve) {
        this.resolve(response);
        this.resolve = null;
      } else {
        this.incoming.push(response);
      }
    }
  }

  async receive(): Promise<JsonRpcMessage> {
    if (this._closed) throw new Error('closed');
    if (this.incoming.length > 0) return this.incoming.shift()!;
    return new Promise<JsonRpcMessage>((resolve) => { this.resolve = resolve; });
  }

  async close(): Promise<void> {
    this._closed = true;
    this.incoming = [];
    this.resolve = null;
  }
}

/** 创建测试用的 Server + Client 组合 */
async function createTestPair() {
  const registry = new ToolRegistry(false); // verbose=false，抑制日志
  registry.register({ definition: CALCULATOR_DEFINITION, executor: calculatorExecutor });

  const server = new MCPServer(registry, {
    serverInfo: { name: 'TestServer', version: '1.0.0' },
  });

  const transport = new TestTransport(server);
  const client = new MCPClient(transport, {
    clientInfo: { name: 'TestClient', version: '1.0.0' },
  });

  return { registry, server, transport, client };
}

// ================================================================
//  第一部分：JSON-RPC 序列化
// ================================================================

test('JSON-RPC 请求序列化/反序列化', () => {
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  };

  const serialized = serializeMessage(req);
  assert.ok(serialized.endsWith('\n'), '序列化以换行符结尾');
  assert.ok(serialized.includes('"jsonrpc":"2.0"'), '包含 jsonrpc 字段');
  assert.ok(serialized.includes('"method":"tools/list"'), '包含 method 字段');

  const deserialized = deserializeMessage(serialized.trim());
  assert.equal(deserialized.jsonrpc, '2.0');
  assert.equal((deserialized as JsonRpcRequest).method, 'tools/list');
});

test('JSON-RPC 响应序列化/反序列化', () => {
  const resp: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: 42,
    result: { tools: [] },
  };

  const serialized = serializeMessage(resp);
  const deserialized = deserializeMessage(serialized.trim()) as JsonRpcResponse;
  assert.equal(deserialized.id, 42);
  assert.deepStrictEqual(deserialized.result, { tools: [] });
});

test('JSON-RPC 错误响应序列化', () => {
  const err: JsonRpcError = {
    jsonrpc: '2.0',
    id: 7,
    error: { code: -32601, message: '方法不存在' },
  };

  const serialized = serializeMessage(err);
  const deserialized = deserializeMessage(serialized.trim()) as JsonRpcError;
  assert.equal(deserialized.error.code, -32601);
  assert.equal(deserialized.error.message, '方法不存在');
});

test('JSON-RPC 通知序列化（无 id）', () => {
  const notif: JsonRpcNotification = {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  };

  const serialized = serializeMessage(notif);
  assert.ok(!serialized.includes('"id"'), '通知不包含 id 字段');
});

test('反序列化无效 JSON 应抛异常', () => {
  assert.throws(
    () => deserializeMessage('not json'),
    /无法解析/,
  );
});

test('反序列化版本错误应抛异常', () => {
  assert.throws(
    () => deserializeMessage(JSON.stringify({ jsonrpc: '1.0', method: 'test' })),
    /版本不匹配/,
  );
});

// ================================================================
//  第二部分：工具命名空间
// ================================================================

test('buildNamespacedName — 构建命名空间名称', () => {
  const name = buildNamespacedName('github', 'search');
  assert.equal(name, 'mcp__github__search');
});

test('buildNamespacedName — server 名称包含 __ 的情况', () => {
  const name = buildNamespacedName('my_server', 'tool');
  assert.equal(name, 'mcp__my_server__tool');
});

test('parseNamespacedName — 解析正常名称', () => {
  const result = parseNamespacedName('mcp__github__search');
  assert.ok(result !== null);
  assert.equal(result!.serverName, 'github');
  assert.equal(result!.toolName, 'search');
});

test('parseNamespacedName — 非 MCP 工具返回 null', () => {
  assert.equal(parseNamespacedName('calculator'), null);
  assert.equal(parseNamespacedName('mcp_github_search'), null); // 缺少一个下划线
});

test('parseNamespacedName — 空字符串返回 null', () => {
  assert.equal(parseNamespacedName(''), null);
});

test('isMCPTool — 正确判断', () => {
  assert.equal(isMCPTool('mcp__server__tool'), true);
  assert.equal(isMCPTool('calculator'), false);
  assert.equal(isMCPTool('mcp__'), false); // 不完整的命名空间
  // mcp__x__y__z 是合法的，此时 serverName='x', toolName='y__z'
  assert.equal(isMCPTool('mcp__x__y__z'), true);
});

test('mcpToolToDefinition — 转换为 ToolDefinition', () => {
  const mcpTool: MCPTool = {
    name: 'search',
    description: '搜索 GitHub 仓库',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
  };

  const def = mcpToolToDefinition(mcpTool, 'github');
  assert.equal(def.type, 'function');
  assert.equal(def.function.name, 'mcp__github__search');
  assert.ok(def.function.description.includes('[MCP/github]'));
  assert.ok(def.function.description.includes('搜索 GitHub 仓库'));

  const params = def.function.parameters as Record<string, unknown>;
  assert.deepStrictEqual(params.required, ['query']);
});

test('extractToolResultText — text 类型内容', () => {
  const result: CallToolResult = {
    content: [{ type: 'text', text: 'Hello World' }],
  };
  assert.equal(extractToolResultText(result), 'Hello World');
});

test('extractToolResultText — 多段内容拼接', () => {
  const result: CallToolResult = {
    content: [
      { type: 'text', text: '第一段' },
      { type: 'text', text: '第二段' },
    ],
  };
  assert.ok(extractToolResultText(result).includes('第一段'));
  assert.ok(extractToolResultText(result).includes('第二段'));
});

test('extractToolResultText — image 类型', () => {
  const result: CallToolResult = {
    content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
  };
  const text = extractToolResultText(result);
  assert.ok(text.includes('[图片:'));
  assert.ok(text.includes('image/png'));
  // image 类型只显示 MIME 和长度，不显示实际 base64 内容
  assert.ok(text.includes('10'), '应包含 base64 长度');
});

test('extractToolResultText — 空内容', () => {
  const result: CallToolResult = { content: [] };
  assert.equal(extractToolResultText(result), '[MCP] 工具执行完成，无返回内容');
});

test('extractToolResultText — 错误结果', () => {
  const result: CallToolResult = { content: [], isError: true };
  assert.equal(extractToolResultText(result), '[MCP] 工具执行出错，无返回内容');
});

// ================================================================
//  第三部分：MCPServer 消息处理
// ================================================================

testAsync('Server — initialize 握手', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_VERSION,
      capabilities: {},
      clientInfo: { name: 'Client', version: '1.0' },
    },
  });

  const resp = result as JsonRpcResponse;
  assert.equal(resp.id, 1);
  const initResult = resp.result as Record<string, unknown>;
  assert.equal(initResult.protocolVersion, MCP_VERSION);
  assert.ok(initResult.capabilities);
  assert.equal((initResult.serverInfo as Record<string, string>).name, 'Test');
  assert.ok(server.isInitialized);
});

testAsync('Server — initialize 拒绝不兼容版本', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2023-01-01', // 旧版本
      capabilities: {},
      clientInfo: { name: 'OldClient', version: '1.0' },
    },
  });

  const errResp = result as JsonRpcError;
  assert.equal(errResp.error.code, ErrorCode.INVALID_PARAMS);
  assert.ok(errResp.error.message.includes('不支持的协议版本'));
});

testAsync('Server — ping', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'ping',
  });

  const resp = result as JsonRpcResponse;
  assert.deepStrictEqual(resp.result, {});
});

testAsync('Server — tools/list 返回工具定义', async () => {
  const registry = new ToolRegistry();
  registry.register({ definition: CALCULATOR_DEFINITION, executor: calculatorExecutor });

  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });

  const resp = result as JsonRpcResponse;
  const listResult = resp.result as { tools: MCPTool[] };
  assert.equal(listResult.tools.length, 1);
  assert.equal(listResult.tools[0].name, 'calculator');
  assert.equal(listResult.tools[0].inputSchema.type, 'object');
});

testAsync('Server — tools/call 调用计算器', async () => {
  const registry = new ToolRegistry();
  registry.register({ definition: CALCULATOR_DEFINITION, executor: calculatorExecutor });

  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'calculator', arguments: { expression: '3 + 4' } },
  });

  const resp = result as JsonRpcResponse;
  const callResult = resp.result as CallToolResult;
  assert.equal(callResult.content.length, 1);
  assert.equal(callResult.content[0].type, 'text');
  assert.ok(callResult.content[0].text!.includes('7'));
});

testAsync('Server — tools/call 不存在的工具', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'nonexistent', arguments: {} },
  });

  const errResp = result as JsonRpcError;
  assert.equal(errResp.error.code, ErrorCode.METHOD_NOT_FOUND);
  assert.ok(errResp.error.message.includes('不存在'));
});

testAsync('Server — 不支持的方法', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'nonexistent/method',
  });

  const errResp = result as JsonRpcError;
  assert.equal(errResp.error.code, ErrorCode.METHOD_NOT_FOUND);
});

testAsync('Server — 通知不需要响应', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  assert.equal(result, null, '通知应返回 null');
});

testAsync('Server — resources/list 返回空', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/list',
  });

  const resp = result as JsonRpcResponse;
  const listResult = resp.result as { resources: unknown[] };
  assert.deepStrictEqual(listResult.resources, []);
});

testAsync('Server — prompts/list 返回空', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'prompts/list',
  });

  const resp = result as JsonRpcResponse;
  const listResult = resp.result as { prompts: unknown[] };
  assert.deepStrictEqual(listResult.prompts, []);
});

testAsync('Server — JSON-RPC 版本不匹配', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '1.0',
    id: 1,
    method: 'ping',
  } as unknown as JsonRpcRequest);

  const errResp = result as JsonRpcError;
  assert.equal(errResp.error.code, ErrorCode.INVALID_REQUEST);
});

// ================================================================
//  第四部分：MCPClient 集成测试
// ================================================================

testAsync('Client — connect/disconnect 生命周期', async () => {
  const { client } = await createTestPair();
  assert.equal(client.isConnected, false);

  await client.connect();
  assert.equal(client.isConnected, true);
  assert.ok(client.serverInfo);
  assert.ok(client.serverCapabilities);

  await client.disconnect();
  assert.equal(client.isConnected, false);
});

testAsync('Client — 重复 connect 应抛异常', async () => {
  const { client } = await createTestPair();
  await client.connect();

  try {
    await client.connect();
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.ok(err instanceof MCPConnectionError);
  }

  await client.disconnect();
});

testAsync('Client — 未连接时调用应抛异常', async () => {
  const { client } = await createTestPair();

  try {
    await client.listTools();
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.ok(err instanceof MCPConnectionError);
  }
});

testAsync('Client — listTools 获取工具列表', async () => {
  const { client } = await createTestPair();
  await client.connect();

  const { tools } = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'calculator');

  await client.disconnect();
});

testAsync('Client — callTool 执行工具', async () => {
  const { client } = await createTestPair();
  await client.connect();

  const result = await client.callTool('calculator', { expression: '42' });
  assert.ok(result.content.length > 0);
  assert.equal(result.content[0].type, 'text');

  const parsed = JSON.parse(result.content[0].text!);
  assert.equal(parsed.success, true);
  assert.equal(parsed.result, 42);

  await client.disconnect();
});

testAsync('Client — callTool 调用不存在的工具', async () => {
  const { client } = await createTestPair();
  await client.connect();

  try {
    await client.callTool('ghost_tool', {});
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.ok(err instanceof MCPError);
  }

  await client.disconnect();
});

testAsync('Client — listResources 和 listPrompts', async () => {
  const { client } = await createTestPair();
  await client.connect();

  const { resources } = await client.listResources();
  assert.deepStrictEqual(resources, []);

  const { prompts } = await client.listPrompts();
  assert.deepStrictEqual(prompts, []);

  await client.disconnect();
});

testAsync('Client — ping 心跳', async () => {
  const { client } = await createTestPair();
  await client.connect();

  const ok = await client.ping();
  assert.equal(ok, true);

  await client.disconnect();
});

testAsync('Client — 断开后所有操作应失败', async () => {
  const { client } = await createTestPair();
  await client.connect();
  await client.disconnect();

  try {
    await client.listTools();
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.ok(err instanceof MCPConnectionError);
  }
});

// ================================================================
//  第五部分：MCPToolExecutorFactory
// ================================================================

testAsync('MCPToolExecutorFactory — 注册和执行', async () => {
  const { client } = await createTestPair();
  await client.connect();

  const factory = new MCPToolExecutorFactory();
  factory.registerClient('calc-server', client);

  const executor = factory.getExecutor('calc-server', 'calculator');
  const result = await executor({ expression: '1 + 1' });
  const obj = result as Record<string, unknown>;

  assert.equal(obj.success, true);
  assert.ok((obj.content as string).includes('"result": 2'));

  await client.disconnect();
});

testAsync('MCPToolExecutorFactory — 未注册的 Server 抛异常', async () => {
  const factory = new MCPToolExecutorFactory();
  assert.throws(
    () => factory.getExecutor('ghost', 'tool'),
    /未注册/,
  );
});

testAsync('MCPToolExecutorFactory — 注销 Server', async () => {
  const factory = new MCPToolExecutorFactory();
  factory.registerClient('srv', {} as MCPClient);

  assert.equal(factory.unregisterClient('srv'), true);
  assert.equal(factory.unregisterClient('srv'), false);

  assert.throws(
    () => factory.getExecutor('srv', 'tool'),
    /未注册/,
  );
});

testAsync('createMCPToolExecutor — 基本执行', async () => {
  const mockClient = {
    callTool: async (name: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: `called ${name} with ${JSON.stringify(args)}` }],
    }),
  } as MCPClient;

  const executor = createMCPToolExecutor(mockClient, 'test-srv', 'echo');
  const result = await executor({ msg: 'hello' });
  const obj = result as Record<string, unknown>;

  assert.equal(obj.success, true);
  assert.ok((obj.content as string).includes('called echo'));
});

// ================================================================
//  第六部分：MCPError 类型
// ================================================================

test('MCPError — 基本属性', () => {
  const err = new MCPError('测试错误', -32000, { detail: 'info' });
  assert.equal(err.name, 'MCPError');
  assert.equal(err.message, '测试错误');
  assert.equal(err.code, -32000);
  assert.deepStrictEqual(err.data, { detail: 'info' });
});

test('MCPConnectionError — 子类型', () => {
  const err = new MCPConnectionError('连接失败');
  assert.ok(err instanceof MCPError);
  assert.equal(err.name, 'MCPConnectionError');
  assert.equal(err.code, -32000);
});

test('MCPMethodNotFoundError — 子类型', () => {
  const err = new MCPMethodNotFoundError('tools/ghost');
  assert.ok(err instanceof MCPError);
  assert.equal(err.code, ErrorCode.METHOD_NOT_FOUND);
  assert.ok(err.message.includes('tools/ghost'));
});

test('MCPInvalidParamsError — 子类型', () => {
  const err = new MCPInvalidParamsError('缺少参数');
  assert.ok(err instanceof MCPError);
  assert.equal(err.code, ErrorCode.INVALID_PARAMS);
});

// ================================================================
//  第七部分：序列化边界情况
// ================================================================

test('serializeMessage — 所有消息类型', () => {
  const messages: JsonRpcMessage[] = [
    { jsonrpc: '2.0', id: 1, method: 'test' },
    { jsonrpc: '2.0', id: 1, result: 'ok' },
    { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'err' } },
    { jsonrpc: '2.0', method: 'notify' },
  ];

  for (const msg of messages) {
    const serialized = serializeMessage(msg);
    assert.ok(typeof serialized === 'string');
    assert.ok(serialized.endsWith('\n'));

    const deserialized = deserializeMessage(serialized.trim());
    assert.equal(deserialized.jsonrpc, '2.0');
  }
});

test('反序列化 — null 消息', () => {
  assert.throws(
    () => deserializeMessage(JSON.stringify(null)),
    /不是有效的 JSON 对象/,
  );
});

test('反序列化 — 非对象类型', () => {
  assert.throws(
    () => deserializeMessage('"just a string"'),
    /不是有效的 JSON 对象/,
  );
});

// ================================================================
//  第八部分：Server 边界情况
// ================================================================

testAsync('Server — empty initialize params', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });

  const errResp = result as JsonRpcError;
  assert.equal(errResp.error.code, ErrorCode.INVALID_PARAMS);
});

testAsync('Server — Server 的 instructions 配置', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
    instructions: '欢迎使用 SmartAgent！',
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_VERSION,
      capabilities: {},
      clientInfo: { name: 'C', version: '1.0' },
    },
  });

  const resp = result as JsonRpcResponse;
  const initResult = resp.result as Record<string, unknown>;
  assert.equal(initResult.instructions, '欢迎使用 SmartAgent！');
});

testAsync('Server — 空 ToolRegistry', async () => {
  const registry = new ToolRegistry();
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });

  const resp = result as JsonRpcResponse;
  const listResult = resp.result as { tools: MCPTool[] };
  assert.deepStrictEqual(listResult.tools, []);
});

testAsync('Server — tools/call 缺少名称参数', async () => {
  const registry = new ToolRegistry();
  registry.register({ definition: CALCULATOR_DEFINITION, executor: calculatorExecutor });
  const server = new MCPServer(registry, {
    serverInfo: { name: 'Test', version: '1.0' },
  });

  const result = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {} as Record<string, unknown>,
  });

  const errResp = result as JsonRpcError;
  assert.equal(errResp.error.code, ErrorCode.INVALID_PARAMS);
});

// ================================================================
//  结果汇总
// ================================================================

summarize();
