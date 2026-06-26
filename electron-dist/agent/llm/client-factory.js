"use strict";
/**
 * client-factory.ts - 自动选择 AI 客户端
 *
 * 理解：这就像"餐厅推荐 App"——根据你的情况，自动推荐最合适的餐厅。
 *
 * 增强功能：
 *   1. 支持 SMARTAGENT_PROVIDER 环境变量显式指定 Provider
 *   2. 自动检测 Ollama 是否运行（通过 /api/tags 接口）
 *   3. 支持可选健康检查
 *   4. 同步版 createLLMClientSync（不检测，显式指定）
 *
 * 选择逻辑（异步版 detectProvider）：
 *   1. SMARTAGENT_PROVIDER 环境变量 → 直接使用
 *   2. DEEPSEEK_API_KEY → DeepSeek
 *   3. OPENAI_API_KEY → OpenAI
 *   4. Ollama 服务在线 → Ollama
 *   5. 以上都没有 → Mock
 *
 * 同步版 detectProvider（不联网）：
 *   1. SMARTAGENT_PROVIDER 环境变量 → 直接使用
 *   2. DEEPSEEK_API_KEY → DeepSeek
 *   3. OPENAI_API_KEY → OpenAI
 *   4. OLLAMA_HOST 或 OLLAMA_MODEL → Ollama
 *   5. 以上都没有 → Mock
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectProvider = detectProvider;
exports.detectProviderAsync = detectProviderAsync;
exports.createLLMClient = createLLMClient;
exports.createLLMClientSync = createLLMClientSync;
exports.createLLMClientFromConfig = createLLMClientFromConfig;
const ollama_client_js_1 = require("./ollama-client.js");
const openai_client_js_1 = require("./openai-client.js");
const mock_client_js_1 = require("./mock-client.js");
const logger_js_1 = require("./logger.js");
// 懒加载 configManager（避免模块初始化时的循环依赖）
let _configManager = null;
async function _getConfigManager() {
    if (!_configManager) {
        const mod = await Promise.resolve().then(() => __importStar(require('../cli/config-manager.js')));
        _configManager = mod.configManager;
    }
    return _configManager;
}
// ============================================================
//  同步检测（不联网）
// ============================================================
/**
 * 同步检测可用的 Provider（不联网，仅检测环境变量）
 *
 * @returns Provider 名称
 */
function detectProvider() {
    // 1. 环境变量显式指定
    const explicit = process.env.SMARTAGENT_PROVIDER;
    if (explicit && ['deepseek', 'openai', 'ollama', 'mock'].includes(explicit)) {
        (0, logger_js_1.info)(`📌 使用环境变量指定的 Provider: ${explicit}`);
        return explicit;
    }
    // 2. DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
        (0, logger_js_1.info)('🔵 检测到 DeepSeek API Key');
        return 'deepseek';
    }
    // 3. OpenAI
    if (process.env.OPENAI_API_KEY) {
        (0, logger_js_1.info)('🟢 检测到 OpenAI API Key');
        return 'openai';
    }
    // 4. Ollama（通过环境变量判断）
    if (process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL) {
        (0, logger_js_1.info)('🟣 检测到 Ollama 环境变量');
        return 'ollama';
    }
    // 5. 降级
    (0, logger_js_1.warn)('⚠️ 没有检测到可用的 AI 服务，降级到 Mock 模式');
    return 'mock';
}
// ============================================================
//  异步检测（联网检测 Ollama）
// ============================================================
/**
 * 异步检测可用的 Provider（会联网检测 Ollama 是否运行）
 *
 * 除了环境变量检测外，还会尝试连接 Ollama 服务
 */
async function detectProviderAsync() {
    // 1-3 步：和同步版一样的环境变量检测
    const explicit = process.env.SMARTAGENT_PROVIDER;
    if (explicit && ['deepseek', 'openai', 'ollama', 'mock'].includes(explicit)) {
        (0, logger_js_1.info)(`📌 使用环境变量指定的 Provider: ${explicit}`);
        return explicit;
    }
    if (process.env.DEEPSEEK_API_KEY) {
        (0, logger_js_1.info)('🔵 检测到 DeepSeek API Key');
        return 'deepseek';
    }
    if (process.env.OPENAI_API_KEY) {
        (0, logger_js_1.info)('🟢 检测到 OpenAI API Key');
        return 'openai';
    }
    // 4. 尝试连接 Ollama
    try {
        const baseUrl = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
        const response = await fetch(`${baseUrl}/api/tags`, {
            signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
            const data = (await response.json());
            const models = data.models ?? [];
            if (models.length > 0) {
                (0, logger_js_1.info)(`🟣 检测到 Ollama 服务，可用模型: ${models.map(m => m.name).join(', ')}`);
                return 'ollama';
            }
        }
    }
    catch {
        // Ollama 不可用，静默跳过，继续下一个检测
    }
    // 5. 降级
    (0, logger_js_1.warn)('⚠️ 没有检测到可用的 AI 服务，降级到 Mock 模式');
    return 'mock';
}
// ============================================================
//  创建客户端
// ============================================================
/**
 * 创建 LLM 客户端（自动选择最合适的 Provider）
 *
 * 理解：就像打开外卖 App，自动推荐附近评分最高的餐厅
 *
 * @param config - 可选配置
 * @returns 一个可用的 LLM 客户端实例
 *
 * @example
 *   // 自动选择（推荐，会联网检测 Ollama）
 *   const client = await createLLMClient();
 *
 *   // 自动选择（不联网，仅检测环境变量）
 *   const client = createLLMClientSync();
 *
 *   // 指定 Provider
 *   const client = createLLMClient({ provider: 'ollama' });
 */
async function createLLMClient(config = {}) {
    const provider = config.provider ?? await detectProviderAsync();
    const client = _buildClient(provider, config);
    (0, logger_js_1.info)(`✅ 创建 LLM 客户端: ${provider}`);
    // 健康检查
    if (config.healthCheck) {
        try {
            const healthy = await client.healthCheck();
            if (!healthy) {
                (0, logger_js_1.warn)(`⚠️ ${provider} 健康检查失败，但仍将尝试使用`);
            }
            else {
                (0, logger_js_1.debug)(`✅ ${provider} 健康检查通过`);
            }
        }
        catch (err) {
            (0, logger_js_1.warn)(`⚠️ ${provider} 健康检查异常: ${err}`);
        }
    }
    return client;
}
/**
 * 创建 LLM 客户端（同步版，不联网检测）
 *
 * 仅根据环境变量判断 Provider，不尝试连接 Ollama
 */
function createLLMClientSync(config = {}) {
    const provider = config.provider ?? detectProvider();
    (0, logger_js_1.info)(`✅ 创建 LLM 客户端(同步): ${provider}`);
    return _buildClient(provider, config);
}
// ============================================================
//  从配置管理器创建客户端（工程配置驱动）
// ============================================================
/**
 * 从配置管理器创建 LLM 客户端
 *
 * 配置优先级：overrides > 环境变量 > 本地配置 > 项目配置 > 全局配置 > 默认
 *
 * 理解：这是"生产级"的客户端创建方式，所有配置由 ConfigManager 统一管理。
 * API Key 不会出现在代码中，也不会提交到 Git。
 *
 * @param overrides - 可选覆盖配置（优先级最高，用于测试或临时切换）
 * @returns 一个可用的 LLM 客户端实例
 *
 * @example
 *   // 使用默认配置（从配置文件/环境变量读取）
 *   const client = await createLLMClientFromConfig();
 *
 *   // 临时覆盖 provider
 *   const client = await createLLMClientFromConfig({ provider: 'deepseek' });
 */
async function createLLMClientFromConfig(overrides) {
    const configMgr = await _getConfigManager();
    const cfg = configMgr.get();
    const provider = (overrides?.provider ?? cfg.provider ?? 'ollama');
    // 构建最终配置：配置管理器值 + overrides 覆盖
    const apiKey = overrides?.apiKey ?? cfg.apiKey ?? undefined;
    const model = overrides?.model ?? cfg.model ?? undefined;
    const baseUrl = overrides?.baseUrl ?? cfg.baseUrl ?? undefined;
    // 针对不同 Provider 选择对应的模型/主机
    let finalModel = model;
    let finalHost;
    switch (provider) {
        case 'ollama':
            finalModel = finalModel ?? cfg.ollamaModel ?? 'qwen2.5:7b';
            finalHost = cfg.ollamaHost ?? 'http://localhost:11434';
            break;
        case 'deepseek':
            finalModel = finalModel ?? 'deepseek-v4-flash';
            break;
        case 'openai':
            finalModel = finalModel ?? 'gpt-4o-mini';
            break;
        case 'mock':
            finalModel = finalModel ?? 'mock';
            break;
    }
    // API Key 验证
    if ((provider === 'deepseek' || provider === 'openai') && !apiKey) {
        throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} 需要 API Key，但未在配置中找到。\n` +
            '请通过以下方式之一配置:\n' +
            `  1. 环境变量: AGENT_API_KEY=sk-xxx\n` +
            '  2. 本地配置: 在 .smartagentrc.local.json 中设置 "apiKey"\n' +
            '  3. CLI 命令: pnpm cli -- config set apiKey sk-xxx');
    }
    const client = _buildClient(provider, {
        apiKey,
        model: finalModel,
        baseUrl: baseUrl ?? undefined,
        host: finalHost,
        healthCheck: overrides?.healthCheck,
        // 从 ConfigManager 创建时，不回退到原始环境变量（避免绕过加密）
        skipEnvFallback: true,
    });
    (0, logger_js_1.info)(`✅ 从配置创建 LLM 客户端: ${provider} (${finalModel})`);
    // 可选健康检查
    if (overrides?.healthCheck) {
        try {
            const healthy = await client.healthCheck();
            if (!healthy) {
                (0, logger_js_1.warn)(`⚠️ ${provider} 健康检查失败，但仍将尝试使用`);
            }
            else {
                (0, logger_js_1.debug)(`✅ ${provider} 健康检查通过`);
            }
        }
        catch (err) {
            (0, logger_js_1.warn)(`⚠️ ${provider} 健康检查异常: ${err}`);
        }
    }
    return client;
}
// ============================================================
//  内部实现
// ============================================================
/**
 * 根据 Provider 构造对应的客户端实例
 */
function _buildClient(provider, config) {
    const skipEnv = config.skipEnvFallback === true;
    switch (provider) {
        case 'deepseek': {
            const apiKey = config.apiKey ?? (skipEnv ? '' : process.env.DEEPSEEK_API_KEY) ?? '';
            if (!apiKey) {
                throw new Error('DeepSeek 需要 API Key，请设置 DEEPSEEK_API_KEY 环境变量');
            }
            return new openai_client_js_1.DeepSeekClient({
                apiKey,
                model: config.model ?? 'deepseek-v4-flash',
            });
        }
        case 'openai': {
            const apiKey = config.apiKey ?? (skipEnv ? '' : process.env.OPENAI_API_KEY) ?? '';
            if (!apiKey) {
                throw new Error('OpenAI 需要 API Key，请设置 OPENAI_API_KEY 环境变量');
            }
            return new openai_client_js_1.OpenAIClient({
                apiKey,
                model: config.model ?? 'gpt-4o-mini',
                baseUrl: config.baseUrl,
            });
        }
        case 'ollama':
            return new ollama_client_js_1.OllamaClient({
                model: config.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
                host: config.host ?? process.env.OLLAMA_HOST,
            });
        case 'mock':
        default:
            return new mock_client_js_1.MockLLMClient();
    }
}
//# sourceMappingURL=client-factory.js.map