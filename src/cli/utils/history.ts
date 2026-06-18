/**
 * 命令历史记录模块
 *
 * 职责：
 * 1. 记录用户输入的命令
 * 2. 持久化到文件（跨会话）
 * 3. 支持上下键翻找
 * 4. 支持搜索历史
 *
 * 使用方式：
 *   import { setupHistory } from './utils/history.js';
 *   const rl = readline.createInterface({ ... });
 *   setupHistory(rl, 'agent-chat');
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Interface } from 'readline';

/** 获取历史记录文件路径（可通过 SMARTAGENT_HISTORY_DIR 环境变量覆盖） */
function getHistoryPath(session: string): string {
    const dir = process.env.SMARTAGENT_HISTORY_DIR
        || join(homedir(), '.smartagent', 'history');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return join(dir, `${session}.json`);
}

/** 加载历史记录 */
export function loadHistory(session: string): string[] {
    try {
        const path = getHistoryPath(session);
        if (existsSync(path)) {
            const data = readFileSync(path, 'utf-8');
            return JSON.parse(data);
        }
    } catch {
        /* ignore - 文件不存在或格式错误 */
    }
    return [];
}

/** 保存历史记录 */
export function saveHistory(session: string, history: string[]): void {
    try {
        const path = getHistoryPath(session);
        // 最多保留 1000 条
        const trimmed = history.slice(-1000);
        writeFileSync(path, JSON.stringify(trimmed, null, 2));
    } catch {
        /* ignore - 权限不足等 */
    }
}

/** 搜索历史记录（返回匹配项） */
export function searchHistory(session: string, query: string): string[] {
    const history = loadHistory(session);
    if (!query) return history;
    const lower = query.toLowerCase();
    return history.filter((line) => line.toLowerCase().includes(lower));
}

/**
 * 为 readline 设置历史记录
 *
 * readline 内置的 history 属性存储历史行，上下键自动翻找。
 * 直接添加 line 监听器记录每一行，不在 rl.on 上做包装以避免：
 * - 重复注册导致内存泄漏
 * - 影响其他监听器的正常注册
 *
 * @param rl - readline 实例
 * @param session - 会话名称（用于区分不同场景，如 'agent-chat'）
 * @param maxSize - 最大内存历史条数，默认 100
 */
export function setupHistory(
    rl: Interface,
    session: string,
    maxSize: number = 100,
): void {
    const persisted = loadHistory(session);

    // 注入 readline 内部历史
    // readline 的 history 属性是公开的（虽然类型定义未暴露）
    const rlAny = rl as any;
    rlAny.history = persisted.slice(-maxSize);
    rlAny.historyIndex = rlAny.history.length;

    // 直接添加 line 监听器记录历史（不覆盖 rl.on）
    rl.on('line', (line: string) => {
        if (line.trim() && !line.startsWith('/')) {
            const h: string[] = rlAny.history || [];
            // 去重：连续相同行只保留一条
            if (h.length === 0 || h[h.length - 1] !== line) {
                h.push(line);
                if (h.length > maxSize * 2) {
                    // 裁剪到 maxSize
                    rlAny.history = h.slice(-maxSize);
                }
                // 持久化
                saveHistory(session, h);
            }
        }
    });
}
