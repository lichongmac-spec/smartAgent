/**
 * 详细输出模式 (Verbose/Debug Mode)
 *
 * 职责：
 * 1. 统一管理 verbose 开关状态
 * 2. 提供便捷的 debug(...) 日志函数
 * 3. 与 logger 模块联动，调用 setVerbose 时同步配置 logger
 *
 * 使用方式：
 *   import { setVerbose, debug, isVerbose } from './utils/debug.js';
 *
 *   // 开启 verbose（通常在 CLI 入口或在命令 action 中）
 *   setVerbose(true);
 *
 *   // 输出调试信息
 *   debug('开始处理请求', { model: 'deepseek-chat', prompt: 'hello' });
 *
 *   // 检查当前状态
 *   if (isVerbose()) { ... }
 */

import { configureLogger, logger } from '../logger.js';

// ============================================================
//  内部状态
// ============================================================

let _verbose = false;

// ============================================================
//  公开 API
// ============================================================

/**
 * 设置 verbose 模式
 *
 * 会同步配置：
 * - 本地状态（debug 函数生效）
 * - Logger 模块（logger.debug 输出可见）
 *
 * @param verbose true 开启详细输出，false 关闭
 */
export function setVerbose(verbose: boolean): void {
    _verbose = verbose;
    configureLogger({ verbose });
}

/**
 * 查询当前 verbose 状态
 */
export function isVerbose(): boolean {
    return _verbose;
}

/**
 * 输出调试信息
 *
 * 仅在 verbose 模式下输出。支持多种参数类型，会自动格式化：
 * - 多个参数用空格连接
 * - Error 对象显示 message + stack
 * - 普通对象 JSON 序列化
 *
 * 用法：
 *   debug('用户输入:', prompt);
 *   debug('LLM 调用参数', { model, maxTokens });
 *   debug('请求失败', error);
 */
export function debug(...args: unknown[]): void {
    if (!_verbose) return;

    if (args.length === 0) return;

    // 单个 Error / object 参数 → 直接交给 logger.debug 处理
    if (args.length === 1) {
        logger.debug(args[0]);
        return;
    }

    // 多个参数 → 格式化后传给 logger.debug
    const formatted = args
        .map((arg) => {
            if (arg instanceof Error) {
                return `${arg.message}\n${arg.stack || ''}`;
            }
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
        .join(' ');

    logger.debug(formatted);
}
