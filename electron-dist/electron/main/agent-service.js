"use strict";
/**
 * AgentService — SmartAgent 核心能力封装
 *
 * 负责在主进程中管理 LoopEngine / DeepSeek LLM / ToolRegistry / ContextManager，
 * 作为 IPC 通道的统一入口。采用单例 + 懒加载模式。
 *
 * 与 LoopEngine 的集成：
 *   - ask()        → engine.run()       非流式
 *   - askStream()  → engine.runStream()  流式（AsyncGenerator）
 *   - interrupt()  → engine.interrupt()  中断
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
exports.AgentService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const loop_engine_js_1 = require("../../agent/core/loop-engine.js");
const openai_client_js_1 = require("../../agent/llm/openai-client.js");
const index_js_1 = require("../../agent/tools/builtin/index.js");
const context_manager_js_1 = require("../../agent/context/context-manager.js");
/** 读取 DeepSeek API Key：优先环境变量 → .smartagentrc.local.json */
function resolveApiKey() {
    // 1. 环境变量
    const envKey = process.env.DEEPSEEK_API_KEY || process.env.AGENT_API_KEY;
    if (envKey)
        return envKey;
    // 2. 本地配置文件
    try {
        const rcPath = path.resolve(process.cwd(), '.smartagentrc.local.json');
        if (fs.existsSync(rcPath)) {
            const raw = fs.readFileSync(rcPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.apiKey && typeof parsed.apiKey === 'string' && parsed.apiKey !== 'YOUR_DEEPSEEK_API_KEY') {
                return parsed.apiKey;
            }
        }
    }
    catch {
        // 配置读取失败，继续降级
    }
    return '';
}
class AgentService {
    static instance;
    engine = null;
    llm = null;
    contextManager;
    ready = false;
    initError = null;
    static getInstance() {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }
    constructor() {
        this.contextManager = new context_manager_js_1.ContextManager('你是一个智能桌面助手。请用中文回答用户的问题。');
    }
    /** 延迟初始化 LoopEngine（首次调用 ask/askStream 时触发） */
    async initEngine() {
        if (this.engine)
            return this.engine;
        try {
            const apiKey = resolveApiKey();
            if (!apiKey) {
                this.initError = '未找到 DeepSeek API Key。请设置环境变量 DEEPSEEK_API_KEY 或在 .smartagentrc.local.json 中配置 apiKey。';
                throw new Error(this.initError);
            }
            console.log('[AgentService] 初始化 DeepSeek 客户端...');
            this.llm = new openai_client_js_1.DeepSeekClient({
                apiKey,
                model: process.env.AGENT_MODEL || 'deepseek-v4-flash',
            });
            const tools = (0, index_js_1.createDefaultToolRegistry)(false);
            this.engine = new loop_engine_js_1.LoopEngine(this.llm, tools, {
                maxSteps: 10,
                verbose: false,
                contextManager: this.contextManager,
                injectHistory: true, // 交互模式：保留多轮对话历史
                maxContextTokens: 8000,
            });
            this.ready = true;
            console.log('[AgentService] LoopEngine 初始化完成 ✓');
            return this.engine;
        }
        catch (err) {
            this.initError = err instanceof Error ? err.message : String(err);
            console.error('[AgentService] 初始化失败:', this.initError);
            throw err;
        }
    }
    // ─── Agent 对话 ─────────────────────────────
    async ask(prompt, _sessionId) {
        const engine = await this.initEngine();
        const answer = await engine.run(prompt);
        return answer;
    }
    async askStream(prompt, _sessionId, onChunk) {
        const engine = await this.initEngine();
        // 使用 AsyncGenerator 流式输出
        for await (const chunk of engine.runStream(prompt)) {
            onChunk(chunk);
        }
    }
    interrupt() {
        if (this.engine) {
            this.engine.interrupt();
        }
    }
    // ─── 工具管理 ───────────────────────────────
    getTools() {
        return [
            { name: 'read_file', description: 'Read a file from disk', enabled: true },
            { name: 'write_file', description: 'Write content to a file', enabled: true },
            { name: 'search_web', description: 'Search the web', enabled: true },
            { name: 'calculator', description: 'Evaluate math expressions', enabled: true },
        ];
    }
    // ─── 记忆搜索 ───────────────────────────────
    searchMemory(_query, _limit) {
        // TODO: 接入 MemoryManager
        return [];
    }
    // ─── 配置管理 ───────────────────────────────
    getConfig(key) {
        const store = { provider: 'deepseek', model: process.env.AGENT_MODEL || 'deepseek-v4-flash' };
        return store[key] ?? null;
    }
    setConfig(_key, _value) {
        // TODO: 接入 ConfigManager
    }
    // ─── 调度任务 ───────────────────────────────
    getScheduledTasks() {
        return [];
    }
    addScheduledTask(name, cron, action) {
        const id = `task_${Date.now()}`;
        console.log(`[AgentService] Scheduled task added: ${name} (${cron}) → ${action}`);
        return id;
    }
    // ─── 健康状态 ───────────────────────────────
    getHealthStatus() {
        return {
            healthy: this.ready,
            checks: {
                engine: this.ready ? 'ready' : (this.initError || 'not initialized'),
            },
        };
    }
    // ─── 队列统计 ───────────────────────────────
    getQueueStats() {
        return { pending: 0, running: 0, completed: 0 };
    }
}
exports.AgentService = AgentService;
//# sourceMappingURL=agent-service.js.map