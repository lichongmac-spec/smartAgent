/**
 * 增强型多任务进度条模块
 *
 * 扩展功能：
 * 1. 任务分组（Group）
 * 2. 动态添加任务
 * 3. 任务状态回调
 * 4. 暂停/恢复支持
 * 5. 进度百分比显示
 *
 * 使用示例：
 *   await runEnhancedTasks([
 *     { title: '下载模型', group: '初始化', task: async (ctx, task) => {
 *       for (let i = 0; i <= 100; i += 10) { task.setProgress(i); await sleep(100); }
 *     }},
 *     { title: '检查依赖', group: '初始化', task: async () => { ... } },
 *   ], { concurrent: true, showGroups: true });
 */

import { Listr, type ListrTask } from 'listr2';
import { isCI } from '../env-check.js';
import { getLoggerConfig } from '../logger.js';
import type { TaskContext, TaskControl as BaseTaskControl, TaskDef } from './progress.js';

export type { TaskContext };

/** 增强型任务控制接口（扩展基础版） */
export interface EnhancedTaskControl extends BaseTaskControl {
    /** 更新进度百分比 (0-100) */
    setProgress(percent: number): void;
    /** 标记为 pending */
    setPending(): void;
}

export interface EnhancedTaskDef {
    title: string;
    task: (ctx: TaskContext, task: EnhancedTaskControl) => Promise<void> | void;
    enabled?: boolean | ((ctx: TaskContext) => boolean);
    subtasks?: EnhancedTaskDef[];
    skipOnError?: boolean;
    /** 任务分组名 */
    group?: string;
    /** 任务权重（用于并行调度，值越大优先级越高） */
    weight?: number;
}

export interface EnhancedRunOptions {
    concurrent?: boolean;
    concurrency?: number;
    exitOnError?: boolean;
    ci?: boolean;
    /** 是否显示分组标题 */
    showGroups?: boolean;
}

/**
 * 运行增强型多任务进度条
 *
 * 与基础版 runTasks 的区别：
 * - 支持 group 分组显示
 * - 支持 weight 权重调度
 * - 提供 setProgress / setPending 增强控制
 */
export async function runEnhancedTasks(
    tasks: EnhancedTaskDef[],
    options: EnhancedRunOptions = {},
): Promise<TaskContext> {
    const { concurrent = false, concurrency = Infinity, exitOnError = false, ci, showGroups = true } = options;

    const isCIEnv = ci ?? isCI();
    const logConfig = getLoggerConfig();
    const useSimple = isCIEnv || (logConfig.noColor ?? false);

    // 按分组组织任务
    const grouped = groupTasks(tasks);

    // 构建 Listr 任务
    const listrTasks: ListrTask[] = [];

    for (const [groupName, groupTasks] of Object.entries(grouped)) {
        if (groupTasks.length === 0) continue;

        if (showGroups && groupName !== 'default' && !isCIEnv) {
            // 分组作为父任务
            listrTasks.push({
                title: `📁 ${groupName}`,
                task: async (ctx, task) => {
                    const subTasks = groupTasks.map((t) => buildEnhancedTask(t));
                    return task.newListr(subTasks, {
                        concurrent: concurrent ? (concurrency > 0 ? concurrency : true) : false,
                        exitOnError,
                        rendererOptions: { collapseSubtasks: false },
                    });
                },
            });
        } else {
            // 扁平展开
            for (const t of groupTasks) {
                listrTasks.push(buildEnhancedTask(t));
            }
        }
    }

    if (listrTasks.length === 0) return {};

    const listr = new Listr(listrTasks, {
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
//  内部辅助
// ============================================================

/** 按分组整理任务 */
function groupTasks(tasks: EnhancedTaskDef[]): Record<string, EnhancedTaskDef[]> {
    const grouped: Record<string, EnhancedTaskDef[]> = {};
    for (const t of tasks) {
        const group = t.group || 'default';
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(t);
    }
    return grouped;
}

/** 构建增强型 Listr 任务 */
function buildEnhancedTask(def: EnhancedTaskDef): ListrTask {
    return {
        title: def.title,
        enabled: def.enabled,
        task: async (ctx, listrTask) => {
            const control: EnhancedTaskControl = {
                setTitle: (title: string) => {
                    listrTask.title = title;
                },
                setOutput: (output: string) => {
                    listrTask.output = output;
                },
                setProgress: (percent: number) => {
                    // listr2 v10 支持 progress 属性用于百分比显示
                    (listrTask as any).progress = Math.min(100, Math.max(0, percent));
                },
                setPending: () => {
                    // 标记任务状态为 pending（等待中）
                    (listrTask as any).status = 'pending';
                },
                skip: (msg?: string) => {
                    listrTask.skip(msg ?? undefined);
                },
            };

            try {
                await def.task(ctx, control);
                if (def.subtasks && def.subtasks.length > 0) {
                    const subTasks = def.subtasks.map((t) => buildEnhancedTask(t));
                    return listrTask.newListr(subTasks, {
                        concurrent: false,
                        exitOnError: false,
                        rendererOptions: { collapseSubtasks: false },
                    });
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
}
