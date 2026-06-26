/**
 * builtin-checks.ts - 内置健康检查函数
 *
 * 理解：就像体检套餐里的"常规项目" — 开箱即用的检查。
 * 包括：LLM 服务可用性、磁盘空间、内存使用率。
 */

import { execSync } from 'child_process';
import { totalmem, freemem } from 'os';
import type { ILLMClient } from '../llm/types.js';
import type { HealthCheckFn } from './types.js';

// ============================================================
//  1. LLM 服务健康检查
// ============================================================

/**
 * 创建 LLM 健康检查函数
 *
 * 理解：调用 LLM 客户端的 healthCheck() 方法，确认 AI 服务在线。
 * 这是最重要的检查项 — Agent 离不开 LLM。
 *
 * @param client - LLM 客户端实例
 * @returns 健康检查函数
 */
export function createLLMHealthCheck(client: ILLMClient): HealthCheckFn {
  return async () => {
    try {
      return await client.healthCheck();
    } catch {
      return false;
    }
  };
}

// ============================================================
//  2. 磁盘空间检查
// ============================================================

/**
 * 创建磁盘空间健康检查函数
 *
 * 理解：检查当前工作目录所在磁盘的剩余空间。
 * 空间不足会导致日志、会话记录无法写入。
 *
 * 实现：通过 df 命令获取可用空间（跨平台兼容 macOS/Linux）。
 *
 * @param minBytes - 最低阈值（字节），默认 100MB
 * @returns 健康检查函数
 */
export function createDiskHealthCheck(minBytes: number = 100 * 1024 * 1024): HealthCheckFn {
  return async () => {
    try {
      // 使用 POSIX df 命令获取当前目录所在分区的可用空间
      const output = execSync('df -k .', { encoding: 'utf-8' });
      // df -k 输出格式:
      // Filesystem    1024-blocks      Used Available Capacity  Mounted on
      // /dev/disk3s1   489620272  354387568 134720704    73%    /
      const lines = output.trim().split('\n');
      if (lines.length < 2) return true; // 无法解析，默认通过

      const parts = lines[1].trim().split(/\s+/);
      // Available 列是第 4 列（0-indexed: 3）
      const availableKB = parseInt(parts[3], 10);
      if (isNaN(availableKB)) return true; // 无法解析，默认通过

      return availableKB * 1024 >= minBytes;
    } catch {
      // df 命令不可用（如 Windows），默认通过
      return true;
    }
  };
}

// ============================================================
//  3. 内存使用率检查
// ============================================================

/**
 * 创建内存使用率健康检查函数
 *
 * 理解：检查进程内存使用是否接近上限。
 * 内存过高可能导致 OOM（Out of Memory）崩溃。
 *
 * @param maxRatio - 最大使用率阈值（0~1），默认 0.9
 * @returns 健康检查函数
 */
export function createMemoryHealthCheck(maxRatio: number = 0.9): HealthCheckFn {
  return async () => {
    try {
      const total = totalmem();
      const free = freemem();
      const used = total - free;
      const usedRatio = used / total;
      return usedRatio < maxRatio;
    } catch {
      return true; // 无法获取，默认通过
    }
  };
}
