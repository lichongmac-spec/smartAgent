/**
 * queue/types.ts - 任务队列类型定义
 *
 * 理解：就像外卖订单的状态机 ——
 *  pending（等待中）→ running（制作中）→ completed（已完成）/ failed（失败）
 */

/** 任务当前生命周期状态 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'exhausted';

/** 单个任务 */
export interface Job<T = any> {
  /** 唯一标识 */
  id: string;
  /** 要执行的异步函数 */
  fn: () => Promise<T>;
  /** 优先级（数字越小越优先，默认 0） */
  priority: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 剩余重试次数 */
  retriesLeft: number;
  /** 当前延迟时长（毫秒，用于指数退避） */
  delay: number;
  /** 任务创建时间 */
  createdAt: Date;
  /** 任务开始执行时间 */
  startedAt?: Date;
  /** 任务完成时间 */
  finishedAt?: Date;
  /** 最后一次错误 */
  lastError?: Error;
  /** 成功结果 */
  result?: T;
}

/** 任务队列配置 */
export interface QueueConfig {
  /** 最大并发数（默认 1） */
  concurrency?: number;
  /** 重试基础延迟（毫秒，默认 1000） */
  baseDelay?: number;
  /** 退避策略（默认 'exponential'） */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** 是否在基础延迟上添加随机抖动（默认 true） */
  jitter?: boolean;
}

/** 任务队列统计信息 */
export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}
