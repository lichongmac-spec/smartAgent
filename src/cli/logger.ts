/**
 * 日志与终端交互模块
 *
 * 职责：
 * 1. 分级日志输出（info / success / warn / error / debug）
 * 2. Spinner 进度指示器（基于 ora）
 * 3. 进度条（单行刷新，CI 环境自动降级为纯文本）
 * 4. 交互式选择 / 确认 / 输入（基于 @clack/prompts）
 * 5. CI 环境检测 & NO_COLOR 适配（自动关闭 emoji 和颜色）
 * 6. 性能计时器
 * 7. 结构化日志输出（JSON 格式）
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
//  颜色辅助函数（不污染 pc 对象）
// ============================================================

/**
 * 根据 _noColor 状态决定是否应用颜色
 * 用法：c('blue', 'Hello') 或 c.blue('Hello')
 */
function c<T extends keyof typeof pc>(
    color: T,
    text: string | number | null | undefined
): string {
    if (_noColor) return String(text ?? '');
    const fn = pc[color] as (s: string) => string;
    return fn(String(text ?? ''));
}

// 便捷颜色函数
const color = {
    dim: (s: string | number | null | undefined) => c('dim', s),
    blue: (s: string | number | null | undefined) => c('blue', s),
    green: (s: string | number | null | undefined) => c('green', s),
    yellow: (s: string | number | null | undefined) => c('yellow', s),
    red: (s: string | number | null | undefined) => c('red', s),
    gray: (s: string | number | null | undefined) => c('gray', s),
    cyan: (s: string | number | null | undefined) => c('cyan', s),
    magenta: (s: string | number | null | undefined) => c('magenta', s),
    bold: (s: string | number | null | undefined) => {
        if (_noColor) return String(s ?? '');
        return pc.bold(String(s ?? ''));
    },
};

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
    // 自动检测 NO_COLOR 环境变量
    _noColor = cfg.noColor ?? (!!process.env.NO_COLOR || _isCI);
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
        console.log(`${_noColor ? '' : 'ℹ '}${msg}`);
    },

    /** 成功 */
    success(msg: string): void {
        console.log(`${_noColor ? '' : '✅ '}${msg}`);
    },

    /** 警告 */
    warn(msg: string): void {
        console.log(`${_noColor ? '' : '⚠️ '}${msg}`);
    },

    /** 错误 */
    error(msg: string): void {
        console.error(`${_noColor ? '' : '❌ '}${msg}`);
    },

    /**
     * 调试信息
     * @param msg 消息内容，支持字符串、Error、对象
     * @param verbose 是否要求 verbose 模式；省略时自动读取全局 verbose 配置
     */
    debug(msg: string | Error | unknown, verbose?: boolean): void {
        if (!resolveVerbose(verbose)) return;

        let output: string;
        if (msg instanceof Error) {
            output = `${msg.message}\n${msg.stack || ''}`;
        } else if (typeof msg === 'object' && msg !== null) {
            try {
                output = JSON.stringify(msg, null, 2);
            } catch {
                output = String(msg);
            }
        } else {
            output = String(msg);
        }

        console.log(`${_noColor ? '' : '🔍 '}${output}`);
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

    /**
     * 性能计时器
     * 用法：
     *   const timer = logger.timer('API 调用');
     *   await fetchData();
     *   timer.end(); // 输出: ⏱️ API 调用: 1.23s
     */
    timer(label: string): { end: () => void } {
        const start = Date.now();
        const labelStr = label || '耗时';

        return {
            end: () => {
                const elapsed = ((Date.now() - start) / 1000).toFixed(2);
                if (_noColor) {
                    console.log(`⏱️ ${labelStr}: ${elapsed}s`);
                } else {
                    console.log(`${pc.gray('⏱️')} ${pc.cyan(labelStr)}: ${pc.yellow(elapsed)}s`);
                }
            },
        };
    },

    /**
     * 结构化日志（JSON 格式），适合脚本解析
     * 用法：
     *   logger.logJSON('task_complete', { duration: 123, success: true })
     *   // 输出: {"level":"info","event":"task_complete","duration":123,"success":true}
     */
    logJSON(event: string, data: Record<string, unknown> = {}): void {
        const entry = {
            level: 'info',
            timestamp: new Date().toISOString(),
            event,
            ...data,
        };
        console.log(JSON.stringify(entry));
    },

    /**
     * 结构化错误日志
     */
    logErrorJSON(event: string, error: Error, data: Record<string, unknown> = {}): void {
        const entry = {
            level: 'error',
            timestamp: new Date().toISOString(),
            event,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
            },
            ...data,
        };
        console.error(JSON.stringify(entry));
    },
};

// ============================================================
//  2. Spinner
// ============================================================

/** 创建模拟 Ora 对象（CI 降级用，每次新建避免并发状态混乱） */
function getMockSpinner(text: string): Ora {
    let currentText = text;
    let isSpinning = false;

    const mock = {
        _text: currentText,

        get text(): string {
            return this._text;
        },
        set text(value: string) {
            this._text = value;
        },

        get isSpinning(): boolean {
            return isSpinning;
        },

        prefixText: undefined as string | undefined,

        start(): Ora {
            isSpinning = true;
            console.log(`⏳ ${this._text}`);
            return this as unknown as Ora;
        },
        stop(): Ora {
            isSpinning = false;
            return this as unknown as Ora;
        },
        succeed(msg?: string): Ora {
            isSpinning = false;
            if (msg) console.log(`✅ ${msg}`);
            else console.log(`✅ ${this._text}`);
            return this as unknown as Ora;
        },
        fail(msg?: string): Ora {
            isSpinning = false;
            if (msg) console.error(`❌ ${msg}`);
            else console.error(`❌ ${this._text}`);
            return this as unknown as Ora;
        },
        warn(msg?: string): Ora {
            isSpinning = false;
            if (msg) console.log(`⚠️ ${msg}`);
            else console.log(`⚠️ ${this._text}`);
            return this as unknown as Ora;
        },
        info(msg?: string): Ora {
            if (msg) console.log(`ℹ️ ${msg}`);
            return this as unknown as Ora;
        },
        stopAndPersist(_options?: unknown): Ora {
            isSpinning = false;
            return this as unknown as Ora;
        },
        clear(): Ora {
            return this as unknown as Ora;
        },
        render(): Ora {
            return this as unknown as Ora;
        },
        frame(): string {
            return '';
        },

        color: 'cyan' as const,
        indent: 0,
        interval: 100,
        spinner: { interval: 100, frames: ['|'] },

        get suffixText(): string {
            return '';
        },
        set suffixText(_value: string) {},
    };

    return mock as unknown as Ora;
}

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
        const mockSpinner = getMockSpinner(text);

        try {
            const result = await fn(mockSpinner);
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
                console.log(`${_noColor ? '' : '❌ '}${msg}`);
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
    // @clack/prompts 运行时支持 hint 字段，但类型定义不包含
    const result: T | symbol = await clack.select({
        message,
        options: options.map(o => ({
            value: o.value,
            label: o.label,
            hint: o.hint,
        })) as any,
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
        options: options.map(o => ({
            value: o.value,
            label: o.label,
            hint: o.hint,
        })) as any,
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
 * 密码输入
 * 复用 Input，语义化命名
 */
export const Password = Input;

/**
 * 步骤指示器
 */
export function step(title: string, content?: string): void {
    clack.note(content ?? '', title);
}

/**
 * intro / outro 用于包裹一组交互步骤
 */
export function intro(title: string): void {
    clack.intro(title);
}

export function outro(message: string): void {
    clack.outro(message);
}

// ============================================================
//  5. 导出辅助
// ============================================================

export { type Ora } from 'ora';
