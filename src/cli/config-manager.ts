/**
 * 配置管理模块
 * 
 * 职责：
 * 1. 定义配置 Schema（使用 Zod 校验）
 * 2. 加载分层配置（环境变量 > 项目配置 > 全局配置 > 默认）
 * 3. 提供 get/set 接口
 * 4. 支持配置热更新（reload）
 * 
 * 扩展方式：
 * - 在 ConfigSchema 中添加新字段
 * - 在 loadConfig() 中添加新的配置来源
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

// ============ 1. 定义配置 Schema ============
const ConfigSchema = z.object({
    apiKey: z.string().optional(),
    model: z.string().default('deepseek-chat'),
    maxTokens: z.number().default(4096),
    verbose: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============ 2. ConfigManager 类 ============
export class ConfigManager {
    private config: Config;

    constructor() {
        this.config = this.loadConfig();
    }

    /**
     * 加载分层配置
     * 优先级：环境变量 > 项目配置 > 全局配置 > 默认
     */
    loadConfig(): Config {
        // 默认配置
        let raw: any = { model: 'deepseek-chat', maxTokens: 4096, verbose: false };

        // 全局配置 (~/.smartagent/config.json)
        const globalPath = join(homedir(), '.smartagent', 'config.json');
        if (existsSync(globalPath)) {
            try {
                raw = { ...raw, ...JSON.parse(readFileSync(globalPath, 'utf-8')) };
            } catch { /* 忽略解析错误 */ }
        }

        // 项目配置 (./.smartagentrc)
        const projectPath = join(process.cwd(), '.smartagentrc');
        if (existsSync(projectPath)) {
            try {
                raw = { ...raw, ...JSON.parse(readFileSync(projectPath, 'utf-8')) };
            } catch { /* 忽略解析错误 */ }
        }

        // 环境变量 (AGENT_API_KEY, AGENT_MODEL, AGENT_MAX_TOKENS, AGENT_VERBOSE)
        dotenvConfig();
        if (process.env.AGENT_API_KEY) raw.apiKey = process.env.AGENT_API_KEY;
        if (process.env.AGENT_MODEL) raw.model = process.env.AGENT_MODEL;
        if (process.env.AGENT_MAX_TOKENS) raw.maxTokens = parseInt(process.env.AGENT_MAX_TOKENS, 10);
        if (process.env.AGENT_VERBOSE) raw.verbose = process.env.AGENT_VERBOSE === 'true';

        // Zod 校验
        try {
            return ConfigSchema.parse(raw);
        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error('❌ 配置校验失败:');
                error.issues.forEach(err => {
                    console.error(`   ${err.path.join('.')}: ${err.message}`);
                });
                process.exit(1);
            }
            throw error;
        }
    }

    /** 获取当前配置 */
    get(): Config {
        return this.config;
    }

    /** 设置配置项（写入内存，后续可持久化） */
    set<K extends keyof Config>(key: K, value: Config[K]): void {
        this.config = { ...this.config, [key]: value };
    }

    /** 热重载配置 */
    reload(): Config {
        this.config = this.loadConfig();
        return this.config;
    }
}

/** 单例导出 */
export const configManager = new ConfigManager();