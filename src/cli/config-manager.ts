// src/cli/config-manager.ts
import { z } from 'zod';

const ConfigSchema = z.object({
    apiKey: z.string().optional(),
    model: z.string().default('deepseek-chat'),
    maxTokens: z.number().default(4096),
    verbose: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigManager {
    private config: Config;

    constructor() {
        this.config = { model: 'deepseek-chat', maxTokens: 4096, verbose: false };
    }

    get(): Config {
        return this.config;
    }

    set(key: keyof Config, value: any): void {
        this.config = { ...this.config, [key]: value };
        console.log(`✅ 已设置 ${key}=${value}`);
    }
}

export const configManager = new ConfigManager();