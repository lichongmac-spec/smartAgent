/**
 * 表格输出模块
 *
 * 职责：
 * 1. 将二维数组渲染为美观的终端表格
 * 2. 支持表头、自定义对齐、noColor 适配
 * 3. 提供便捷的键值对表格（适合 config list 等场景）
 *
 * 使用方式：
 *   import { renderTable, renderKVTable } from './utils/table.js';
 *
 *   renderTable([['a', '1'], ['b', '2']], ['Key', 'Value']);
 *   renderKVTable({ name: 'app', version: '1.0' });
 */

import { table, getBorderCharacters } from 'table';
import type { Alignment } from 'table';
import { fileURLToPath } from 'url';

// ============================================================
//  配置（由调用方注入 / 环境变量）
// ============================================================

let _noColor = false;

/** 注入全局 noColor 状态 */
export function configureTable(noColor: boolean): void {
    _noColor = noColor;
}

// ============================================================
//  对齐检测
// ============================================================

/**
 * 推断列对齐方式
 * - 全数字 → right
 * - 其他 → left
 */
function inferColumnAlignments(
    rows: string[][],
    columnCount: number,
): Alignment[] {
    const alignments: Alignment[] = [];

    for (let c = 0; c < columnCount; c++) {
        const allNumeric = rows.every(
            row => row[c] !== undefined && /^\s*-?[\d.,]+\s*$/.test(String(row[c])),
        );
        alignments.push(allNumeric ? 'right' : 'left');
    }

    return alignments;
}

// ============================================================
//  内部工具
// ============================================================

/** 检测 CI 环境（直接读取环境变量，避免循环依赖） */
function isCI(): boolean {
    return process.env.CI !== undefined
        && process.env.CI !== 'false'
        && process.env.CI !== '0';
}

// ============================================================
//  表格渲染
// ============================================================

export interface TableOptions {
    /** 表格标题（渲染在表格上方） */
    title?: string;
    /** 是否使用紧凑边框（norc 风格），默认 true */
    compact?: boolean;
}

/**
 * 将二维数组渲染为终端表格并打印到 stdout
 *
 * @param rows      数据行（每行是一个字符串数组）
 * @param header    表头行
 * @param options   额外选项
 * @returns 渲染后的表格字符串（也会直接 console.log）
 *
 * @example
 *   renderTable(
 *     [['deepseek', 'v3', '8192'], ['gpt-4', 'turbo', '128k']],
 *     ['Model', 'Variant', 'Context Window'],
 *   );
 */
export function renderTable(
    rows: string[][],
    header?: string[],
    options: TableOptions = {},
): string {
    const { title, compact = true } = options;

    // 组装数据（header 在前）
    const data: string[][] = header
        ? [header, ...rows]
        : rows;

    // 空数据直接返回
    if (data.length === 0) {
        const msg = '📋 暂无数据';
        if (title) console.log(title);
        console.log(msg);
        return msg;
    }

    const columnCount = header
        ? header.length
        : (rows[0]?.length ?? 0);

    // 推断对齐（跳过表头行）
    const bodyRows = header ? rows : data;
    const alignments = inferColumnAlignments(bodyRows, columnCount);

    // 构建列配置
    const columns = Object.fromEntries(
        alignments.map((align, i) => [i, { alignment: align } as const]),
    );

    // 边框风格：norc = 简洁无竖线，适合数据展示
    const border = compact ? getBorderCharacters('norc') : undefined;

    // 绘制水平线规则：仅表头下方 + 表格底部
    const drawHorizontalLine = (index: number, size: number): boolean => {
        if (index === 0 || index === size) return true; // 顶部 / 底部边框
        if (header && index === 1) return true;          // 表头后分隔线
        return false;
    };

    const output = table(data, {
        border,
        columns,
        drawHorizontalLine,
    });

    // 渲染
    if (title && !_noColor) {
        console.log(title);
    } else if (title) {
        console.log(title);
    }
    console.log(output);

    return output;
}

/**
 * 将键值对渲染为两列表格
 *
 * 适用场景：config list、环境变量展示、元数据列表
 *
 * @param kv        键值对映射
 * @param options   额外选项（title）
 * @returns 渲染后的表格字符串
 *
 * @example
 *   renderKVTable({ model: 'deepseek', temperature: 0.7 }, { title: '📋 当前配置' });
 *
 *   // 输出：
 *   // 📋 当前配置
 *   // ╔═════════════╤═══════════╗
 *   // ║ Key         │ Value     ║
 *   // ╠═════════════╪═══════════╣
 *   // ║ model       │ deepseek  ║
 *   // ║ temperature │ 0.7       ║
 *   // ╚═════════════╧═══════════╝
 */
export function renderKVTable(
    kv: Record<string, unknown>,
    options: TableOptions = {},
): string {
    const entries = Object.entries(kv);

    // CI 环境降级为纯文本
    if (isCI()) {
        const lines: string[] = [];
        if (options.title) lines.push(options.title);
        if (entries.length === 0) {
            lines.push('📋 暂无数据');
        } else {
            const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
            for (const [key, value] of entries) {
                const displayValue = typeof value === 'object' && value !== null
                    ? JSON.stringify(value)
                    : String(value);
                lines.push(`  ${key.padEnd(maxKeyLen)} : ${displayValue}`);
            }
        }
        const output = lines.join('\n');
        console.log(output);
        return output;
    }

    const rows: string[][] = entries.map(([key, value]) => [
        key,
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
    ]);

    return renderTable(rows, ['Key', 'Value'], options);
}

// ============================================================
//  直接运行时 demo（tsx src/cli/utils/table.ts）
// ============================================================

// 仅在直接运行时输出 demo
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
    console.log('=== renderTable demo ===\n');

    renderTable(
        [
            ['deepseek-chat', 'DeepSeek', '2024-12', '64K', '¥0.001'],
            ['gpt-4', 'OpenAI', '2023-03', '128K', '¥0.03'],
            ['claude-3-opus', 'Anthropic', '2024-03', '200K', '¥0.015'],
        ],
        ['Model ID', 'Provider', 'Release', 'Context', 'Price/token'],
    );

    console.log('\n=== renderKVTable demo ===\n');

    renderKVTable(
        {
            model: 'deepseek-chat',
            temperature: 0.7,
            maxTokens: 8192,
            stream: true,
            apiKey: 'sk-xxxx...xxxx',
        },
        { title: '📋 当前配置' },
    );
}
