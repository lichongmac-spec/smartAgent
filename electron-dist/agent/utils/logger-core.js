"use strict";
/**
 * logger-core.ts - 统一日志核心
 *
 * 提供项目通用的分级日志接口，被 CLI 和 LLM 模块共用。
 *
 * 环境变量：
 *   SMARTAGENT_LOG_LEVEL=debug|info|warn|error（默认 info）
 *
 * 使用方式：
 *   import { debug, info, warn, error, setLogLevel, getLogLevel } from '../utils/logger-core.js';
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.error = exports.warn = exports.info = exports.debug = void 0;
exports.createLogger = createLogger;
exports.setLogLevel = setLogLevel;
exports.getLogLevel = getLogLevel;
let _currentLevel = process.env.SMARTAGENT_LOG_LEVEL ?? 'info';
const LEVEL_VALUES = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function shouldLog(level) {
    return LEVEL_VALUES[level] >= LEVEL_VALUES[_currentLevel];
}
function formatMessage(prefix, ...args) {
    const timestamp = new Date().toISOString().slice(11, 19); // HH:mm:ss
    console.error(`[${timestamp}] ${prefix}`, ...args);
}
/** Logger 实例（可设置模块名前缀） */
function createLogger(moduleName) {
    const prefix = moduleName ? `[${moduleName}]` : '[LOG]';
    return {
        setLevel(level) {
            _currentLevel = level;
        },
        getLevel() {
            return _currentLevel;
        },
        debug(...args) {
            if (shouldLog('debug')) {
                formatMessage(`🐛 ${prefix}`, ...args);
            }
        },
        info(...args) {
            if (shouldLog('info')) {
                formatMessage(`ℹ️  ${prefix}`, ...args);
            }
        },
        warn(...args) {
            if (shouldLog('warn')) {
                formatMessage(`⚠️  ${prefix}`, ...args);
            }
        },
        error(...args) {
            if (shouldLog('error')) {
                formatMessage(`❌ ${prefix}`, ...args);
            }
        },
    };
}
/** 全局默认 Logger */
const _defaultLogger = createLogger('CORE');
/** 全局日志级别控制 */
function setLogLevel(level) {
    _currentLevel = level;
}
function getLogLevel() {
    return _currentLevel;
}
/** 快捷函数（使用默认 Logger） */
exports.debug = _defaultLogger.debug.bind(_defaultLogger);
exports.info = _defaultLogger.info.bind(_defaultLogger);
exports.warn = _defaultLogger.warn.bind(_defaultLogger);
exports.error = _defaultLogger.error.bind(_defaultLogger);
//# sourceMappingURL=logger-core.js.map