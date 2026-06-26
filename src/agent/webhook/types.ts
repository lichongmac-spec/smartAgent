/**
 * webhook/types.ts - Webhook 通知类型定义
 *
 * 理解：就像外卖 App 的推送通知配置 ——
 *   url = 通知接收地址
 *   headers = 额外的请求头（如认证 Token）
 */

/** Webhook 端点配置 */
export interface WebhookConfig {
  /** HTTP(S) 回调地址 */
  url: string;
  /** 自定义请求头（如 Authorization、X-API-Key 等） */
  headers?: Record<string, string>;
  /** 自定义超时时间（毫秒，默认 10_000） */
  timeoutMs?: number;
  /** 注册时间 */
  registeredAt: Date;
}

/** Webhook 事件负载 */
export interface WebhookPayload {
  /** 事件名称（如 'task.completed'、'job.exhausted'） */
  event: string;
  /** 数据负载 */
  data: any;
  /** 事件时间戳（ISO 8601） */
  timestamp: string;
}

/** Webhook 通知器配置 */
export interface WebhookNotifierConfig {
  /** 请求超时时间（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数（默认 2） */
  maxRetries?: number;
  /** 重试基础延迟（毫秒，默认 1000） */
  retryDelay?: number;
}
