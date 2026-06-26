/**
 * queue/task-queue.ts - 优先级任务队列
 *
 * 核心概念（高中生版）：
 * ┌──────────────────────────────────────────┐
 * │  任务队列 = 超市收银台                     │
 * │  ├─ 排队规则（优先级）：VIP（数字小）先结账  │
 * │  ├─ 并发控制：最多同时开 N 个收银口          │
 * │  └─ 失败重试：扫码失败 → 等一会再试          │
 * └──────────────────────────────────────────┘
 *
 * 算法复杂度：
 * - add()：O(n log n)（排序，可用堆优化到 O(log n)）
 * - process()：O(1)（只取第一个）
 *
 * 设计参考：
 * - 优先级队列：数据结构二叉堆理论
 * - 指数退避：Ethernet CSMA/CD 退避算法 (IEEE 802.3, 1985)
 * - 事件驱动：HeartbeatManager 的 EventEmitter 模式
 */

import { EventEmitter } from 'events';
import type { Job, QueueConfig, QueueStats } from './types.js';

// ============================================================
//  事件接口
// ============================================================

export interface TaskQueueEvents {
  /** 任务被添加到队列 */
  enqueued: (job: Job) => void;
  /** 任务开始执行 */
  started: (job: Job) => void;
  /** 任务执行成功 */
  completed: (job: Job) => void;
  /** 任务执行失败（正在重试） */
  failed: (job: Job) => void;
  /** 任务即将重试 */
  retrying: (job: Job, delay: number) => void;
  /** 任务重试次数耗尽，彻底放弃 */
  exhausted: (job: Job) => void;
  /** 队列清空 */
  drained: () => void;
}

// ============================================================
//  TaskQueue 类
// ============================================================

export class TaskQueue extends EventEmitter {
  private jobs: Job[] = [];
  private running = 0;
  private concurrency: number;
  private baseDelay: number;
  private backoff: 'fixed' | 'linear' | 'exponential';
  private jitterEnabled: boolean;
  /** 等待重试的延迟任务数（在 setTimeout 中等待的任务） */
  private pendingRetries = 0;
  private completedCount = 0;
  private failedCount = 0;

  constructor(config: QueueConfig = {}) {
    super();
    this.concurrency = config.concurrency ?? 1;
    this.baseDelay = config.baseDelay ?? 1000;
    this.backoff = config.backoff ?? 'exponential';
    this.jitterEnabled = config.jitter ?? true;
  }

  // ---- 公共 API ----

  /**
   * 添加任务到队列
   * @param fn      异步任务函数
   * @param priority 优先级（0 最高，数字越小越优先）
   * @param maxRetries 最大重试次数（默认 3）
   * @returns 任务唯一 ID
   */
  add<T>(fn: () => Promise<T>, priority = 0, maxRetries = 3): string {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: Job<T> = {
      id,
      fn,
      priority,
      maxRetries,
      retriesLeft: maxRetries,
      delay: this.baseDelay,
      createdAt: new Date(),
    };

    this.jobs.push(job as Job);
    this.sortByPriority();
    this.emit('enqueued', job);
    this.scheduleProcess();
    return id;
  }

  /**
   * 获取队列统计信息
   */
  stats(): QueueStats {
    return {
      pending: this.jobs.length,
      running: this.running,
      completed: this.completedCount,
      failed: this.failedCount,
      total: this.jobs.length + this.running + this.completedCount + this.failedCount,
    };
  }

  /** 清空所有待处理任务（不影响正在执行的任务） */
  clear(): void {
    this.jobs = [];
  }

  /**
   * 等待所有任务完成
   * @param timeoutMs 超时时间（毫秒），-1 表示无超时
   */
  async drain(timeoutMs = -1): Promise<void> {
    if (this.jobs.length === 0 && this.running === 0 && this.pendingRetries === 0) return;

    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;

      const onDrained = () => {
        if (timer) clearTimeout(timer);
        this.off('drained', onDrained);
        resolve();
      };

      this.once('drained', onDrained);

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.off('drained', onDrained);
          reject(new Error(`等待任务完成超时 (${timeoutMs}ms)`));
        }, timeoutMs);
      }
    });
  }

  // ---- 内部实现 ----

  /** 按优先级排序（数字越小越靠前） */
  private sortByPriority(): void {
    this.jobs.sort((a, b) => a.priority - b.priority);
  }

  /** 使用 setImmediate 触发 process，避免调用栈过深 */
  private scheduleProcess(): void {
    setImmediate(() => this.process());
  }

  /** 处理队列中的任务 */
  private async process(): Promise<void> {
    // 并发已满或没有待处理任务
    if (this.running >= this.concurrency || this.jobs.length === 0) {
      // 完全空闲且没有待重试任务时触发 drained
      if (this.running === 0 && this.jobs.length === 0 && this.pendingRetries === 0) {
        this.emit('drained');
      }
      return;
    }

    const job = this.jobs.shift()!;
    this.running++;

    job.startedAt = new Date();
    this.emit('started', job);

    try {
      job.result = await job.fn();
      job.finishedAt = new Date();
      this.completedCount++;
      this.emit('completed', job);
    } catch (error) {
      job.lastError = error instanceof Error ? error : new Error(String(error));

      if (job.retriesLeft > 0) {
        job.retriesLeft--;

        // 计算退避延迟
        const waitTime = this.calculateBackoff(job);
        this.emit('failed', job);
        this.emit('retrying', job, waitTime);

        // 延迟后重新入队
        this.pendingRetries++;
        setTimeout(() => {
          this.pendingRetries--;
          this.jobs.push(job);
          this.sortByPriority();
          this.scheduleProcess();
        }, waitTime);
      } else {
        // 重试次数耗尽
        job.finishedAt = new Date();
        this.failedCount++;
        this.emit('failed', job);
        this.emit('exhausted', job);
      }
    } finally {
      this.running--;
      // 继续处理下一个（有可用的并发槽位）
      this.scheduleProcess();
    }
  }

  /** 计算退避延迟时间 */
  private calculateBackoff(job: Job): number {
    const attempt = job.maxRetries - job.retriesLeft;
    let waitTime: number;

    switch (this.backoff) {
      case 'linear':
        waitTime = this.baseDelay * attempt;
        break;
      case 'fixed':
        waitTime = this.baseDelay;
        break;
      case 'exponential':
      default:
        waitTime = this.baseDelay * Math.pow(2, attempt - 1);
        break;
    }

    // ±30% 随机抖动，避免惊群效应
    if (this.jitterEnabled) {
      const jitterFactor = 0.7 + Math.random() * 0.6; // 0.7 ~ 1.3
      waitTime = Math.round(waitTime * jitterFactor);
    }

    // 保存到 job 上，供下次使用
    job.delay = waitTime;
    return waitTime;
  }

  // ---- 类型安全的 on/once ----

  on<E extends keyof TaskQueueEvents>(event: E, listener: TaskQueueEvents[E]): this {
    return super.on(event, listener);
  }

  once<E extends keyof TaskQueueEvents>(event: E, listener: TaskQueueEvents[E]): this {
    return super.once(event, listener);
  }

  off<E extends keyof TaskQueueEvents>(event: E, listener: TaskQueueEvents[E]): this {
    return super.off(event, listener);
  }
}
