/**
 * webhook/notifier.ts - Webhook 事件通知器
 *
 * 核心概念（高中生版）：
 * ┌──────────────────────────────────────┐
 * │  Webhook = 外卖送达后的短信通知        │
 * │  ├─ 注册：告诉系统"把这个地址发给我"    │
 * │  ├─ 通知：任务完成 → POST 到所有地址   │
 * │  └─ 容错：发送失败不影响主任务         │
 * └──────────────────────────────────────┘
 *
 * 设计参考：
 * - Webhook 模式：Jeff Lindsay "Webhook: 轻量级事件通知" (2007)
 * - 重试策略：复用 cli/utils/retry.ts（指数退避 + 抖动）
 * - 事件驱动：HeartbeatManager 的 EventEmitter 模式
 */

import { EventEmitter } from 'events';
import { withRetry, RetryableError } from '../cli/utils/retry.js';
import type { WebhookConfig, WebhookPayload, WebhookNotifierConfig } from './types.js';

// ============================================================
//  事件接口
// ============================================================

export interface WebhookNotifierEvents {
  /** Webhook 通知发送成功 */
  delivered: (config: WebhookConfig, payload: WebhookPayload) => void;
  /** Webhook 通知发送失败（含重试后仍失败） */
  failed: (config: WebhookConfig, payload: WebhookPayload, error: Error) => void;
  /** 新的 Webhook 端点被注册 */
  registered: (config: WebhookConfig) => void;
}

// ============================================================
//  WebhookNotifier 类
// ============================================================

export class WebhookNotifier extends EventEmitter {
  private hooks: WebhookConfig[] = [];
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelay: number;

  constructor(config: WebhookNotifierConfig = {}) {
    super();
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelay = config.retryDelay ?? 1000;
  }

  // ---- 公共 API ----

  /**
   * 注册一个 Webhook 端点
   * @param url     HTTP(S) 回调地址
   * @param headers 自定义请求头
   * @param timeoutMs 自定义超时（会覆盖全局设置）
   */
  add(url: string, headers?: Record<string, string>, timeoutMs?: number): void {
    const config: WebhookConfig = {
      url,
      headers: headers ?? {},
      timeoutMs: timeoutMs ?? this.timeoutMs,
      registeredAt: new Date(),
    };
    this.hooks.push(config);
    this.emit('registered', config);
  }

  /**
   * 移除指定 URL 的 Webhook 端点
   * @returns 是否找到并移除
   */
  remove(url: string): boolean {
    const index = this.hooks.findIndex(h => h.url === url);
    if (index === -1) return false;
    this.hooks.splice(index, 1);
    return true;
  }

  /** 获取所有已注册的端点 */
  list(): WebhookConfig[] {
    return [...this.hooks];
  }

  /**
   * 向所有已注册端点发送通知
   *
   * 每个端点是独立并行的，一个失败不影响其他。
   * 发送失败会记录日志但不抛出异常。
   *
   * @param event   事件名称（如 'task.completed'）
   * @param data    数据负载
   */
  async notify(event: string, data: any): Promise<void> {
    const payload: WebhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    // 并行通知所有端点，互不影响
    const promises = this.hooks.map(hook =>
      this.notifyOne(hook, payload),
    );

    await Promise.allSettled(promises);
  }

  /**
   * 向单个端点发送通知
   *
   * 使用 withRetry 自动重试（复用 CLI retry 工具），
   * 4xx 错误标记为不可重试，5xx 和网络错误可重试。
   */
  private async notifyOne(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
    const abortController = new AbortController();

    try {
      await withRetry(
        async () => {
          abortController.signal.throwIfAborted();

          const response = await fetch(config.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'SmartAgent-Webhook/1.0',
              ...(config.headers ?? {}),
            },
            body: JSON.stringify(payload),
            signal: abortController.signal,
          });

          // 2xx：成功
          if (response.ok) {
            // 消费 body 以释放连接
            await response.text().catch(() => {});
            return;
          }

          // 4xx：客户端错误，不应该重试
          if (response.status >= 400 && response.status < 500) {
            throw new RetryableError(
              `Webhook 返回 ${response.status}: ${response.statusText}`,
              false, // 不可重试
            );
          }

          // 5xx：服务端错误，可以重试
          throw new RetryableError(
            `Webhook 返回 ${response.status}: ${response.statusText}`,
            true,
          );
        },
        {
          retries: this.maxRetries,
          delay: this.retryDelay,
          backoff: 'exponential',
          jitter: true,
          signal: abortController.signal,
        },
      );

      this.emit('delivered', config, payload);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('failed', config, payload, err);

      // 忽略失败，不影响主流程
      // （调用方如需要可监听 'failed' 事件）
    }
  }

  // ---- 批量操作 ----

  /** 移除所有端点 */
  clear(): void {
    this.hooks = [];
  }

  /** 获取端点数量 */
  get count(): number {
    return this.hooks.length;
  }

  // ---- 类型安全的 on/once ----

  on<E extends keyof WebhookNotifierEvents>(event: E, listener: WebhookNotifierEvents[E]): this {
    return super.on(event, listener);
  }

  once<E extends keyof WebhookNotifierEvents>(event: E, listener: WebhookNotifierEvents[E]): this {
    return super.once(event, listener);
  }

  off<E extends keyof WebhookNotifierEvents>(event: E, listener: WebhookNotifierEvents[E]): this {
    return super.off(event, listener);
  }
}
