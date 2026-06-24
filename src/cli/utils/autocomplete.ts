/**
 * 交互式自动补全模块
 *
 * 职责：
 * 1. 为 readline 实例提供 Tab 补全能力
 * 2. 内置常用 completer：chat 命令、文件路径、配置 key
 *
 * 使用方式：
 *   import { setupAutocomplete, chatCompleter } from './utils/autocomplete.js';
 *   const rl = readline.createInterface({ input, output });
 *   setupAutocomplete(rl, chatCompleter);
 */

import { readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import * as readline from 'readline';
import { sessionManager } from './session.js';

// ============================================================
//  类型定义
// ============================================================

/** 补全候选项 */
export interface CompletionItem {
    /** 补全文本 */
    value: string;
    /** 简短描述（可选，显示在候选列表中） */
    description?: string;
}

/** Completer 函数签名 */
export type Completer = (line: string) => CompletionItem[];

/** readline 原始 Completer 签名（含回调） */
type ReadlineCompleter = (
    line: string,
    callback: (err: null | Error, result: [string[], string]) => void,
) => void;

// ============================================================
//  核心工具
// ============================================================

/**
 * 为 readline.Interface 安装自动补全
 *
 * @param rl - readline 实例
 * @param completer - 补全函数，接收当前行，返回候选列表
 *
 * @example
 *   const rl = readline.createInterface({ input, output });
 *   setupAutocomplete(rl, chatCompleter);
 */
export function setupAutocomplete(
    rl: readline.Interface,
    completer: Completer,
): void {
    const wrappedCompleter: ReadlineCompleter = (line: string, callback) => {
        try {
            const items = completer(line);

            if (items.length === 0) {
                // 无匹配 → 返回空列表（按 Tab 无效果）
                callback(null, [[], line]);
                return;
            }

            if (items.length === 1) {
                // 唯一匹配 → 直接补齐
                callback(null, [[items[0].value], line]);
                return;
            }

            // 多个匹配 → 显示候选列表
            // 计算公共前缀，自动补齐公共部分
            const values = items.map((i) => i.value);
            const prefix = commonPrefix(values);

            if (prefix.length > 0) {
                // 先补齐公共前缀，下次 Tab 再显示列表
                callback(null, [[items[0].value], line]);
            } else {
                // 无法自动补齐，显示所有候选
                process.stdout.write('\n');
                const maxLen = Math.max(...items.map((i) => i.value.length));
                for (const item of items) {
                    const padded = item.value.padEnd(maxLen + 2);
                    const desc = item.description ? ` — ${item.description}` : '';
                    process.stdout.write(`  ${padded}${desc}\n`);
                }
                // 重新显示提示符
                process.stdout.write(rl.getPrompt());
                process.stdout.write(line);
                callback(null, [[], line]);
            }
        } catch {
            callback(null, [[], line]);
        }
    };

    // @ts-ignore - readline 内部属性，运行时有效
    (rl as any).completer = wrappedCompleter;
}

// ============================================================
//  内置 Completer
// ============================================================

/** Chat 模式可用命令 */
const CHAT_COMMANDS: CompletionItem[] = [
    { value: '/exit', description: '退出对话' },
    { value: '/clear', description: '清空上下文' },
    { value: '/help', description: '显示帮助' },
    { value: '/save', description: '保存会话到文件' },
    { value: '/load', description: '从文件恢复会话' },
    { value: '/stats', description: '显示上下文统计' },
];

/**
 * Chat 模式补全器
 *
 * 规则：
 * - 以 / 开头 → 补全控制命令 (/exit, /clear, /help, …)
 * - 其它 → 不提供补全
 */
export function chatCompleter(line: string): CompletionItem[] {
    const trimmed = line.trimStart();

    // 以 / 开头，提供命令补全
    if (trimmed.startsWith('/')) {
        return CHAT_COMMANDS.filter((cmd) =>
            cmd.value.startsWith(trimmed),
        );
    }

    return [];
}

/**
 * 文件路径补全器
 *
 * 按 Tab 补全当前目录下的文件/目录名。
 * 目录后缀 /，便于继续补全。
 *
 * @example
 *   setupAutocomplete(rl, filePathCompleter);
 */
export function filePathCompleter(line: string): CompletionItem[] {
    // 取当前词：光标前的最后一个「词」（空格分隔或路径分隔符）
    const tokens = line.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || '';

    let dir: string;
    let prefix: string;

    if (lastToken.includes('/')) {
        dir = resolve(dirname(lastToken));
        prefix = lastToken.split('/').pop() || '';
    } else {
        dir = process.cwd();
        prefix = lastToken;
    }

    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return [];
    }

    return entries
        .filter((name) => {
            if (!name.startsWith(prefix)) return false;
            // 当用户输入以 . 开头时，允许补全隐藏文件（如 .env）
            if (prefix.startsWith('.')) return true;
            return !name.startsWith('.');
        })
        .map((name): CompletionItem => {
            const fullPath = join(dir, name);
            let display = lastToken.includes('/')
                ? lastToken.slice(0, lastToken.lastIndexOf('/') + 1) + name
                : name;

            try {
                if (statSync(fullPath).isDirectory()) {
                    display += '/';
                    return { value: display, description: '目录' };
                }
            } catch {
                // 忽略 stat 错误
            }

            return { value: display };
        });
}

/**
 * 配置 key 补全器
 *
 * 在 config set/get 等场景中按 Tab 补全已定义的 key。
 * 需传入可用 keys 列表。
 */
export function configKeyCompleter(keys: string[]): Completer {
    return (line: string): CompletionItem[] => {
        const tokens = line.split(/\s+/);
        const lastToken = tokens[tokens.length - 1] || '';

        if (!lastToken) return [];

        return keys
            .filter((key) => key.startsWith(lastToken))
            .map((key) => ({ value: key }));
    };
}

// ============================================================
//  Agent 专用补全器
// ============================================================

/**
 * 模型名称补全器
 *
 * 补全已知的 LLM 模型名称。
 *
 * @example
 *   setupAutocomplete(rl, modelCompleter);
 */
export const modelCompleter: Completer = (line: string): CompletionItem[] => {
    const models: CompletionItem[] = [
        { value: 'deepseek-v4-flash', description: 'DeepSeek V4 Flash (推荐)' },
        { value: 'deepseek-v4-pro', description: 'DeepSeek V4 Pro' },
        { value: 'deepseek-chat', description: 'DeepSeek V3 (⚠ 2026/07/24 弃用)' },
        { value: 'deepseek-reasoner', description: 'DeepSeek R1 (⚠ 2026/07/24 弃用)' },
        { value: 'gpt-4o', description: 'OpenAI GPT-4o' },
        { value: 'gpt-4o-mini', description: 'OpenAI GPT-4o Mini' },
        { value: 'gpt-3.5-turbo', description: 'OpenAI GPT-3.5' },
        { value: 'claude-3-opus-latest', description: 'Claude 3 Opus' },
        { value: 'claude-3-sonnet-latest', description: 'Claude 3 Sonnet' },
        { value: 'claude-3-haiku-latest', description: 'Claude 3 Haiku' },
    ];

    const trimmed = line.trimStart();
    if (!trimmed) return [];

    return models.filter((m) => m.value.startsWith(trimmed));
};

/**
 * 工具名称补全器
 *
 * 补全 Agent 可用的工具名称。
 *
 * @param tools - 可用工具名称列表
 *
 * @example
 *   const tools = ['readFile', 'writeFile', 'searchWeb'];
 *   setupAutocomplete(rl, toolNameCompleter(tools));
 */
export function toolNameCompleter(tools: string[]): Completer {
    const items: CompletionItem[] = tools.map((t) => ({ value: t, description: `工具: ${t}` }));

    return (line: string): CompletionItem[] => {
        const trimmed = line.trimStart();
        if (!trimmed) return [];

        return items.filter((item) => item.value.startsWith(trimmed));
    };
}

/**
 * 会话名称补全器
 *
 * 补全已有的会话名称。
 *
 * @example
 *   setupAutocomplete(rl, sessionNameCompleter);
 */
export const sessionNameCompleter: Completer = (line: string): CompletionItem[] => {
    // 使用顶层导入的 sessionManager 单例
    try {
        const sessions = sessionManager.list();
        return sessions
            .filter((s) => line ? s.name.startsWith(line) : true)
            .map((s) => ({
                value: s.name,
                description: `${s.id.slice(0, 8)}... | ${s.preview || ''}`,
            }));
    } catch {
        return [];
    }
};

/**
 * 增强版 Chat 补全器（包含更多命令）
 */
export function enhancedChatCompleter(line: string): CompletionItem[] {
    const COMMANDS: CompletionItem[] = [
        { value: '/exit', description: '退出对话' },
        { value: '/quit', description: '退出对话' },
        { value: '/clear', description: '清空上下文' },
        { value: '/help', description: '显示帮助' },
        { value: '/save', description: '保存会话到文件' },
        { value: '/load', description: '从文件恢复会话' },
        { value: '/stats', description: '显示上下文统计' },
        { value: '/debug', description: '显示调试信息' },
        { value: '/session', description: '会话管理' },
        { value: '/model', description: '切换模型' },
    ];

    const trimmed = line.trimStart();

    if (trimmed.startsWith('/')) {
        return COMMANDS.filter((cmd) => cmd.value.startsWith(trimmed));
    }

    return [];
}

// ============================================================
//  工具函数
// ============================================================

/**
 * 计算字符串数组的公共前缀
 *
 * @example
 *   commonPrefix(['hello', 'help', 'helicopter']) // => 'hel'
 */
export function commonPrefix(strings: string[]): string {
    if (strings.length === 0) return '';
    if (strings.length === 1) return strings[0];

    const first = strings[0];
    let end = 0;

    for (let i = 0; i < first.length; i++) {
        const ch = first[i];
        if (strings.every((s) => s[i] === ch)) {
            end = i + 1;
        } else {
            break;
        }
    }

    return first.slice(0, end);
}
