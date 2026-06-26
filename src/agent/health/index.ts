/**
 * index.ts - 心跳与健康监控模块统一导出
 */

export { HeartbeatManager } from './heartbeat-manager.js';
export {
  createLLMHealthCheck,
  createDiskHealthCheck,
  createMemoryHealthCheck,
} from './builtin-checks.js';
export type {
  HealthCheckFn,
  CheckResult,
  HealthStatus,
  HealthSnapshot,
  HeartbeatConfig,
  UnhealthyEvent,
  RecoveredEvent,
} from './types.js';
