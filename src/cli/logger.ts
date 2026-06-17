/**
 * 日志与终端交互模块
 *
 * 职责：
 * 1. 分级日志输出（info / success / warn / error / debug）
 * 2. Spinner 进度指示器（基于 ora）
 * 3. 进度条（单行刷新，CI 环境自动降级为纯文本）
 * 4. 交互式选择 / 确认 / 输入（基于 @clack/prompts）
 * 5. CI 环境检测 & NO_COLOR 适配（自动关闭 emoji 和颜色）
 *
 * 使用方式：
 *   import { logger, withSpinner, progressBar, Select, Confirm, Input } from './logger.js';
 *
 *   logger.info('开始处理');
 *   await withSpinner('AI 思考中', () => someAsyncTask());
 *   const choice = await Select('选择操作', [{ value: 'a', label: 'A' }]);
 */

import pc from 'picocolors';
import ora, { type Ora } from 'ora';
import * as clack from '@clack/prompts';

// ============================================================
//  内部全局状态
// ============================================================

/** 是否在 CI 环境（通过调用方注入，避免循环依赖） */
let _isCI = false;

/** 是否启用 verbose 输出 */
let _verbose = false;

/** 是否禁用颜色（NO_COLOR 或 CI） */
let _noColor = false;

/** 当前活跃的 spinner 实例（用于 queryActiveSpinner） */
let _activeSpinner: Ora | null = null;

// ============================================================
//  配置注入（由入口 index.ts 调用）
// ============================================================

export interface LoggerConfig {
    /** 是否为 CI 环境 */
    isCI?: boolean;
    /** 是否输出 debug 级别日志 */
    verbose?: boolean;
    /** 是否禁用所有颜色 */
    noColor?: boolean;
}

export function configureLogger(cfg: LoggerConfig = {}): void {
    _isCI = cfg.isCI ?? false;
    _verbose = cfg.verbose ?? false;
    _noColor = cfg.noColor ?? (!!process.env.NO_COLOR || _isCI);

    // 开启 noColor 时同步关闭 picocolors（picocolors 本身已支持 NO_COLOR，
    // 但显式控制更可靠）
    if (_noColor) {
        const noop = (s: string | number | null | undefined) => String(s ?? '');
        // picocolors 不支持直接索引赋值，用 any 桥接
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (pc as any).dim = noop;
        (pc as any).blue = noop;
        (pc as any).green = noop;
        (pc as any).yellow = noop;
        (pc as any).red = noop;
        (pc as any).gray = noop;
        (pc as any).cyan = noop;
        (pc as any).magenta = noop;
        (pc as any).bold = noop;
        /* eslint-enable @typescript-eslint/no-explicit-any */
    }
}

/** 获取当前配置快照 */
export function getLoggerConfig(): Readonly<LoggerConfig> {
    return { isCI: _isCI, verbose: _verbose, noColor: _noColor };
}

// ============================================================
//  1. 分级日志
// ============================================================

function resolveVerbose(explicit?: boolean): boolean {
    if (explicit !== undefined) return explicit;
    return _verbose;
}

export const logger = {
    /** 普通信息 */
    info(msg: string): void {
        console.log(`${_noColor ? '' : pc.blue('ℹ') + ' '}${msg}`);
    },

    /** 成功 */
    success(msg: string): void {
        console.log(`${_noColor ? '' : pc.green('✅') + ' '}${msg}`);
    },

    /** 警告 */
    warn(msg: string): void {
        console.log(`${_noColor ? '' : pc.yellow('⚠') + ' '}${msg}`);
    },

    /** 错误 */
    error(msg: string): void {
        console.error(`${_noColor ? '' : pc.red('❌') + ' '}${msg}`);
    },

    /**
     * 调试信息
     * @param msg 消息内容
     * @param verbose 是否要求 verbose 模式；省略时自动读取全局 verbose 配置
     */
    debug(msg: string, verbose?: boolean): void {
        if (resolveVerbose(verbose)) {
            console.log(`${_noColor ? '' : pc.gray('🔍') + ' '}${msg}`);
        }
    },

    /** 纯输出（无前缀，无换行），用于拼接 */
    write(msg: string): void {
        process.stdout.write(msg);
    },

    /** 纯错误输出（无前缀） */
    writeError(msg: string): void {
        process.stderr.write(msg);
    },

    /** 输出空行 */
    blank(): void {
        console.log();
    },
};

// ============================================================
//  2. Spinner
// ============================================================

/**
 * 带 Spinner 的异步任务包装
 *
 * 用法：
 *   const result = await withSpinner('加载中…', async (spinner) => {
 *     const data = await fetchData();
 *     spinner.text = '解析…';
 *     return process(data);
 *   });
 *
 * @param text   Spinner 文案
 * @param fn     异步任务，可接收 spinner 实例用于动态更新文案
 */
export async function withSpinner<T>(
    text: string,
    fn: (spinner: Ora) => Promise<T>,
): Promise<T> {
    // CI / noColor 环境：降级为纯文本进度
    if (_isCI || _noColor) {
        console.log(`⏳ ${text}`);
        try {
            const result = await fn({ text, start: () => {}, stop: () => {}, fail: () => {} } as Ora);
            console.log(`✅ ${text}`);
            return result;
        } catch (error) {
            console.error(`❌ ${text}`);
            throw error;
        }
    }

    const spinner = ora(pc.blue(text));
    _activeSpinner = spinner;
    spinner.start();

    try {
        const result = await fn(spinner);
        spinner.succeed(pc.green(`${text}`));
        return result;
    } catch (error) {
        spinner.fail(pc.red(`${text}`));
        throw error;
    } finally {
        _activeSpinner = null;
    }
}

/** 获取当前活跃的 spinner（用于外部扩展，如流式输出时更新 spinner 文案） */
export function activeSpinner(): Ora | null {
    return _activeSpinner;
}

// ============================================================
//  3. 进度条
// ============================================================

export interface ProgressBarOptions {
    /** 标签文本 */
    label?: string;
    /** 进度条宽度（字符数），默认 30 */
    width?: number;
    /** 自定义已填充字符，默认 "█" */
    filledChar?: string;
    /** 自定义未填充字符，默认 "░" */
    emptyChar?: string;
    /** 右侧信息模板，{percent} {current} {total} 会被替换 */
    extra?: string;
}

/**
 * 创建单行进度条
 *
 * 用法：
 *   const bar = createProgressBar({ label: '下载模型', total: 100 });
 *   for (let i = 0; i <= 100; i++) {
 *     bar.update(i);
 *     await sleep(50);
 *   }
 *   bar.done();
 */
export function createProgressBar(total: number, options: ProgressBarOptions = {}) {
    const {
        label = '处理中',
        width = 30,
        filledChar = '█',
        emptyChar = '░',
        extra = '{percent}% ({current}/{total})',
    } = options;

    const safeTotal = Math.max(total, 1);

    return {
        /**
         * 更新进度
         * @param current 当前进度值（0 ~ total）
         * @param customLabel 可选覆盖标签
         */
        update(current: number, customLabel?: string): void {
            const clamped = Math.max(0, Math.min(current, safeTotal));
            const percent = Math.round((clamped / safeTotal) * 100);
            const filled = Math.round((width * clamped) / safeTotal);
            const empty = Math.max(width - filled, 0);

            const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);
            const info = extra
                .replace('{percent}', String(percent))
                .replace('{current}', String(clamped))
                .replace('{total}', String(safeTotal));

            process.stdout.cursorTo?.(0);
            process.stdout.clearLine?.(0);
            process.stdout.write(
                `${customLabel ?? label} [${bar}] ${info}`
            );
        },

        /** 完成，换行 */
        done(): void {
            process.stdout.write('\n');
        },

        /** 失败，清除进度并换行 */
        fail(msg?: string): void {
            process.stdout.cursorTo?.(0);
            process.stdout.clearLine?.(0);
            if (msg) {
                console.log(`${_noColor ? '' : pc.red('❌')} ${msg}`);
            } else {
                process.stdout.write('\n');
            }
        },
    };
}

/**
 * 简单版：单次调用推进一帧进度（适合简单的一次性场景）
 *
 * 用法：
 *   for (let i = 0; i <= 10; i++) {
 *     progressTick(i, 10, '加载');
 *     await sleep(100);
 *   }
 *   clearProgressLine();
 */
export function progressTick(
    current: number,
    total: number,
    label = '处理中',
): void {
    const safeTotal = Math.max(total, 1);
    const clamped = Math.max(0, Math.min(current, safeTotal));
    const percent = Math.round((clamped / safeTotal) * 100);
    const barWidth = 20;
    const filled = Math.round((barWidth * clamped) / safeTotal);
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    process.stdout.cursorTo?.(0);
    process.stdout.clearLine?.(0);
    process.stdout.write(`${label} [${bar}] ${percent}% (${clamped}/${safeTotal})`);
}

/** 清除当前行（在进度条完成后调用） */
export function clearProgressLine(): void {
    process.stdout.cursorTo?.(0);
    process.stdout.clearLine?.(0);
}

// ============================================================
//  4. 交互式提示（基于 @clack/prompts）
// ============================================================

/**
 * 交互式单选
 *
 * 用户取消时打印消息并退出进程（exit 0）
 */
export async function Select<T extends string>(
    message: string,
    options: { value: T; label: string; hint?: string }[],
): Promise<T> {
    const result: T | symbol = await clack.select({
        message,
        // @clack/prompts Option<Value> 不含 hint，用 any 传递（运行时可用）
        options: options.map(o => ({ value: o.value, label: o.label, hint: o.hint })) as any,
    });

    if (clack.isCancel(result)) {
        console.log('👋 已取消');
        process.exit(0);
    }
    return result as T;
}

/**
 * 交互式多选
 *
 * 返回选中的 value 列表；取消返回空数组（不退出）
 */
export async function MultiSelect<T extends string>(
    message: string,
    options: { value: T; label: string; hint?: string }[],
    required = false,
): Promise<T[]> {
    const result: T[] | symbol = await clack.multiselect({
        message,
        required,
        options: options.map(o => ({ value: o.value, label: o.label, hint: o.hint })) as any,
    });

    if (clack.isCancel(result)) {
        console.log('👋 已取消');
        process.exit(0);
    }
    return result as T[];
}

/**
 * 确认对话框
 *
 * @returns true=确认，false=取消/拒绝
 */
export async function Confirm(message: string): Promise<boolean> {
    const result = await clack.confirm({ message });

    if (clack.isCancel(result)) {
        return false;
    }
    return result as boolean;
}

/**
 * 文本输入
 *
 * @returns 用户输入的字符串；取消返回空字符串
 */
export async function Input(
    message: string,
    options: {
        placeholder?: string;
        defaultValue?: string;
        validate?: (value: string | undefined) => string | Error | undefined;
    } = {},
): Promise<string> {
    const result = await clack.text({
        message,
        placeholder: options.placeholder,
        defaultValue: options.defaultValue,
        validate: options.validate,
    });

    if (clack.isCancel(result)) {
        console.log('👋 已取消');
        process.exit(0);
    }
    return (result as string).trim();
}

/**
 * 密码输入（回显为 * 或完全隐藏）
 * 注意：@clack/prompts 在 text() 中已对密码文件做了处理，
 * 此处直接复用 Input 但在 label 中标注
 */
export const Password = Input;

/**
 * 步骤指示器：包装 @clack 的 spinner-like note 输出
 */
export function step(title: string, content?: string): void {
    clack.note(content ?? '', title);
}

/**
 * intro / outro 用于包裹一组交互步骤
 */
export function intro(title: string): void {
    clack.intro(pc.bold(title));
}

export function outro(message: string): void {
    clack.outro(pc.green(message));
}

// ============================================================
//  5. 导出辅助
// ============================================================

export { type Ora } from 'ora';
