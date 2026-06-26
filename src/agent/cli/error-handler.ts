/**
 * 错误处理模块
 * 
 * 职责：
 * 1. 定义分级错误类型（USER / NETWORK / SYSTEM / CONFIG）
 * 2. 统一错误输出格式（带颜色和图标）
 * 3. 针对常见错误提供优雅降级建议
 * 4. 捕获 SIGINT 信号（Ctrl+C）实现优雅退出
 * 5. 捕获未处理的异常和 Promise 拒绝
 * 6. 预留错误上报接口（可接入 Sentry 等）
 * 
 * 使用方式：
 *   throw new AgentError('API Key 无效', { type: 'USER', code: 1001 });
 *   handleError(error);  // 统一处理
 * 
 * 扩展方式：
 *   - 在 ErrorType 中添加新的错误类型
 *   - 在 ERROR_SUGGESTIONS 中添加新的修复建议
 *   - 实现 reportError 函数接入监控服务
 */

import pc from 'picocolors';

// ============================================================
//  1. 错误类型定义
// ============================================================
export type ErrorType = 'USER' | 'NETWORK' | 'SYSTEM' | 'CONFIG';
export type ErrorCode = number;

export interface AgentErrorOptions {
    /** 错误类型 */
    type?: ErrorType;
    /** 退出码 */
    code?: ErrorCode;
    /** 原始错误（错误链） */
    cause?: Error | unknown;
    /** 是否显示堆栈 */
    showStack?: boolean;
}

// ============================================================
//  2. 错误码映射
// ============================================================
export const ExitCode = {
    OK: 0,
    USER_ERROR: 1,      // 用户错误
    CONFIG_ERROR: 2,    // 配置错误  
    NETWORK_ERROR: 3,   // 网络错误
    SYSTEM_ERROR: 4,    // 系统错误
    UNKNOWN_ERROR: 99,  // 未知错误
} as const;

// ============================================================
//  3. 错误修复建议
// ============================================================
const ERROR_SUGGESTIONS: Record<string, string> = {
    'API Key': '💡 运行 "agent config set apiKey <你的Key>" 来配置',
    'apiKey': '💡 运行 "agent config set apiKey <你的Key>" 来配置',
    'authentication': '💡 请检查 API Key 是否正确，或重新生成',
    'timeout': '💡 请检查网络连接，或增加超时时间（--timeout）',
    'ECONNREFUSED': '💡 请检查服务是否正常运行，或确认网络连接',
    'ENOTFOUND': '💡 请检查 DNS 设置，或确认域名是否正确',
    'EACCES': '💡 请检查文件权限，或使用 sudo 运行（谨慎）',
    'ENOENT': '💡 文件不存在，请检查路径是否正确',
    'rate limit': '💡 请求过于频繁，请稍后再试',
    'quota': '💡 API 额度已用完，请检查账户余额',
};

// ============================================================
//  4. 自定义错误类
// ============================================================
export class AgentError extends Error {
    public readonly type: ErrorType;
    public readonly code: ErrorCode;
    public readonly cause?: Error | unknown;
    public readonly showStack: boolean;
    public readonly timestamp: Date;

    constructor(
        message: string,
        options: AgentErrorOptions = {}
    ) {
        super(message);
        this.name = 'AgentError';
        this.type = options.type || 'USER';
        this.code = options.code || ExitCode.USER_ERROR;
        this.cause = options.cause;
        this.showStack = options.showStack || false;
        this.timestamp = new Date();

        // 保留原始错误的堆栈
        if (options.cause instanceof Error) {
            this.stack = options.cause.stack;
        }

        // 设置正确的原型链
        Object.setPrototypeOf(this, AgentError.prototype);
    }

    /** 获取错误链中的所有消息 */
    getFullMessage(): string {
        let msg = this.message;
        let current = this.cause;
        while (current instanceof Error) {
            msg += `\n  └─ 原因: ${current.message}`;
            current = current.cause;
        }
        return msg;
    }

    /** 判断是否为特定类型的错误 */
    isType(type: ErrorType): boolean {
        return this.type === type;
    }
}

// ============================================================
//  5. 错误处理函数
// ============================================================

/** 获取针对错误信息的修复建议 */
function getSuggestion(message: string): string | undefined {
    for (const [key, suggestion] of Object.entries(ERROR_SUGGESTIONS)) {
        if (message.toLowerCase().includes(key.toLowerCase())) {
            return suggestion;
        }
    }
    return undefined;
}

/** 格式化错误输出 */
function formatError(error: AgentError): string {
    const parts: string[] = [];

    // 错误图标
    const iconMap: Record<ErrorType, string> = {
        USER: '❌',
        CONFIG: '⚠',
        NETWORK: '🌐',
        SYSTEM: '💥',
    };
    const icon = iconMap[error.type] || '❌';

    // 主消息
    parts.push(`${icon} ${error.message}`);

    // 错误码（调试用）
    if (process.env.DEBUG || error.showStack) {
        parts.push(`  代码: ${error.code}`);
        parts.push(`  类型: ${error.type}`);
    }

    // 修复建议
    const suggestion = getSuggestion(error.message);
    if (suggestion) {
        parts.push(`  ${suggestion}`);
    }

    // 原始错误（错误链）
    if (error.cause) {
        if (error.cause instanceof Error) {
            parts.push(`  └─ 原因: ${error.cause.message}`);
        } else {
            parts.push(`  └─ 原因: ${String(error.cause)}`);
        }
    }

    // 堆栈（调试模式）
    if (process.env.DEBUG || error.showStack) {
        parts.push(`\n  堆栈:\n${error.stack || '无堆栈信息'}`);
    }

    return parts.join('\n');
}

/**
 * 统一错误处理入口
 * 在 CLI 入口的 catch 块中调用
 */
export function handleError(error: unknown): never {
    // 如果是 AgentError，格式化输出
    if (error instanceof AgentError) {
        reportError(error); // 上报到监控服务（如已配置）
        console.log(pc.red(formatError(error)));
        process.exit(error.code);
    }

    // 如果是 Node.js 原生错误（如 ENOENT、ECONNREFUSED）
    if (error instanceof Error) {
        const agentError = new AgentError(error.message, {
            type: error.message.includes('network') || error.message.includes('ECONN')
                ? 'NETWORK'
                : error.message.includes('permission') || error.message.includes('EACCES')
                    ? 'SYSTEM'
                    : 'SYSTEM',
            code: ExitCode.SYSTEM_ERROR,
            cause: error,
            showStack: true,
        });
        reportError(agentError); // 上报到监控服务（如已配置）
        console.log(pc.red(formatError(agentError)));
        process.exit(agentError.code);
    }

    // 未知错误
    console.log(pc.red(`💥 未知错误: ${String(error)}`));
    if (process.env.DEBUG) {
        console.log(error);
    }
    process.exit(ExitCode.UNKNOWN_ERROR);
}

// ============================================================
//  6. 错误上报接口（预留）
// ============================================================

let errorReporter: ((error: AgentError) => void) | null = null;

/**
 * 设置错误上报函数（如 Sentry、LogRocket 等）
 */
export function setErrorReporter(reporter: (error: AgentError) => void): void {
    errorReporter = reporter;
}

/** 上报错误到已配置的服务 */
function reportError(error: AgentError): void {
    if (errorReporter) {
        try {
            errorReporter(error);
        } catch (reportError) {
            // 上报失败不影响主流程
            console.warn(pc.yellow('⚠ 错误上报失败: ' + String(reportError)));
        }
    }
}

// ============================================================
//  7. 优雅退出
// ============================================================

export interface GracefulShutdownOptions {
    /** 超时时间（毫秒），超时后强制退出 */
    timeout?: number;
    /** 清理函数列表 */
    cleanupFns?: Array<() => Promise<void> | void>;
    /** 是否显示清理进度 */
    verbose?: boolean;
}

/**
 * 设置优雅退出
 * 捕获 SIGINT、SIGTERM、uncaughtException、unhandledRejection
 */
export function setupGracefulShutdown(options: GracefulShutdownOptions = {}): void {
    const { timeout = 5000, cleanupFns = [], verbose = false } = options;

    const performCleanup = async (signal: string): Promise<void> => {
        if (verbose) {
            console.log(pc.gray(`\n👋 收到 ${signal} 信号，正在清理...`));
        }

        // 设置超时保护
        const timeoutId = setTimeout(() => {
            console.error(pc.red(`⚠ 清理超时 (${timeout}ms)，强制退出`));
            process.exit(1);
        }, timeout);

        try {
            // 执行所有清理函数
            for (const fn of cleanupFns) {
                try {
                    await fn();
                    if (verbose) {
                        console.log(pc.gray('  ✅ 清理步骤完成'));
                    }
                } catch (cleanupError) {
                    console.warn(pc.yellow(`  ⚠ 清理步骤失败: ${cleanupError}`));
                }
            }

            clearTimeout(timeoutId);

            if (verbose) {
                console.log(pc.green('✅ 清理完成，再见！👋'));
            }
            process.exit(0);
        } catch (error) {
            console.error(pc.red('💥 清理过程中发生错误:'), error);
            process.exit(1);
        }
    };

    // 用户中断 (Ctrl+C)
    process.on('SIGINT', () => {
        performCleanup('SIGINT');
    });

    // 终止信号 (kill)
    process.on('SIGTERM', () => {
        performCleanup('SIGTERM');
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
        console.error(pc.red('💥 未捕获的异常:'), error);
        const agentError = new AgentError(`未捕获的异常: ${error.message}`, {
            type: 'SYSTEM',
            code: ExitCode.SYSTEM_ERROR,
            cause: error,
            showStack: true,
        });
        reportError(agentError);
        performCleanup('uncaughtException');
    });

    // 未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason) => {
        console.error(pc.red('💥 未处理的 Promise 拒绝:'), reason);
        const message = reason instanceof Error ? reason.message : String(reason);
        const agentError = new AgentError(`未处理的 Promise 拒绝: ${message}`, {
            type: 'SYSTEM',
            code: ExitCode.SYSTEM_ERROR,
            cause: reason instanceof Error ? reason : undefined,
            showStack: true,
        });
        reportError(agentError);
        performCleanup('unhandledRejection');
    });

    // 进程退出前的最后清理
    process.on('beforeExit', (code) => {
        if (code !== 0) {
            console.warn(pc.yellow(`⚠ 进程将以代码 ${code} 退出`));
        }
    });
}

// ============================================================
//  8. 便捷工厂函数
// ============================================================

/**
 * 快速创建用户错误
 */
export function userError(message: string, options?: Omit<AgentErrorOptions, 'type'>): AgentError {
    return new AgentError(message, { ...options, type: 'USER', code: ExitCode.USER_ERROR });
}

/**
 * 快速创建网络错误
 */
export function networkError(message: string, options?: Omit<AgentErrorOptions, 'type'>): AgentError {
    return new AgentError(message, { ...options, type: 'NETWORK', code: ExitCode.NETWORK_ERROR });
}

/**
 * 快速创建系统错误
 */
export function systemError(message: string, options?: Omit<AgentErrorOptions, 'type'>): AgentError {
    return new AgentError(message, { ...options, type: 'SYSTEM', code: ExitCode.SYSTEM_ERROR });
}

/**
 * 快速创建配置错误
 */
export function configError(message: string, options?: Omit<AgentErrorOptions, 'type'>): AgentError {
    return new AgentError(message, { ...options, type: 'CONFIG', code: ExitCode.CONFIG_ERROR });
}

/**
 * 从原生错误转换为 AgentError
 */
export function fromError(error: Error, type: ErrorType = 'SYSTEM'): AgentError {
    return new AgentError(error.message, {
        type,
        code: ExitCode.SYSTEM_ERROR,
        cause: error,
        showStack: true,
    });
}

// ============================================================
//  9. 导出单例
// ============================================================

export const errorHandler = {
    handle: handleError,
    setup: setupGracefulShutdown,
    setReporter: setErrorReporter,
    create: {
        user: userError,
        network: networkError,
        system: systemError,
        config: configError,
        fromError,
    },
};

export default errorHandler;