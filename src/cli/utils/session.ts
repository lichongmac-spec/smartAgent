/**
 * 会话管理模块
 *
 * 职责：
 * 1. 创建/切换/删除/列出会话
 * 2. 会话持久化（~/.smartagent/sessions/）
 * 3. 会话元数据管理
 * 4. 会话导入/导出
 *
 * 使用方式：
 *   import { sessionManager } from './utils/session.js';
 *   const id = sessionManager.create('我的对话');
 *   const ctx = sessionManager.load(id);
 */

import {
    ContextManager,
} from '../context-aware.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../logger.js';

export interface SessionMeta {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    model: string;
    tags?: string[];
}

export interface SessionSummary extends SessionMeta {
    preview: string; // 最后一条消息预览
}

/**
 * 获取会话存储根目录
 *
 * 优先级：
 * 1. SMARTAGENT_SESSIONS_DIR 环境变量（便于测试隔离）
 * 2. XDG_DATA_HOME 规范目录
 * 3. ~/.smartagent/sessions（兜底）
 */
function getSessionsDir(): string {
    if (process.env.SMARTAGENT_SESSIONS_DIR) {
        return process.env.SMARTAGENT_SESSIONS_DIR;
    }
    const xdgDataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    return join(xdgDataHome, 'smartagent', 'sessions');
}

const SESSIONS_DIR = getSessionsDir();
const INDEX_FILE = join(SESSIONS_DIR, 'index.json');

/**
 * 会话管理器（单例）
 *
 * 管理所有会话的创建、持久化、切换。
 * 目录创建延迟到首次需要时，失败静默处理。
 */
export class SessionManager {
    private sessions: Map<string, SessionMeta> = new Map();
    private _currentId: string | null = null;
    private initialized = false;

    constructor() {
        // 延迟初始化，避免在模块导入时创建目录
    }

    private ensureDir(): boolean {
        try {
            if (!existsSync(SESSIONS_DIR)) {
                mkdirSync(SESSIONS_DIR, { recursive: true });
            }
            return true;
        } catch {
            return false;
        }
    }

    private ensureInitialized(): void {
        if (this.initialized) return;
        this.initialized = true;

        if (!this.ensureDir()) return;
        this.loadIndex();
    }

    private loadIndex(): void {
        if (!existsSync(INDEX_FILE)) return;

        try {
            const data = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
            const entries: SessionMeta[] = data.sessions || [];
            for (const meta of entries) {
                if (existsSync(join(SESSIONS_DIR, `${meta.id}.json`))) {
                    this.sessions.set(meta.id, meta);
                }
            }
            this._currentId = data.current || null;
        } catch {
            this.rebuildIndex();
        }
    }

    private saveIndex(): void {
        if (!this.ensureDir()) return;
        const data = {
            sessions: Array.from(this.sessions.values()),
            current: this._currentId,
        };
        try {
            writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
        } catch {
            // 保存失败静默处理
        }
    }

    private rebuildIndex(): void {
        this.sessions.clear();
        const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
        for (const file of files) {
            try {
                const content = readFileSync(join(SESSIONS_DIR, file), 'utf-8');
                const data = JSON.parse(content);
                const id = file.replace(/\.json$/, '');
                const meta: SessionMeta = {
                    id,
                    name: data.sessionName || data.sessionId || id,
                    createdAt: data.createdAt || new Date().toISOString(),
                    updatedAt: data.updatedAt || new Date().toISOString(),
                    messageCount: data.messages?.length || 0,
                    model: data.model || 'unknown',
                };
                this.sessions.set(id, meta);
            } catch {
                // 跳过损坏的文件
            }
        }
        this.saveIndex();
    }

    // ============================================================
    //  核心 API
    // ============================================================

    create(name: string, model: string = 'default'): string {
        this.ensureInitialized();
        if (!this.ensureDir()) {
            logger.warn('无法创建会话目录，会话将不会持久化');
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const meta: SessionMeta = {
            id,
            name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messageCount: 0,
            model,
        };

        this.sessions.set(id, meta);
        this._currentId = id;

        const ctx = new ContextManager();
        this.saveContext(id, ctx);

        this.saveIndex();
        logger.success(`会话 "${name}" 已创建 (ID: ${id.slice(0, 16)}...)`);
        return id;
    }

    load(id: string): ContextManager | null {
        this.ensureInitialized();
        if (!this.ensureDir()) return null;

        const path = join(SESSIONS_DIR, `${id}.json`);
        if (!existsSync(path)) return null;

        try {
            const data = readFileSync(path, 'utf-8');
            const ctx = ContextManager.fromJSON(data);
            this._currentId = id;

            const meta = this.sessions.get(id);
            if (meta) {
                meta.updatedAt = new Date().toISOString();
                this.saveIndex();
            }

            return ctx;
        } catch (error) {
            logger.error(`加载会话失败: ${(error as Error).message}`);
            return null;
        }
    }

    saveContext(id: string, ctx: ContextManager): void {
        this.ensureInitialized();
        if (!this.ensureDir()) return;

        const path = join(SESSIONS_DIR, `${id}.json`);
        try {
            writeFileSync(path, ctx.toJSON());
        } catch {
            // 保存失败静默处理
        }

        const meta = this.sessions.get(id);
        if (meta) {
            meta.updatedAt = new Date().toISOString();
            meta.messageCount = ctx.length;
            this.saveIndex();
        }
    }

    list(): SessionSummary[] {
        this.ensureInitialized();
        if (!this.ensureDir()) return [];

        return Array.from(this.sessions.values())
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .map((meta) => {
                let preview = '';
                try {
                    const data = JSON.parse(readFileSync(join(SESSIONS_DIR, `${meta.id}.json`), 'utf-8'));
                    const msgs = data.messages || [];
                    const lastUser = [...msgs].reverse().find((m: any) => m.role === 'user');
                    if (lastUser) {
                        preview = lastUser.content.slice(0, 60);
                        if (lastUser.content.length > 60) preview += '…';
                    }
                } catch {
                    preview = '(无法读取)';
                }

                return { ...meta, preview } as SessionSummary;
            });
    }

    switch(id: string): boolean {
        this.ensureInitialized();
        if (!this.sessions.has(id)) return false;
        this._currentId = id;
        this.saveIndex();
        logger.success(`已切换到会话: ${this.sessions.get(id)?.name}`);
        return true;
    }

    delete(id: string): boolean {
        this.ensureInitialized();
        if (!this.sessions.has(id)) return false;

        const path = join(SESSIONS_DIR, `${id}.json`);
        if (existsSync(path)) rmSync(path);

        this.sessions.delete(id);

        if (this._currentId === id) {
            this._currentId = this.sessions.size > 0
                ? Array.from(this.sessions.keys())[0]
                : null;
        }

        this.saveIndex();
        logger.success(`会话已删除`);
        return true;
    }

    rename(id: string, newName: string): boolean {
        this.ensureInitialized();
        const meta = this.sessions.get(id);
        if (!meta) return false;
        meta.name = newName;
        this.saveIndex();
        return true;
    }

    exportAsText(id: string): string {
        const ctx = this.load(id);
        if (!ctx) return '';

        return ctx.getMessages()
            .map((m) => {
                const roleLabel = m.role === 'user' ? '👤 用户' : m.role === 'assistant' ? '🤖 助手' : `🔧 ${m.role}`;
                return `${roleLabel}\n${m.content}\n`;
            })
            .join('\n');
    }

    exportAsJSON(id: string): string {
        this.ensureInitialized();
        const path = join(SESSIONS_DIR, `${id}.json`);
        if (!existsSync(path)) return '{}';
        return readFileSync(path, 'utf-8');
    }

    get currentId(): string | null {
        this.ensureInitialized();
        return this._currentId;
    }

    get currentMeta(): SessionMeta | null {
        this.ensureInitialized();
        return this._currentId ? this.sessions.get(this._currentId) ?? null : null;
    }

    getMeta(id: string): SessionMeta | null {
        this.ensureInitialized();
        return this.sessions.get(id) ?? null;
    }
}

export const sessionManager = new SessionManager();
