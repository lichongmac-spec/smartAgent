/**
 * types.ts - 心跳与健康监控类型定义
 *
 * 理解：就像体检报告的单据格式 — 定义每一项检查的"标准"和"结果"。
 */

import type { ILLMClient } from '../llm/types.js';

// ============================================================
//  1. 单次检查结果
// ============================================================

/** 单次健康检查的结果 */
export interface CheckResult {
  /** 检查项名称 */
  name: string;
  /** 是否通过（true=健康, false=不健康） */
  passed: boolean;
  /** 失败时的错误信息（可选） */
  error?: string;
  /** 检查耗时（毫秒） */
  duration: number;
}

// ============================================================
//  2. 全局健康状态
// ============================================================

/** 系统整体健康状态 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** 健康状态快照 */
export interface HealthSnapshot {
  /** 当前整体状态 */
  status: HealthStatus;
  /** 本轮所有检查结果 */
  results: CheckResult[];
  /** 本轮检查时间 */
  checkedAt: Date;
  /** 连续失败次数（用于判断是否要触发 unhealthy） */
  consecutiveFailures: number;
  /** 连续成功次数（用于判断是否已恢复） */
  consecutiveSuccesses: number;
  /** 本次心跳耗时（毫秒） */
  totalDuration: number;
}

// ============================================================
//  3. 心跳管理器配置
// ============================================================

/** 心跳管理器配置 */
export interface HeartbeatConfig {
  /** 检查间隔（毫秒），默认 30000（30 秒） */
  intervalMs?: number;
  /** 连续失败多少次后触发 unhealthy 事件，默认 3 */
  failureThreshold?: number;
  /** 连续成功多少次后触发 recovered 事件，默认 2 */
  recoveryThreshold?: number;
  /** 是否启用自动重启（process.exit(1)，由外部 PM2 重启），默认 false */
  autoRestart?: boolean;
  /** 是否在启动时立即执行一次检查，默认 true */
  initialCheck?: boolean;
  /** 禁用的内置检查项名称列表（如 ['disk', 'memory']） */
  disabledChecks?: string[];
  /** 外部 LLM 客户端引用（用于 LLM 健康检查） */
  llmClient?: ILLMClient;
  /** 磁盘空间最低阈值（字节），默认 100MB */
  minDiskBytes?: number;
  /** 内存最大使用率阈值（0~1），默认 0.9（90%） */
  maxMemoryRatio?: number;
}

// ============================================================
//  4. 健康检查函数类型
// ============================================================

/**
 * 健康检查函数签名
 *
 * 理解：每个检查就是"一个异步的体检项目"，返回 true=通过 / false=不通过。
 */
export type HealthCheckFn = () => Promise<boolean>;

// ============================================================
//  5. 事件类型
// ============================================================

/** unhealthy 事件的负载 */
export interface UnhealthyEvent {
  /** 触发不健康的快照 */
  snapshot: HealthSnapshot;
  /** 失败的检查项信息 */
  failedChecks: CheckResult[];
}

/** recovered 事件的负载 */
export interface RecoveredEvent {
  /** 恢复时的快照 */
  snapshot: HealthSnapshot;
}
