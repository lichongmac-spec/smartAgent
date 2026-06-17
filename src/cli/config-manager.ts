/**
 * 配置管理模块
 * 
 * 职责：
 * 1. 定义配置 Schema（使用 Zod 校验）
 * 2. 加载分层配置（环境变量 > 项目配置 > 全局配置 > 默认）
 * 3. 提供 get/set/reload 接口
 * 4. 支持配置热更新
 * 5. 配置写入（项目级/全局级）
 * 
 * 配置优先级（从高到低）：
 *   1. 环境变量 (AGENT_*)
 *   2. 项目配置 (./.smartagentrc)
 *   3. 全局配置 (~/.config/smartagent/config.json)
 *   4. 默认值
 * 
 * 扩展方式：
 *   - 在 ConfigSchema 中添加新字段
 *   - 在 loadConfig() 中添加新的配置来源（如远程配置中心）
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

// ============================================================
//  1. 定义配置 Schema
// ============================================================
const ConfigSchema = z.object({
    apiKey: z.string().min(1, 'API Key 不能为空').optional(),
    model: z.enum(['deepseek-chat', 'deepseek-reasoner']).default('deepseek-chat'),
    maxTokens: z.number().int().positive().default(4096),
    verbose: z.boolean().default(false),
    // 新增：可扩展字段
    baseUrl: z.string().url().optional(),
    timeout: z.number().int().positive().default(30000),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigKey = keyof Config;

// ============================================================
//  2. 配置路径工具
// ============================================================
function getConfigPaths() {
    const cwd = process.cwd();

    // 全局配置路径（遵循 XDG 规范，兼容 ~/.smartagent）
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    const globalConfigDir = join(xdgConfigHome, 'smartagent');
    const globalConfigPath = join(globalConfigDir, 'config.json');

    // 兼容旧路径 ~/.smartagent/config.json
    const legacyGlobalPath = join(homedir(), '.smartagent', 'config.json');

    return {
        global: existsSync(legacyGlobalPath) ? legacyGlobalPath : globalConfigPath,
        globalDir: globalConfigDir,
        project: join(cwd, '.smartagentrc'),
        // 也支持 .smartagentrc.json
        projectJson: join(cwd, '.smartagentrc.json'),
        // 本地覆盖（不提交到 git）
        local: join(cwd, '.smartagentrc.local.json'),
    };
}

// ============================================================
//  3. 深合并工具
// ============================================================
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        const sourceVal = source[key];
        const targetVal = result[key];
        if (
            sourceVal !== null &&
            typeof sourceVal === 'object' &&
            !Array.isArray(sourceVal) &&
            targetVal !== null &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            result[key] = deepMerge(targetVal, sourceVal) as T[keyof T];
        } else if (sourceVal !== undefined) {
            result[key] = sourceVal as T[keyof T];
        }
    }
    return result;
}

// ============================================================
//  4. ConfigManager 类
// ============================================================
export class ConfigManager {
    private config: Config;
    private paths: ReturnType<typeof getConfigPaths>;

    constructor() {
        this.paths = getConfigPaths();
        this.config = this.loadConfig();
    }

    /**
     * 加载分层配置
     * 优先级：环境变量 > 本地配置 > 项目配置 > 全局配置 > 默认
     */
    loadConfig(): Config {
        // Step 1: 默认配置
        let raw: any = {
            model: 'deepseek-chat',
            maxTokens: 4096,
            verbose: false,
            timeout: 30000,
        };

        const sources: Array<{ name: string; path?: string; loader: () => any }> = [
            // Step 2: 全局配置
            {
                name: '全局配置',
                path: this.paths.global,
                loader: () => {
                    if (existsSync(this.paths.global)) {
                        return JSON.parse(readFileSync(this.paths.global, 'utf-8'));
                    }
                    return {};
                },
            },
            // Step 3: 项目配置 (.smartagentrc)
            {
                name: '项目配置',
                path: this.paths.project,
                loader: () => {
                    if (existsSync(this.paths.project)) {
                        return JSON.parse(readFileSync(this.paths.project, 'utf-8'));
                    }
                    return {};
                },
            },
            // Step 4: 项目配置 (.smartagentrc.json)
            {
                name: '项目配置(JSON)',
                path: this.paths.projectJson,
                loader: () => {
                    if (existsSync(this.paths.projectJson)) {
                        return JSON.parse(readFileSync(this.paths.projectJson, 'utf-8'));
                    }
                    return {};
                },
            },
            // Step 5: 本地覆盖 (.smartagentrc.local.json) - 不提交 git
            {
                name: '本地配置',
                path: this.paths.local,
                loader: () => {
                    if (existsSync(this.paths.local)) {
                        return JSON.parse(readFileSync(this.paths.local, 'utf-8'));
                    }
                    return {};
                },
            },
        ];

        // 依次合并配置
        for (const source of sources) {
            try {
                const data = source.loader();
                if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                    raw = deepMerge(raw, data);
                }
            } catch (error) {
                console.warn(`⚠️  读取 ${source.name} 失败: ${source.path}`);
                if (process.env.DEBUG) {
                    console.warn(error);
                }
            }
        }

        // Step 6: 环境变量（最高优先级）
        dotenvConfig();
        const envConfig: any = {};
        if (process.env.AGENT_API_KEY) envConfig.apiKey = process.env.AGENT_API_KEY;
        if (process.env.AGENT_MODEL) envConfig.model = process.env.AGENT_MODEL;
        if (process.env.AGENT_MAX_TOKENS) envConfig.maxTokens = parseInt(process.env.AGENT_MAX_TOKENS, 10);
        if (process.env.AGENT_VERBOSE) envConfig.verbose = process.env.AGENT_VERBOSE === 'true';
        if (process.env.AGENT_BASE_URL) envConfig.baseUrl = process.env.AGENT_BASE_URL;
        if (process.env.AGENT_TIMEOUT) envConfig.timeout = parseInt(process.env.AGENT_TIMEOUT, 10);
        raw = deepMerge(raw, envConfig);

        // Step 7: Zod 校验
        try {
            this.config = ConfigSchema.parse(raw);
            return this.config;
        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error('❌ 配置校验失败:');
                error.issues.forEach(err => {
                    const path = err.path.join('.') || '根路径';
                    console.error(`   ${path}: ${err.message}`);
                    console.error(`     当前值: ${JSON.stringify(err.path.reduce((obj: any, key) => obj?.[key], raw))}`);
                });
                console.error('💡 请检查配置文件或环境变量');
                process.exit(1);
            }
            throw error;
        }
    }

    /** 获取完整配置 */
    get(): Config {
        return this.config;
    }

    /** 获取单个配置项（支持默认值） */
    getValue<K extends ConfigKey>(key: K): Config[K];
    getValue<K extends ConfigKey>(key: K, defaultValue: Config[K]): Config[K];
    getValue<K extends ConfigKey>(key: K, defaultValue?: Config[K]): Config[K] {
        const value = this.config[key];
        if (value === undefined && defaultValue !== undefined) {
            return defaultValue;
        }
        return value as Config[K];
    }

    /** 设置配置项（写入项目配置文件） */
    set<K extends ConfigKey>(key: K, value: Config[K]): void {
        this.config = { ...this.config, [key]: value };
        this.saveToFile(this.paths.project);
    }

    /** 设置配置项（写入全局配置文件） */
    setGlobal<K extends ConfigKey>(key: K, value: Config[K]): void {
        this.config = { ...this.config, [key]: value };
        this.saveToFile(this.paths.global);
    }

    /** 保存配置到指定文件 */
    private saveToFile(filePath: string): void {
        try {
            const dir = filePath.split('/').slice(0, -1).join('/');
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(filePath, JSON.stringify(this.config, null, 2));
            console.log(`✅ 配置已写入: ${filePath}`);
        } catch (error) {
            console.error(`❌ 写入配置失败: ${filePath}`);
            console.error(error);
        }
    }

    /** 热重载配置 */
    reload(): Config {
        console.log('🔄 重新加载配置...');
        return this.loadConfig();
    }

    /** 重置为默认配置 */
    reset(): Config {
        console.log('🔄 重置为默认配置...');
        this.config = ConfigSchema.parse({});
        return this.config;
    }

    /** 打印当前配置（隐藏敏感信息） */
    print(): void {
        const safeConfig = { ...this.config };
        if (safeConfig.apiKey) {
            const key = safeConfig.apiKey;
            // 安全脱敏：按比例显示首尾
            if (typeof key === 'string' && key.length > 8) {
                const visible = Math.min(6, Math.floor(key.length / 3));
                safeConfig.apiKey = key.slice(0, visible) + '…' + key.slice(-Math.min(4, visible));
            } else if (typeof key === 'string' && key.length > 0) {
                safeConfig.apiKey = '••••';
            }
        }
        console.log('📋 当前配置:');
        Object.entries(safeConfig).forEach(([key, value]) => {
            console.log(`  ${key}: ${JSON.stringify(value)}`);
        });
    }
}

/** 单例导出 */
export const configManager = new ConfigManager();