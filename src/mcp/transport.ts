/**
 * MCP 传输层实现
 *
 * MCP 支持两种标准传输方式：
 *   1. **stdio**：通过子进程的标准输入/输出通信（用于本地 MCP Server）
 *   2. **HTTP + SSE**：通过 HTTP POST 发送请求，SSE 接收响应（用于远程 MCP Server）
 *
 * ## stdio 传输原理
 *
 *   SmartAgent (父进程)         MCP Server (子进程)
 *       │                            │
 *       │── spawn ─────────────────→│  启动子进程
 *       │                            │
 *       │── stdin.write(JSON) ─────→│  发送 JSON-RPC 请求
 *       │←─ stdout line (JSON) ────│  接收 JSON-RPC 响应（行分隔）
 *       │                            │
 *       │── stdin.end() ───────────→│  关闭连接
 *
 * 每行是一个完整的 JSON 对象，用换行符（\n）分隔。
 *
 * ## HTTP+SSE 传输原理
 *
 *   SmartAgent                          MCP Server
 *       │                                    │
 *       │── GET /mcp/sse ─────────────────→│  建立 SSE 连接
 *       │←─ event: endpoint                 │  获取消息端点 URL
 *       │   data: /mcp/messages?sid=xxx     │
 *       │                                    │
 *       │── POST /mcp/messages?sid=xxx ────→│  发送 JSON-RPC 请求
 *       │←─ event: message                  │  通过 SSE 接收响应
 *       │   data: {jsonrpc, id, result}     │
 *       │                                    │
 *       │── POST /mcp/messages?sid=xxx ────→│  发送下一个请求...
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  JsonRpcMessage,
  MCPTransport,
} from './types.js';
import { JSONRPC_VERSION, MCPError, MCPConnectionError } from './types.js';

// ================================================================
//  通用工具函数
// ================================================================

/**
 * 验证消息是否为有效的 JSON-RPC 消息
 */
function validateJsonRpc(message: unknown): asserts message is JsonRpcMessage {
  if (typeof message !== 'object' || message === null) {
    throw new MCPConnectionError('消息不是有效的 JSON 对象');
  }
  const msg = message as Record<string, unknown>;
  if (msg.jsonrpc !== JSONRPC_VERSION) {
    throw new MCPConnectionError(
      `JSON-RPC 版本不匹配: 期望 ${JSONRPC_VERSION}，收到 ${String(msg.jsonrpc)}`,
    );
  }
}

/**
 * 将 JSON-RPC 消息序列化为单行 JSON（stdin/stdout 传输用）
 */
export function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message) + '\n';
}

/**
 * 从单行 JSON 反序列化为 JSON-RPC 消息
 */
export function deserializeMessage(line: string): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new MCPConnectionError('无法解析 JSON-RPC 消息: ' + line.slice(0, 100));
  }
  validateJsonRpc(parsed);
  return parsed;
}

// ================================================================
//  Stdio 传输
// ================================================================

/**
 * Stdio 传输配置
 */
export interface StdioTransportConfig {
  /** 要执行的命令（如 'npx', 'python3'） */
  command: string;
  /** 命令参数（如 ['-y', '@modelcontextprotocol/server-example']） */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
}

/**
 * StdioTransport — 通过子进程标准 I/O 通信
 *
 * 使用场景：
 *   连接本地安装的 MCP Server（如通过 npx 运行的 npm 包）
 *
 * 通信方式：
 *   - 发送：写入子进程 stdin（行分隔 JSON）
 *   - 接收：读取子进程 stdout（行分隔 JSON）
 */
export class StdioTransport implements MCPTransport {
  readonly name: string;
  private config: StdioTransportConfig;
  private process: ChildProcess | null = null;
  private reader: AsyncGenerator<string> | null = null;
  private _isStarted = false;

  constructor(config: StdioTransportConfig) {
    this.config = config;
    this.name = `stdio:${config.command}`;
  }

  async start(): Promise<void> {
    if (this._isStarted) return;

    const { command, args = [], env, cwd } = this.config;

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        env: { ...process.env, ...env },
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr 全管道
        shell: false, // 不使用 shell（安全考虑）
      });

      if (!this.process.stdin || !this.process.stdout) {
        reject(new MCPConnectionError('无法创建子进程 stdio'));
        return;
      }

      // 监听 stderr（MCP Server 的日志/调试输出）
      const stderrDecoder = new TextDecoder();
      if (this.process.stderr) {
        this.process.stderr.on('data', (chunk: Buffer) => {
          const text = stderrDecoder.decode(chunk, { stream: true });
          // stderr 内容通常是服务端日志，不需要解析为 JSON-RPC
          // 只在调试模式下打印
          if (process.env.SMARTAGENT_LOG_LEVEL === 'debug') {
            process.stderr.write(`[MCP ${this.name} stderr] ${text}`);
          }
        });
      }

      // 创建逐行读取器（stdout 按行接收 JSON-RPC 响应）
      const rl = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      // AsyncGenerator：每次 yield 一行
      const lines: string[] = [];
      let lineResolve: ((value: string) => void) | null = null;

      rl.on('line', (line: string) => {
        if (lineResolve) {
          lineResolve(line);
          lineResolve = null;
        } else {
          lines.push(line);
        }
      });

      rl.on('close', () => {
        if (lineResolve) {
          lineResolve('');
          lineResolve = null;
        }
      });

      this.reader = (async function* () {
        while (true) {
          if (lines.length > 0) {
            yield lines.shift()!;
          } else {
            const line = await new Promise<string>((resolve) => {
              lineResolve = resolve;
            });
            if (line === '') break; // 流关闭
            yield line;
          }
        }
      })();

      // 监听进程退出
      this.process.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.warn(`[MCP] 子进程异常退出: code=${code}, signal=${signal}`);
        }
      });

      this.process.on('error', (err) => {
        reject(new MCPConnectionError(`子进程启动失败: ${err.message}`));
      });

      // 给子进程一点时间完成启动
      setTimeout(() => {
        this._isStarted = true;
        resolve();
      }, 100);
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.process?.stdin) {
      throw new MCPConnectionError('传输未启动或 stdin 不可用');
    }

    const data = serializeMessage(message);

    return new Promise((resolve, reject) => {
      const wrote = this.process!.stdin!.write(data, (err) => {
        if (err) reject(new MCPConnectionError(`写入 stdin 失败: ${err.message}`));
        else resolve();
      });
      // 写入失败（缓冲区满等）
      if (!wrote) {
        this.process!.stdin!.once('drain', () => resolve());
      }
    });
  }

  async receive(): Promise<JsonRpcMessage> {
    if (!this.reader) {
      throw new MCPConnectionError('传输未启动');
    }

    const result = await this.reader.next();
    if (result.done || !result.value) {
      throw new MCPConnectionError('传输已关闭');
    }

    return deserializeMessage(result.value);
  }

  async close(): Promise<void> {
    if (this.process?.stdin) {
      this.process.stdin.end();
    }
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.reader = null;
    this._isStarted = false;
  }
}

// ================================================================
//  HTTP+SSE 传输
// ================================================================

/**
 * HTTP+SSE 传输配置
 */
export interface HttpTransportConfig {
  /** MCP Server 的 SSE 端点 URL（如 http://localhost:3000/mcp/sse） */
  url: string;
  /** 请求超时（毫秒，默认 30000） */
  timeout?: number;
  /** 额外的 HTTP 请求头 */
  headers?: Record<string, string>;
}

/** SSE 事件 */
interface SSEEvent {
  event: string;
  data: string;
}

/**
 * HttpTransport — 通过 HTTP POST + SSE 通信
 *
 * 使用场景：
 *   连接远程 MCP Server（HTTP 端点）
 *
 * 通信方式：
 *   - 发送：HTTP POST 到消息端点
 *   - 接收：通过 SSE 连接接收推送
 *
 * 工作流程：
 *   1. 建立 SSE 连接 (GET /mcp/sse)，获取 session ID
 *   2. 通过 POST /mcp/messages?sid=xxx 发送 JSON-RPC 请求
 *   3. 通过 SSE 事件接收 JSON-RPC 响应
 */
export class HttpTransport implements MCPTransport {
  readonly name: string;
  private config: Required<HttpTransportConfig>;
  private sessionId: string | null = null;
  private messageEndpoint: string | null = null;
  private sseController: AbortController | null = null;
  private sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private responseQueue: JsonRpcMessage[] = [];
  private responseResolve: ((value: JsonRpcMessage) => void) | null = null;
  private _isStarted = false;

  constructor(config: HttpTransportConfig) {
    this.config = {
      url: config.url,
      timeout: config.timeout ?? 30000,
      headers: config.headers ?? {},
    };
    this.name = `http:${config.url}`;
  }

  async start(): Promise<void> {
    if (this._isStarted) return;

    this.sseController = new AbortController();

    // 建立 SSE 连接
    const sseUrl = this.config.url;
    const response = await fetch(sseUrl, {
      signal: AbortSignal.timeout(this.config.timeout),
      headers: {
        Accept: 'text/event-stream',
        ...this.config.headers,
      },
    });

    if (!response.ok) {
      throw new MCPConnectionError(
        `SSE 连接失败: HTTP ${response.status} - ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new MCPConnectionError('SSE 响应没有 body');
    }

    // 在后台读取 SSE 事件
    this.sseReader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 异步读取 SSE 流
    const readSSE = async () => {
      try {
        while (true) {
          const { done, value } = await this.sseReader!.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = this._parseSSEBuffer(buffer);
          buffer = events.remaining;

          for (const event of events.parsed) {
            if (event.event === 'endpoint') {
              // 获取消息端点 URL
              this.messageEndpoint = event.data.trim();
            } else if (event.event === 'message') {
              // 收到 JSON-RPC 响应
              try {
                const msg: unknown = JSON.parse(event.data);
                validateJsonRpc(msg);
                // 放入响应队列
                if (this.responseResolve) {
                  this.responseResolve(msg as JsonRpcMessage);
                  this.responseResolve = null;
                } else {
                  this.responseQueue.push(msg as JsonRpcMessage);
                }
              } catch (err) {
                console.warn('[MCP HTTP] 无法解析 SSE 消息:', String(err));
              }
            }
          }
        }
      } catch (err) {
        // SSE 流关闭或读取错误
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('[MCP HttpTransport] SSE 读取异常:', err.message);
        }
      }
    };

    // 后台运行 SSE 读取，捕获异常
    readSSE().catch((err) => {
      console.error('[MCP HttpTransport] SSE 监听器异常退出:', err instanceof Error ? err.message : String(err));
    });

    // 等待获取消息端点（最多 5 秒）
    const startTime = Date.now();
    while (!this.messageEndpoint && (Date.now() - startTime) < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!this.messageEndpoint) {
      throw new MCPConnectionError('未收到 SSE endpoint 事件');
    }

    this._isStarted = true;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.messageEndpoint) {
      throw new MCPConnectionError('消息端点未就绪');
    }

    const body = JSON.stringify(message);
    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body,
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new MCPConnectionError(
        `发送消息失败: HTTP ${response.status} - ${response.statusText}`,
      );
    }
  }

  async receive(): Promise<JsonRpcMessage> {
    // 从队列中取
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }

    // 等待新消息
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseResolve = null;
        reject(new MCPConnectionError('等待 SSE 响应超时'));
      }, this.config.timeout);

      this.responseResolve = (msg: JsonRpcMessage) => {
        clearTimeout(timeout);
        resolve(msg);
      };
    });
  }

  async close(): Promise<void> {
    // 取消 SSE 流读取器，释放连接
    if (this.sseReader) {
      try { await this.sseReader.cancel(); } catch { /* 忽略取消失败 */ }
      this.sseReader = null;
    }
    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
    }
    this.sessionId = null;
    this.messageEndpoint = null;
    this.responseQueue = [];
    this._isStarted = false;
  }

  /** 解析 SSE 事件缓冲区 */
  private _parseSSEBuffer(buffer: string): {
    parsed: SSEEvent[];
    remaining: string;
  } {
    const events: SSEEvent[] = [];
    let currentEvent: SSEEvent = { event: '', data: '' };
    let pos = 0;
    const lines = buffer.split('\n');

    // 找到最后一个完整事件的位置
    let lastComplete = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('event: ')) {
        currentEvent.event = line.slice(7);
      } else if (line.startsWith('data: ')) {
        currentEvent.data += (currentEvent.data ? '\n' : '') + line.slice(6);
      } else if (line === '' && (currentEvent.event || currentEvent.data)) {
        events.push({ ...currentEvent });
        currentEvent = { event: '', data: '' };
        lastComplete = i + 1;
      }
    }

    const remaining = lines.slice(lastComplete).join('\n');
    return { parsed: events, remaining };
  }
}
