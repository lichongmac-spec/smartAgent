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

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let _currentLevel: LogLevel =
  (process.env.SMARTAGENT_LOG_LEVEL as LogLevel) ?? 'info';

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[_currentLevel];
}

function formatMessage(prefix: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString().slice(11, 19); // HH:mm:ss
  console.error(`[${timestamp}] ${prefix}`, ...args);
}

/** Logger 实例（可设置模块名前缀） */
export function createLogger(moduleName?: string) {
  const prefix = moduleName ? `[${moduleName}]` : '[LOG]';

  return {
    setLevel(level: LogLevel): void {
      _currentLevel = level;
    },

    getLevel(): LogLevel {
      return _currentLevel;
    },

    debug(...args: unknown[]): void {
      if (shouldLog('debug')) {
        formatMessage(`🐛 ${prefix}`, ...args);
      }
    },

    info(...args: unknown[]): void {
      if (shouldLog('info')) {
        formatMessage(`ℹ️  ${prefix}`, ...args);
      }
    },

    warn(...args: unknown[]): void {
      if (shouldLog('warn')) {
        formatMessage(`⚠️  ${prefix}`, ...args);
      }
    },

    error(...args: unknown[]): void {
      if (shouldLog('error')) {
        formatMessage(`❌ ${prefix}`, ...args);
      }
    },
  };
}

/** 全局默认 Logger */
const _defaultLogger = createLogger('CORE');

/** 全局日志级别控制 */
export function setLogLevel(level: LogLevel): void {
  _currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return _currentLevel;
}

/** 快捷函数（使用默认 Logger） */
export const debug = _defaultLogger.debug.bind(_defaultLogger);
export const info = _defaultLogger.info.bind(_defaultLogger);
export const warn = _defaultLogger.warn.bind(_defaultLogger);
export const error = _defaultLogger.error.bind(_defaultLogger);
