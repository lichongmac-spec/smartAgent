/**
 * logger.ts - LLM 模块日志
 *
 * 基于统一日志核心 logger-core，使用 LLM 模块名前缀。
 * 与 CLI 模块共用 SMARTAGENT_LOG_LEVEL 环境变量控制级别。
 *
 * 使用方式：
 *   import { debug, info, warn, error } from './logger.js';
 *   info('连接成功');
 *   debug('请求详情', { body });
 */

import { createLogger, setLogLevel, getLogLevel, type LogLevel } from '../utils/logger-core.js';

/** LLM 模块专用 Logger 实例 */
const _llmLogger = createLogger('LLM');

export const llmLogger = {
  setLevel(level: LogLevel): void {
    setLogLevel(level);
  },

  getLevel(): LogLevel {
    return getLogLevel();
  },

  debug: _llmLogger.debug.bind(_llmLogger),
  info: _llmLogger.info.bind(_llmLogger),
  warn: _llmLogger.warn.bind(_llmLogger),
  error: _llmLogger.error.bind(_llmLogger),
};

/** 快捷函数 */
export const debug = llmLogger.debug.bind(llmLogger);
export const info = llmLogger.info.bind(llmLogger);
export const warn = llmLogger.warn.bind(llmLogger);
export const error = llmLogger.error.bind(llmLogger);
