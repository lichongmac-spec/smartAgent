"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.error = exports.warn = exports.info = exports.debug = exports.llmLogger = void 0;
const logger_core_js_1 = require("../utils/logger-core.js");
/** LLM 模块专用 Logger 实例 */
const _llmLogger = (0, logger_core_js_1.createLogger)('LLM');
exports.llmLogger = {
    setLevel(level) {
        (0, logger_core_js_1.setLogLevel)(level);
    },
    getLevel() {
        return (0, logger_core_js_1.getLogLevel)();
    },
    debug: _llmLogger.debug.bind(_llmLogger),
    info: _llmLogger.info.bind(_llmLogger),
    warn: _llmLogger.warn.bind(_llmLogger),
    error: _llmLogger.error.bind(_llmLogger),
};
/** 快捷函数 */
exports.debug = exports.llmLogger.debug.bind(exports.llmLogger);
exports.info = exports.llmLogger.info.bind(exports.llmLogger);
exports.warn = exports.llmLogger.warn.bind(exports.llmLogger);
exports.error = exports.llmLogger.error.bind(exports.llmLogger);
//# sourceMappingURL=logger.js.map