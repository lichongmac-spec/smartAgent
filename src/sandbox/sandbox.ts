/**
 * sandbox/sandbox.ts
 *
 * 安全沙箱：为 AI 工具提供安全的执行环境
 *
 * 核心思想：所有对外部资源的访问都必须经过沙箱的"安检"。
 * 沙箱会检查操作是否在白名单内、是否超时、是否符合资源限制。
 *
 * 与 src/tools/sandbox.ts 的区别：
 * - tools/sandbox：底层路径校验工具（供 read_file/write_file 工具使用）
 * - sandbox/sandbox：高层操作包装器（直接封装 readFile/writeFile/executeCommand，
 *   附带超时、大小限制、命令黑白名单，返回统一的 SandboxResult<T>）
 */

import { promises as fs } from 'fs';
import { normalize, relative } from 'path';

// ── 配置 ──

export interface SandboxConfig {
  /** 允许访问的根目录（所有路径必须在此目录下） */
  allowedRoot?: string;
  /** 允许执行的命令白名单（支持正则字符串） */
  allowedCommands?: string[];
  /** 禁止执行的命令黑名单 */
  forbiddenCommands?: string[];
  /** 最大文件大小（字节），读取超过此大小将截断或拒绝 */
  maxFileSize?: number;
  /** 操作超时（毫秒） */
  timeout?: number;
  /** 是否启用网络访问（默认 false） */
  allowNetwork?: boolean;
}

type ResolvedConfig = Required<SandboxConfig>;

// ── 结果类型 ──

export interface SandboxResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  /** 耗时（毫秒） */
  duration: number;
}

// ── 沙箱类 ──

export class Sandbox {
  private config: ResolvedConfig;

  constructor(config: SandboxConfig = {}) {
    this.config = {
      allowedRoot: config.allowedRoot ?? normalize(process.cwd()),
      allowedCommands: config.allowedCommands ?? [],
      forbiddenCommands: config.forbiddenCommands ?? ['rm', 'del', 'format', 'sudo'],
      maxFileSize: config.maxFileSize ?? 1024 * 1024,
      timeout: config.timeout ?? 30000,
      allowNetwork: config.allowNetwork ?? false,
    };
  }

  // ── 路径安全 ──

  /**
   * 检查路径是否在允许的根目录内
   *
   * 防止路径遍历攻击：例如允许 /home/user，但不能访问 /etc/passwd
   */
  private isPathAllowed(targetPath: string): boolean {
    const normalized = normalize(targetPath);
    const relativePath = relative(this.config.allowedRoot, normalized);
    if (relativePath.startsWith('..') || relativePath.includes('../')) {
      return false;
    }
    return normalized.startsWith(this.config.allowedRoot);
  }

  // ── 命令安全 ──

  /**
   * 检查命令是否允许执行
   * 先查黑名单，再查白名单（白名单非空时才启用白名单模式）
   */
  private isCommandAllowed(command: string): boolean {
    const cmdBase = command.split(' ')[0];

    for (const forbidden of this.config.forbiddenCommands) {
      if (cmdBase === forbidden || cmdBase.includes(forbidden)) {
        return false;
      }
    }

    if (this.config.allowedCommands.length > 0) {
      return this.config.allowedCommands.some(
        (allowed) => cmdBase === allowed || new RegExp(allowed).test(cmdBase),
      );
    }

    return true;
  }

  // ── 超时包装 ──

  /**
   * 带超时的异步执行包装
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`操作超时（${timeoutMs}ms）`));
      }, timeoutMs);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ── 文件操作 ──

  /**
   * 安全读取文件
   */
  async readFile(filePath: string): Promise<SandboxResult<string>> {
    const startTime = Date.now();
    try {
      if (!this.isPathAllowed(filePath)) {
        throw new Error(`路径 "${filePath}" 不在允许的根目录内`);
      }

      const content = await this.withTimeout(
        fs.readFile(filePath, 'utf-8'),
        this.config.timeout,
      );

      if (content.length > this.config.maxFileSize) {
        const truncated = content.slice(0, this.config.maxFileSize);
        return {
          success: true,
          data: truncated + '\n... [文件过大，已截断]',
          duration: Date.now() - startTime,
        };
      }

      return { success: true, data: content, duration: Date.now() - startTime };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 安全写入文件
   */
  async writeFile(filePath: string, content: string): Promise<SandboxResult<void>> {
    const startTime = Date.now();
    try {
      if (!this.isPathAllowed(filePath)) {
        throw new Error(`路径 "${filePath}" 不在允许的根目录内`);
      }

      if (content.length > this.config.maxFileSize) {
        throw new Error(
          `内容大小 (${content.length} 字节) 超过最大限制 (${this.config.maxFileSize})`,
        );
      }

      await this.withTimeout(
        fs.writeFile(filePath, content, 'utf-8'),
        this.config.timeout,
      );

      return { success: true, duration: Date.now() - startTime };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  // ── 命令执行 ──

  /**
   * 安全执行命令（模拟）
   *
   * 生产环境可用 child_process.exec 但需慎重。
   * 此处仅演示命令安全校验逻辑，不真正执行。
   */
  async executeCommand(command: string): Promise<SandboxResult<string>> {
    const startTime = Date.now();
    try {
      if (!this.isCommandAllowed(command)) {
        throw new Error(`命令 "${command}" 被禁止执行`);
      }

      return {
        success: true,
        data: `[模拟执行] 命令 "${command}" 已执行，结果：成功（演示）`,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  // ── 查询 ──

  /** 获取当前配置（只读） */
  getConfig(): Readonly<ResolvedConfig> {
    return { ...this.config };
  }
}

// ── 工厂函数 ──

/**
 * 创建默认沙箱实例（基于当前工作目录）
 */
export function createDefaultSandbox(): Sandbox {
  return new Sandbox({
    allowedRoot: process.cwd(),
    maxFileSize: 1024 * 1024,
    timeout: 10000,
    forbiddenCommands: ['rm', 'del', 'sudo', 'chmod', 'chown'],
  });
}
