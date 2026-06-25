/**
 * 性能分析模块
 *
 * 利用 Node.js 内置 perf_hooks 测量命令执行耗时，方便定位性能瓶颈。
 *
 * 使用方式：
 *   import { profile, Profiler } from './utils/profile.js';
 *
 *   // 基本用法 — 包裹单个操作
 *   const result = await profile('context-build', () => buildContext());
 *
 *   // 收集多次测量 — 最后输出汇总表
 *   const profiler = new Profiler();
 *   profiler.start('init');
 *   await init();
 *   profiler.end('init');
 *
 *   profiler.start('llm-call');
 *   await callLLM();
 *   profiler.end('llm-call');
 *
 *   profiler.report();
 */

import { performance, PerformanceObserver } from 'perf_hooks';
import pc from 'picocolors';

// ============================================================
//  Profiler — 收集多次测量并输出汇总
// ============================================================

/** 单次测量记录 */
interface MeasureRecord {
    name: string;
    start: number;
    end?: number;
    duration?: number;
}

/**
 * 性能分析器
 *
 * 收集多次 start/end 测量，最后通过 report() 输出汇总表格。
 *
 * @example
 *   const profiler = new Profiler();
 *   profiler.start('load-config');
 *   await loadConfig();
 *   profiler.end('load-config');
 *   profiler.report();
 */
export class Profiler {
    private records: MeasureRecord[] = [];
    private _enabled: boolean;

    constructor(enabled = true) {
        this._enabled = enabled;
    }

    /** 是否启用 */
    get enabled(): boolean {
        return this._enabled;
    }

    /** 开始测量 */
    start(name: string): void {
        if (!this._enabled) return;
        this.records.push({ name, start: performance.now() });
    }

    /** 结束测量 */
    end(name: string): void {
        if (!this._enabled) return;
        const record = this.records.find(
            (r) => r.name === name && r.duration === undefined,
        );
        if (!record) return;
        record.end = performance.now();
        record.duration = record.end - record.start;
    }

    /** 获取测量结果 */
    getRecords(): ReadonlyArray<Readonly<MeasureRecord>> {
        return this.records;
    }

    /**
     * 输出性能报告
     *
     * 格式：
     *   ╔══════════════════╤══════════╗
     *   ║ 阶段             │ 耗时     ║
     *   ╠══════════════════╪══════════╣
     *   ║ load-config      │ 42.31ms  ║
     *   ║ context-build    │ 5.12ms   ║
     *   ║ ─────────────────┼──────────╢
     *   ║ 合计             │ 47.43ms  ║
     *   ╚══════════════════╧══════════╝
     */
    report(): void {
        if (!this._enabled) return;

        const completed = this.records.filter((r) => r.duration !== undefined);
        if (completed.length === 0) {
            console.log('📊 [Profile] 暂无测量数据');
            return;
        }

        const nameWidth = Math.max(...completed.map((r) => r.name.length), 4);
        const durationWidth = 10;
        const totalWidth = nameWidth + durationWidth + 7;

        const hr = '─'.repeat(totalWidth);
        const header = `📊 性能报告`;
        console.log(`\n${header}`);
        console.log(`┌${hr}┐`);
        console.log(`│ ${'阶段'.padEnd(nameWidth)} │ ${'耗时'.padStart(durationWidth)} │`);

        let total = 0;
        for (const r of completed) {
            total += r.duration!;
            console.log(`├${hr}┤`);

            // 颜色：>100ms 红色，>20ms 黄色，否则绿色
            const durStr = r.duration! > 100
                ? pc.red(`${r.duration!.toFixed(2)}ms`)
                : r.duration! > 20
                    ? pc.yellow(`${r.duration!.toFixed(2)}ms`)
                    : pc.green(`${r.duration!.toFixed(2)}ms`);

            // 需要计算不含 ANSI 转义码的可视宽度
            const visualLen = `${r.duration!.toFixed(2)}ms`.length;
            console.log(`│ ${r.name.padEnd(nameWidth)} │ ${' '.repeat(durationWidth - visualLen)}${durStr} │`);
        }

        console.log(`├${hr}┤`);
        console.log(`│ ${'合计'.padEnd(nameWidth)} │ ${total.toFixed(2).padStart(durationWidth)}ms │`);
        console.log(`└${hr}┘\n`);
    }
}

// ============================================================
//  profile — 单次测量包装
// ============================================================

/**
 * 为异步函数添加耗时测量。
 *
 * 完成后自动打印 `⏱ [Profile] name: XX.XXms`。
 *
 * @param name  阶段名称（如 'llm-call'、'context-build'）
 * @param fn    要测量的异步函数
 * @param enabled 是否启用（默认 true）
 * @returns     fn 的成功返回值
 *
 * @example
 *   const response = await profile('llm-call', () => callLLM(prompt));
 *   // → ⏱ [Profile] llm-call: 1234.56ms
 */
export async function profile<T>(
    name: string,
    fn: () => Promise<T>,
    enabled = true,
): Promise<T> {
    if (!enabled) {
        return await fn();
    }

    const start = performance.now();

    try {
        const result = await fn();
        const duration = performance.now() - start;
        console.log(`\x1b[36m⏱ [Profile]\x1b[0m ${name}: ${duration.toFixed(2)}ms`);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        console.log(`\x1b[36m⏱ [Profile]\x1b[0m ${name}: ${duration.toFixed(2)}ms (失败)`);
        throw error;
    }
}
