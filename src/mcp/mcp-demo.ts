/**
 * MCP 端到端 Demo
 *
 * 演示 MCP 协议的完整工作流程，包括：
 *   1. MCPServer 暴露 SmartAgent 工具
 *   2. MCPClient 连接服务端
 *   3. 工具发现和调用
 *   4. 命名空间转换
 *
 * ## 架构
 *
 * 本 Demo 使用"进程内模拟"来避免启动真实子进程的复杂性。
 * MCPServer 和 MCPClient 之间通过一个简单的消息队列通信，
 * 这正好模拟了 MCP Transport 的工作方式：
 *
 *   MCPServer.handleMessage()  ←→  messageQueue  ←→  DemoTransport
 *
 * DemoTransport 实现了 MCPTransport 接口，
 * 但实际消息路是由 MCPServer 处理而非外部进程。
 *
 * ## 运行
 *
 * ```bash
 * node --import tsx src/mcp/mcp-demo.ts
 * ```
 */

import { ToolRegistry } from '../tools/registry.js';
import {
  READ_FILE_DEFINITION,
  readFileExecutor,
} from '../tools/builtin/read-file.js';
import {
  CALCULATOR_DEFINITION,
  calculatorExecutor,
} from '../tools/builtin/calculator.js';

import { MCPServer } from './server.js';
import { MCPClient } from './client.js';
import {
  buildNamespacedName,
  parseNamespacedName,
  isMCPTool,
  mcpToolToDefinition,
  extractToolResultText,
  MCPToolExecutorFactory,
} from './tool-adapter.js';
import {
  MCPError,
  MCPConnectionError,
} from './types.js';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MCPTransport,
} from './types.js';

// ================================================================
//  DemoTransport — 进程内消息传递（模拟 stdio）
// ================================================================

/**
 * DemoTransport 用于在 Demo 中模拟 MCP 传输层。
 *
 * 真实的 Transport 会通过 stdio 或 HTTP 与外部进程通信，
 * 这里我们直接把消息路由到 MCPServer，避免启动子进程的复杂性。
 */
class DemoTransport implements MCPTransport {
  readonly name = 'demo';
  private server: MCPServer;
  private incoming: JsonRpcMessage[] = [];
  private resolve: ((msg: JsonRpcMessage) => void) | null = null;
  private _closed = false;

  constructor(server: MCPServer) {
    this.server = server;
  }

  async start(): Promise<void> {
    // 进程内传输不需要特殊的启动逻辑
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this._closed) {
      throw new MCPConnectionError('传输已关闭');
    }

    // 将消息路由到 MCPServer 处理
    const request = message as JsonRpcRequest;
    const response = await this.server.handleMessage(request);

    if (response) {
      // 将响应放入接收队列
      if (this.resolve) {
        this.resolve(response);
        this.resolve = null;
      } else {
        this.incoming.push(response);
      }
    }
  }

  async receive(): Promise<JsonRpcMessage> {
    if (this._closed) {
      throw new MCPConnectionError('传输已关闭');
    }

    if (this.incoming.length > 0) {
      return this.incoming.shift()!;
    }

    return new Promise<JsonRpcMessage>((resolve) => {
      this.resolve = resolve;
    });
  }

  async close(): Promise<void> {
    this._closed = true;
    this.incoming = [];
    if (this.resolve) {
      this.resolve = null;
    }
  }
}

// ================================================================
//  辅助函数
// ================================================================

function printSection(title: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

function printResult(label: string, data: unknown): void {
  console.log(`\n📋 ${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

function printOK(message: string): void {
  console.log(`  ✅ ${message}`);
}

function printFAIL(message: string): void {
  console.log(`  ❌ ${message}`);
}

// ================================================================
//  Demo 主流程
// ================================================================

async function runDemo(): Promise<void> {
  console.log('🚀 SmartAgent MCP 协议 Demo\n');

  // ==============================================================
  //  阶段 1：创建 Server 和 Client
  // ==============================================================
  printSection('阶段 1 — 创建 MCP Server 和 Client');

  const registry = new ToolRegistry();
  registry.register({ definition: CALCULATOR_DEFINITION, executor: calculatorExecutor });
  registry.register({ definition: READ_FILE_DEFINITION, executor: readFileExecutor });
  printOK(`注册了 ${registry.size} 个工具: ${registry.listNames().join(', ')}`);

  const server = new MCPServer(registry, {
    serverInfo: { name: 'SmartAgent MCP Server', version: '1.0.0' },
    instructions: 'SmartAgent 内置工具（计算器和文件读取）',
    debug: false,
  });
  printOK('MCPServer 创建完成');

  const transport = new DemoTransport(server);
  const client = new MCPClient(transport, {
    clientInfo: { name: 'SmartAgent MCP Client', version: '1.0.0' },
    debug: false,
  });
  printOK('MCPClient 创建完成（使用 DemoTransport）');

  // ==============================================================
  //  阶段 2：协议握手
  // ==============================================================
  printSection('阶段 2 — 协议握手（initialize）');

  await client.connect();
  printOK('握手成功');
  printOK(`服务端: ${client.serverInfo?.name} v${client.serverInfo?.version}`);
  printResult('服务端能力', client.serverCapabilities);

  // ==============================================================
  //  阶段 3：工具发现
  // ==============================================================
  printSection('阶段 3 — 工具发现（tools/list）');

  const { tools } = await client.listTools();
  printOK(`发现了 ${tools.length} 个工具:`);

  for (const tool of tools) {
    console.log(`    🔧 ${tool.name}`);
    console.log(`       描述: ${tool.description || '(无)'}`);
    console.log(`       参数: ${Object.keys(tool.inputSchema.properties || {}).join(', ') || '(无)'}`);
  }

  // ==============================================================
  //  阶段 4：工具调用
  // ==============================================================
  printSection('阶段 4 — 工具调用（tools/call）');

  // --- 4a: 调用计算器 ---
  console.log('\n  4a. 调用 calculator');
  const calcResult = await client.callTool('calculator', {
    expression: '2 ** 10 + 3 * 7',
  });
  const calcText = extractToolResultText(calcResult);
  printResult('计算结果', JSON.parse(calcText));

  // --- 4b: 调用失败处理 ---
  console.log('\n  4b. 调用不存在的工具（错误处理）');
  try {
    await client.callTool('nonexistent_tool', {});
    printFAIL('应该抛出 MCPError');
  } catch (err) {
    if (err instanceof MCPError) {
      printOK(`正确抛出 MCPError: ${err.message}`);
    } else {
      printFAIL(`错误类型不正确: ${err}`);
    }
  }

  // ==============================================================
  //  阶段 5：工具命名空间
  // ==============================================================
  printSection('阶段 5 — 工具命名空间转换');

  // 5a: 构建命名空间名称
  const namespaced = buildNamespacedName('myserver', 'calculator');
  printOK(`命名空间转换: calculator → ${namespaced}`);

  // 5b: 解析命名空间名称
  const parsed = parseNamespacedName(namespaced);
  printOK(`解析命名空间: ${namespaced} → server=${parsed?.serverName}, tool=${parsed?.toolName}`);

  // 5c: 判断是否为 MCP 工具
  printOK(`isMCPTool('${namespaced}'): ${isMCPTool(namespaced)}`);
  printOK(`isMCPTool('calculator'): ${isMCPTool('calculator')}`);

  // 5d: MCP Tool → ToolDefinition 转换
  const mcpTool = tools[0]; // calculator
  const definition = mcpToolToDefinition(mcpTool, 'myserver');
  printResult('MCP Tool → ToolDefinition', {
    name: definition.function.name,
    description: definition.function.description,
    parameters: Object.keys(definition.function.parameters.properties as Record<string, unknown> || {}),
  });

  // ==============================================================
  //  阶段 6：资源/提示词查询
  // ==============================================================
  printSection('阶段 6 — 资源与提示词查询');

  const { resources } = await client.listResources();
  printOK(`资源数量: ${resources.length}`);

  const { prompts } = await client.listPrompts();
  printOK(`提示词数量: ${prompts.length}`);

  // ==============================================================
  //  阶段 7：断开连接
  // ==============================================================
  printSection('阶段 7 — 断开连接');

  await client.disconnect();
  printOK('连接已断开');

  // 尝试在断开后调用（应失败）
  try {
    await client.listTools();
    printFAIL('应该在断开后抛出错误');
  } catch (err) {
    if (err instanceof MCPConnectionError) {
      printOK(`正确拒绝断开后的请求: ${err.message}`);
    } else {
      printFAIL(`错误类型不正确: ${err}`);
    }
  }

  // ==============================================================
  //  阶段 8：MCPToolExecutorFactory
  // ==============================================================
  printSection('阶段 8 — MCPToolExecutorFactory');

  // 重新连接
  const transport2 = new DemoTransport(server);
  const client2 = new MCPClient(transport2);
  await client2.connect();

  const factory = new MCPToolExecutorFactory();
  factory.registerClient('test-server', client2);

  const executor = factory.getExecutor('test-server', 'calculator');
  const execResult = await executor({ expression: '100 / 4' });
  printResult('通过 Factory 执行工具', execResult);

  await client2.disconnect();

  // ==============================================================
  //  总结
  // ==============================================================
  printSection('🎉 Demo 完成');

  console.log(`
  MCP 协议核心功能验证通过：
    ✅ 协议握手（initialize/initialized）
    ✅ 工具发现（tools/list）
    ✅ 工具调用（tools/call）
    ✅ 错误处理（MCPError/MCPConnectionError）
    ✅ 命名空间管理（buildNamespacedName/parseNamespacedName）
    ✅ MCP Tool ↔ ToolDefinition 转换
    ✅ MCPToolExecutorFactory 集成
    ✅ 连接生命周期管理（connect/disconnect）
    ✅ 资源/提示词查询（空列表）

  模块文件：
    src/mcp/types.ts        — JSON-RPC 2.0 + MCP 协议类型
    src/mcp/transport.ts    — stdio / HTTP+SSE 传输
    src/mcp/client.ts       — MCP 客户端
    src/mcp/server.ts       — MCP 服务端
    src/mcp/tool-adapter.ts — 工具适配器
    src/mcp/index.ts        — 统一导出
  `);
}

// 启动 Demo
runDemo().catch((err) => {
  console.error('Demo 失败:', err);
  process.exit(1);
});
