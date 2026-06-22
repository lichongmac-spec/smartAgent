/**
 * logger.ts - LLM 模块专用日志
 *
 * 支持环境变量控制日志级别：
 *   SMARTAGENT_LOG_LEVEL=debug  （显示所有日志）
 *   SMARTAGENT_LOG_LEVEL=info   （显示信息，默认）
 *   SMARTAGENT_LOG_LEVEL=warn   （只显示警告和错误）
 *   SMARTAGENT_LOG_LEVEL=error  （只显示错误）
 *
 * 使用方式：
 *   import { llmLogger, debug, info, warn, error } from './logger.js';
 *   info('连接成功');
 *   debug('请求详情', { body });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel =
  (process.env.SMARTAGENT_LOG_LEVEL as LogLevel) ?? 'info';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(prefix: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString().slice(11, 19); // HH:mm:ss
  console.error(`[${timestamp}] ${prefix}`, ...args);
}

export const llmLogger = {
  /** 动态切换日志级别 */
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  /** 获取当前日志级别 */
  getLevel(): LogLevel {
    return currentLevel;
  },

  debug(...args: unknown[]): void {
    if (shouldLog('debug')) {
      formatMessage('🔍 [LLM-DEBUG]', ...args);
    }
  },

  info(...args: unknown[]): void {
    if (shouldLog('info')) {
      formatMessage('ℹ️  [LLM-INFO]', ...args);
    }
  },

  warn(...args: unknown[]): void {
    if (shouldLog('warn')) {
      formatMessage('⚠️  [LLM-WARN]', ...args);
    }
  },

  error(...args: unknown[]): void {
    if (shouldLog('error')) {
      formatMessage('❌ [LLM-ERROR]', ...args);
    }
  },
};

/** 快捷函数 */
export const debug = llmLogger.debug.bind(llmLogger);
export const info = llmLogger.info.bind(llmLogger);
export const warn = llmLogger.warn.bind(llmLogger);
export const error = llmLogger.error.bind(llmLogger);
