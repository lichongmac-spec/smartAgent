/**
 * heartbeat-manager.ts - 心跳与健康监控核心实现
 *
 * 理解：就像给 Agent 配了一个"私人医生"，定期体检、发现问题就报警。
 *
 * 核心概念：
 * - 健康检查项（check）：一个返回 true/false 的异步函数
 * - 心跳间隔：每隔 N 秒执行一次所有检查
 * - 连续失败阈值：连续 N 次失败才算"不健康"（避免误报）
 * - 连续恢复阈值：连续 N 次成功才算"已恢复"（避免抖动）
 */

import { EventEmitter } from 'events';
import type {
  HealthCheckFn,
  CheckResult,
  HealthStatus,
  HealthSnapshot,
  HeartbeatConfig,
  UnhealthyEvent,
  RecoveredEvent,
} from './types.js';
import {
  createLLMHealthCheck,
  createDiskHealthCheck,
  createMemoryHealthCheck,
} from './builtin-checks.js';

// ============================================================
//  默认配置
// ============================================================

const DEFAULT_CONFIG: Required<Omit<HeartbeatConfig, 'llmClient' | 'disabledChecks'>> = {
  intervalMs: 30000,
  failureThreshold: 3,
  recoveryThreshold: 2,
  autoRestart: false,
  initialCheck: true,
  minDiskBytes: 100 * 1024 * 1024, // 100 MB
  maxMemoryRatio: 0.9,              // 90%
};

// ============================================================
//  HeartbeatManager 类
// ============================================================

/**
 * 心跳与健康监控管理器
 *
 * 使用示例：
 * ```ts
 * const hb = new HeartbeatManager({ llmClient: myClient });
 * hb.registerCheck('custom-api', async () => { ... });
 * hb.on('unhealthy', (e) => console.error(e));
 * hb.start();
 * ```
 */
export class HeartbeatManager extends EventEmitter {
  // ---- 注册表 ----
  /** 自定义健康检查项（用户通过 registerCheck 注册） */
  private customChecks: Map<string, HealthCheckFn> = new Map();

  // ---- 定时器 ----
  /** 心跳定时器句柄 */
  private interval: NodeJS.Timeout | null = null;

  // ---- 状态 ----
  /** 当前整体健康状态 */
  private status: HealthStatus = 'healthy';
  /** 连续失败次数 */
  private consecutiveFailures: number = 0;
  /** 连续成功次数（恢复计数器） */
  private consecutiveSuccesses: number = 0;

  // ---- 配置 ----
  private config: Required<Omit<HeartbeatConfig, 'disabledChecks'>> & {
    disabledChecks: string[];
  };

  constructor(userConfig: HeartbeatConfig = {}) {
    super();

    this.config = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      llmClient: userConfig.llmClient ?? undefined as any,
      disabledChecks: userConfig.disabledChecks ?? [],
    };

    // 注册内置检查项
    this.registerBuiltinChecks();
  }

  // ============================================================
  //  公开 API — 注册
  // ============================================================

  /**
   * 注册一个自定义健康检查项
   *
   * @param name  检查项名称（如 'LLM 服务'），必须唯一
   * @param check 异步函数，返回 true 表示健康，false 表示不健康
   */
  registerCheck(name: string, check: HealthCheckFn): void {
    this.customChecks.set(name, check);
  }

  /**
   * 移除一个健康检查项
   *
   * @param name 检查项名称
   */
  unregisterCheck(name: string): boolean {
    return this.customChecks.delete(name);
  }

  // ============================================================
  //  公开 API — 控制
  // ============================================================

  /**
   * 启动心跳（开始定期检查）
   *
   * @param intervalMs 可选，覆盖配置中的检查间隔
   */
  start(intervalMs?: number): void {
    if (this.interval) return; // 避免重复启动

    const interval = intervalMs ?? this.config.intervalMs;

    // 首次立即检查（如果配置启用）
    if (this.config.initialCheck) {
      setImmediate(() => this.runChecks());
    }

    // 定期检查
    this.interval = setInterval(() => {
      this.runChecks();
    }, interval);

    // 防止定时器阻止进程退出
    if (this.interval && typeof this.interval.unref === 'function') {
      this.interval.unref();
    }
  }

  /**
   * 停止心跳
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * 获取当前健康状态
   */
  getStatus(): { status: HealthStatus; consecutiveFailures: number; consecutiveSuccesses: number } {
    return {
      status: this.status,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.interval !== null;
  }

  // ============================================================
  //  核心逻辑 — 执行一轮检查
  // ============================================================

  /**
   * 执行所有已注册的检查项
   *
   * 流程：
   * 1. 逐一执行所有检查
   * 2. 汇总结果
   * 3. 更新失败/成功计数器
   * 4. 根据阈值判断是否触发 unhealthy/recovered 事件
   */
  private async runChecks(): Promise<void> {
    const startTime = Date.now();

    // 1. 收集所有检查项
    const allChecks: Array<{ name: string; fn: HealthCheckFn }> = [];
    for (const [name, fn] of this.customChecks) {
      allChecks.push({ name, fn });
    }

    if (allChecks.length === 0) return; // 没有注册任何检查，跳过

    // 2. 逐一执行检查
    const results: CheckResult[] = [];
    for (const { name, fn } of allChecks) {
      const checkStart = Date.now();
      try {
        const passed = await fn();
        results.push({
          name,
          passed,
          error: passed ? undefined : '检查未通过',
          duration: Date.now() - checkStart,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          name,
          passed: false,
          error: errorMsg,
          duration: Date.now() - checkStart,
        });
      }
    }

    // 3. 判断全局是否全部通过
    const allPassed = results.every(r => r.passed);
    const failedChecks = results.filter(r => !r.passed);

    // 4. 更新计数器
    if (allPassed) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses++;
    } else {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
    }

    // 5. 生成快照
    const snapshot: HealthSnapshot = {
      status: this.status,
      results,
      checkedAt: new Date(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalDuration: Date.now() - startTime,
    };

    // 6. 状态转换判断
    this.evaluateStateTransition(snapshot, failedChecks);
  }

  // ============================================================
  //  状态转换
  // ============================================================

  /**
   * 根据计数器判断并执行状态转换
   */
  private evaluateStateTransition(
    snapshot: HealthSnapshot,
    failedChecks: CheckResult[]
  ): void {
    // --- unhealthy 判断 ---
    // 连续失败达到阈值 + 当前不是 unhealthy 状态
    if (
      this.consecutiveFailures >= this.config.failureThreshold &&
      this.status !== 'unhealthy'
    ) {
      this.status = 'unhealthy';
      const event: UnhealthyEvent = { snapshot: { ...snapshot, status: 'unhealthy' }, failedChecks };
      this.emit('unhealthy', event);

      // 自动重启（可选）
      if (this.config.autoRestart) {
        setTimeout(() => process.exit(1), 1000); // 延迟 1 秒，让事件监听器有机会处理
      }
    }
    // --- degraded 判断 ---
    // 有失败但未达 unhealthy 阈值
    else if (failedChecks.length > 0 && this.status === 'healthy') {
      this.status = 'degraded';
      this.emit('degraded', { snapshot: { ...snapshot, status: 'degraded' }, failedChecks });
    }
    // --- recovered 判断 ---
    // 连续成功达到阈值 + 之前是不健康状态
    else if (
      this.consecutiveSuccesses >= this.config.recoveryThreshold &&
      (this.status === 'unhealthy' || this.status === 'degraded')
    ) {
      const prevStatus = this.status;
      this.status = 'healthy';
      const event: RecoveredEvent = { snapshot: { ...snapshot, status: 'healthy' } };
      this.emit('recovered', event);

      // 如果从 degraded 恢复，单独通知
      if (prevStatus === 'degraded') {
        // recovered 事件已包含此信息，用 prevStatus 区分
      }
    }
  }

  // ============================================================
  //  内置检查项注册
  // ============================================================

  /**
   * 注册内置健康检查项（根据配置跳过 disabled 项）
   */
  private registerBuiltinChecks(): void {
    const disabled = new Set(this.config.disabledChecks ?? []);

    // 1. LLM 服务检查
    if (!disabled.has('llm') && this.config.llmClient) {
      this.registerCheck('llm-service', createLLMHealthCheck(this.config.llmClient));
    }

    // 2. 磁盘空间检查
    if (!disabled.has('disk')) {
      this.registerCheck('disk-space', createDiskHealthCheck(this.config.minDiskBytes));
    }

    // 3. 内存检查
    if (!disabled.has('memory')) {
      this.registerCheck('memory-usage', createMemoryHealthCheck(this.config.maxMemoryRatio));
    }
  }
}
