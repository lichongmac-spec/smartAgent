/**
 * token-counter.ts - Token 精确计数器
 *
 * 理解：就像厨房的"食材称重器"——精确计算每道菜用了多少食材。
 * 用于上下文管理：知道对话用了多少 Token，才能决定是否裁剪。
 *
 * 策略：
 *   1. 优先使用 tiktoken（精确）—— 如果安装了
 *   2. 回退到字符估算（近似）—— 零依赖
 *
 * 不同模型的 Tokenizer 不同：
 *   - OpenAI GPT-4/3.5 → cl100k_base
 *   - DeepSeek → cl100k_base（兼容）
 *   - Qwen 2.5 → cl100k_base（近似）
 *   - Llama 3.x → cl100k_base（近似）
 *
 * 使用方式：
 *   import { TokenCounter } from './token-counter.js';
 *   const counter = new TokenCounter();
 *   const count = counter.count('你好世界');
 *   const total = counter.countMessages(messages);
 */

import type { Message } from './types.js';

/** 每条消息的固定开销 Token 数（OpenAI 格式） */
const MESSAGE_OVERHEAD = 4;

/** 每次请求的固定开销 Token 数 */
const REQUEST_OVERHEAD = 2;

/**
 * Token 计数器
 *
 * 自动选择最佳计数方式：
 *   1. tiktoken（需要安装 @dqbd/tiktoken）
 *   2. 字符估算（兜底）
 */
export class TokenCounter {
  private encoder: TokenEncoder | null = null;
  private useFallback = false;
  private readonly encoding: string;

  /**
   * @param encoding - 编码器名称，默认 cl100k_base
   */
  constructor(encoding = 'cl100k_base') {
    this.encoding = encoding;
    this.initEncoder();
  }

  /**
   * 计算单段文本的 Token 数
   *
   * @example
   *   counter.count('你好，世界！')  // → ~6 tokens
   *   counter.count('Hello world!')  // → ~3 tokens
   */
  count(text: string): number {
    if (!text) return 0;

    // 方式 1：精确计数
    if (this.encoder && !this.useFallback) {
      try {
        return this.encoder.encode(text).length;
      } catch {
        this.useFallback = true;
      }
    }

    // 方式 2：字符估算
    return this.estimateTokens(text);
  }

  /**
   * 计算消息列表的总 Token 数
   *
   * 包含消息本身 + 格式开销（每条消息 4 Token 固定开销）
   *
   * @example
   *   counter.countMessages([
   *     { role: 'system', content: '你是一个助手' },
   *     { role: 'user', content: '你好' },
   *   ]);
   */
  countMessages(messages: Message[]): number {
    let total = REQUEST_OVERHEAD;

    for (const msg of messages) {
      total += MESSAGE_OVERHEAD;
      total += this.count(msg.role);
      total += this.count(msg.content);
    }

    return total;
  }

  /**
   * 估算文本能否放入指定的 Token 预算
   *
   * @param text - 要检查的文本
   * @param budget - Token 预算
   * @returns 如果超过预算返回 false
   */
  fitsInBudget(text: string, budget: number): boolean {
    return this.count(text) <= budget;
  }

  /**
   * 按 Token 预算截断文本（从头部保留）
   *
   * @param text - 原始文本
   * @param maxTokens - 最大 Token 数
   * @returns 截断后的文本
   */
  truncateToBudget(text: string, maxTokens: number): string {
    if (!text || maxTokens <= 0) return '';

    // 精确截断
    if (this.encoder && !this.useFallback) {
      try {
        const tokens = this.encoder.encode(text);
        if (tokens.length <= maxTokens) return text;
        const truncated = this.encoder.decode(tokens.slice(0, maxTokens));
        return truncated;
      } catch {
        this.useFallback = true;
      }
    }

    // 估算截断：每次尝试多截一些
    let lo = 0;
    let hi = text.length;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.estimateTokens(text.slice(0, mid)) <= maxTokens) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return text.slice(0, lo - 1);
  }

  // ============================================================
  //  初始化
  // ============================================================

  /**
   * 尝试加载 tiktoken 编码器
   */
  private initEncoder(): void {
    try {
      // 尝试加载 tiktoken（可选依赖）
      const tiktoken = loadTikToken();
      if (tiktoken) {
        this.encoder = tiktoken.getEncoding(this.encoding);
        this.useFallback = false;
      } else {
        this.useFallback = true;
      }
    } catch {
      this.useFallback = true;
    }
  }

  // ============================================================
  //  估算方法（字符比例法）
  // ============================================================

  /**
   * 基于字符类型估算 Token 数
   *
   * 经验公式（针对 cl100k_base）：
   *   - 1 个中文字符 ≈ 1.5~2 Token
   *   - 1 个英文单词 ≈ 1~1.3 Token
   *   - 1 个英文字符 ≈ 0.25 Token
   *
   * 这里使用保守估算：
   *   - 中文字符：按 2 Token 算
   *   - 英文字符：按 0.3 Token 算
   */
  private estimateTokens(text: string): number {
    let tokens = 0;

    for (const char of text) {
      if (isCJK(char)) {
        tokens += 2; // 中文字符通常 1.5-2 Token
      } else if (char === ' ') {
        tokens += 0; // 空格几乎不占 Token
      } else {
        tokens += 0.3; // 英文字符约 0.25-0.3 Token
      }
    }

    return Math.max(1, Math.ceil(tokens));
  }
}

// ============================================================
//  工具函数
// ============================================================

/**
 * 判断是否为 CJK 字符（中日韩统一表意文字）
 *
 * 包含：CJK 统一汉字、扩展 A/B、兼容汉字、平假名、片假名、韩文
 */
export function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4E00 && code <= 0x9FFF) || // CJK 统一汉字
    (code >= 0x3400 && code <= 0x4DBF) || // CJK 扩展 A
    (code >= 0x20000 && code <= 0x2A6DF) || // CJK 扩展 B
    (code >= 0xF900 && code <= 0xFAFF) || // CJK 兼容汉字
    (code >= 0x3040 && code <= 0x309F) || // 平假名
    (code >= 0x30A0 && code <= 0x30FF) || // 片假名
    (code >= 0xAC00 && code <= 0xD7AF) // 韩文
  );
}

// ============================================================
//  tiktoken 动态加载
// ============================================================

/** tiktoken 接口 */
interface TokenEncoder {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

interface TikTokenModule {
  getEncoding(name: string): TokenEncoder;
}

/**
 * 尝试动态加载 tiktoken 包
 * 如果用户安装了 @dqbd/tiktoken，则使用精确计数
 */
function loadTikToken(): TikTokenModule | null {
  try {
    // 使用 createRequire 从调用方上下文加载
    const { createRequire } = require('node:module') as { createRequire: (path: string) => NodeRequire };
    const req = createRequire(process.cwd() + '/node_modules/');
    try {
      const mod = req('tiktoken') as TikTokenModule;
      return mod;
    } catch {
      try {
        const mod = req('@dqbd/tiktoken') as TikTokenModule;
        return mod;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}
