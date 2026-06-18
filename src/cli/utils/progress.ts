/**
 * 多任务并行进度条模块
 *
 * 基于 listr2，支持：
 * 1. 并行/串行多任务进度条
 * 2. 任务嵌套（子任务）
 * 3. CI 降级（SimpleRenderer）
 * 4. 测试模式（SilentRenderer）
 *
 * 使用方式：
 *   import { runTasks } from './utils/progress.js';
 *   await runTasks([
 *     { title: '下载模型', task: () => download() },
 *     { title: '检查环境', task: () => check() },
 *   ], { concurrent: true });
 */

import { Listr } from 'listr2';
import { isCI } from '../env-check.js';
import { getLoggerConfig } from '../logger.js';

// ============================================================
//  类型定义
// ============================================================

/** 单个任务定义 */
export interface TaskDef {
    /** 任务标题 */
    title: string;
    /** 异步任务函数。接收 ctx（共享上下文）和 task（控制实例） */
    task: (ctx: TaskContext, task: TaskControl) => Promise<void> | void;
    /** 是否启用，默认 true */
    enabled?: boolean | ((ctx: TaskContext) => boolean);
    /** 子任务 */
    subtasks?: TaskDef[];
    /** 失败时跳过（不中断其他任务），默认 false */
    skipOnError?: boolean;
}

/** 共享上下文（任务间传递数据） */
export type TaskContext = Record<string, unknown>;

/** 任务控制实例（listr2 task wrapper 的简化接口） */
export interface TaskControl {
    /** 更新任务标题 */
    setTitle(title: string): void;
    /** 更新任务输出（显示在进度条下方） */
    setOutput(output: string): void;
    /** 跳过当前任务 */
    skip(message?: string): void;
}

/** runTasks 选项 */
export interface RunTasksOptions {
    /** 是否并行执行，默认 false */
    concurrent?: boolean;
    /** 并行任务数上限（concurrent=true 时生效），默认无限制 */
    concurrency?: number;
    /** 失败时是否继续执行剩余任务，默认 false */
    exitOnError?: boolean;
    /** 是否在 CI 环境使用简化输出 */
    ci?: boolean;
}

// ============================================================
//  核心函数
// ============================================================

/**
 * 运行一组任务，显示进度条。
 *
 * @param tasks - 任务定义数组
 * @param options - 运行选项
 * @returns 任务共享上下文
 *
 * @example
 *   // 串行任务
 *   await runTasks([
 *     { title: '检查 Node 版本', task: () => checkNodeVersion() },
 *     { title: '加载配置', task: () => loadConfig() },
 *   ]);
 *
 * @example
 *   // 并行任务
 *   await runTasks([
 *     { title: '下载模型 A', task: () => download('A') },
 *     { title: '下载模型 B', task: () => download('B') },
 *   ], { concurrent: true });
 *
 * @example
 *   // 带子任务
 *   await runTasks([
 *     {
 *       title: '初始化环境',
 *       task: () => {},
 *       subtasks: [
 *         { title: '检查依赖', task: () => checkDeps() },
 *         { title: '创建目录', task: () => mkdirs() },
 *       ],
 *     },
 *   ]);
 */
export async function runTasks(
    tasks: TaskDef[],
    options: RunTasksOptions = {},
): Promise<TaskContext> {
    const {
        concurrent = false,
        concurrency = Infinity,
        exitOnError = false,
        ci,
    } = options;

    // 判断是否使用简化渲染器
    const isCIEnv = ci ?? isCI();
    const logConfig = getLoggerConfig();
    const useSimple = isCIEnv || (logConfig.noColor ?? false);

    // 构建 listr2 任务（过滤掉显式禁用的任务）
    const listrTasks = tasks
        .filter((def) => def.enabled !== false)
        .map((def) => buildListrTask(def));

    // 无有效任务时直接返回
    if (listrTasks.length === 0) {
        return {};
    }

    // 创建 Listr 实例
    // listr2 中 concurrent 可为 boolean 或 number（数值即并发上限）
    const listr = new Listr(listrTasks as any, {
        concurrent: concurrent ? (concurrency > 0 ? concurrency : true) : false,
        exitOnError,
        renderer: useSimple ? 'simple' : 'default',
        rendererOptions: {
            collapseSubtasks: false,
            clearOutput: false,
            showErrorMessage: true,
            formatOutput: 'wrap',
        },
    });

    return await listr.run();
}

// ============================================================
//  内部工具
// ============================================================

/** 将 TaskDef 转换为 listr2 任务对象 */
function buildListrTask(def: TaskDef) {
    const task: Record<string, unknown> = {
        title: def.title,
        task: async (ctx: TaskContext, listrTask: Record<string, unknown>) => {
            // 包装控制接口
            const control: TaskControl = {
                setTitle: (title: string) => { listrTask.title = title; },
                setOutput: (output: string) => { listrTask.output = output; },
                skip: (msg?: string) => { listrTask.skip = msg ?? true; },
            };

            try {
                await def.task(ctx, control);

                // 子任务：返回新的 Listr 实例
                if (def.subtasks && def.subtasks.length > 0) {
                    const subTasks = def.subtasks
                        .filter((sub) => sub.enabled !== false)
                        .map((sub) => buildListrTask(sub));

                    if (subTasks.length > 0) {
                        return new Listr(subTasks as any, {
                            concurrent: false,
                            exitOnError: false,
                            rendererOptions: { collapseSubtasks: false },
                        });
                    }
                }
            } catch (err) {
                if (def.skipOnError) {
                    control.skip(String(err));
                } else {
                    throw err;
                }
            }
        },
    };

    // 只在显式设置时添加 enabled
    if (def.enabled !== undefined) {
        task.enabled = def.enabled;
    }

    return task;
}
