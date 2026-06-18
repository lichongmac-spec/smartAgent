/**
 * 输出分页模块
 *
 * 职责：
 * 1. 长内容自动分页显示
 * 2. 支持上下翻页、搜索
 * 3. 检测终端高度自适应
 *
 * 使用方式：
 *   import { pager } from './utils/pager.js';
 *   await pager(longText, { title: '📄 结果' });
 */

import { createInterface } from 'readline';
import { isCI } from '../env-check.js';

export interface PagerOptions {
    /** 标题 */
    title?: string;
    /** 每页行数（默认终端高度-4） */
    linesPerPage?: number;
    /** 是否显示行号 */
    showLineNumbers?: boolean;
}

/**
 * 分页显示内容
 *
 * 支持键盘操作：
 * - n/→/空格: 下一页
 * - p/←: 上一页
 * - g: 首页
 * - G: 末页
 * - /: 搜索
 * - q/Esc: 退出
 *
 * @param content - 要显示的内容
 * @param options - 分页选项
 * @returns 用户按 q 退出时 resolve
 */
export async function pager(content: string, options: PagerOptions = {}): Promise<void> {
    // CI 环境下直接输出
    if (isCI()) {
        console.log(content);
        return;
    }

    const lines = content.split('\n');
    const totalLines = lines.length;
    const termHeight = (process.stdout as any).rows || 24;
    const pageFooter = 4; // 标题+分割线+空白+分页信息
    const pageSize = options.linesPerPage || Math.max(termHeight - pageFooter, 8);
    const totalPages = Math.ceil(totalLines / pageSize);
    let currentPage = 0;

    // 单页内容直接输出
    if (totalPages <= 1) {
        console.log(content);
        return;
    }

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
    });

    const renderPage = () => {
        const start = currentPage * pageSize;
        const end = Math.min(start + pageSize, totalLines);
        const pageLines = lines.slice(start, end);

        // 清屏
        console.clear();

        const termWidth = (process.stdout as any).columns || 80;

        // 标题
        if (options.title) {
            console.log(`\x1b[1m${options.title}\x1b[0m`);
            console.log('━'.repeat(Math.min(termWidth, 80)));
        }

        // 内容
        for (let i = 0; i < pageLines.length; i++) {
            const lineNum = options.showLineNumbers
                ? `\x1b[90m${(start + i + 1).toString().padStart(4)}\x1b[0m `
                : '';
            console.log(`${lineNum}${pageLines[i]}`);
        }

        // 分页信息
        console.log('');
        console.log(
            `\x1b[90m页面 ${currentPage + 1}/${totalPages}  |  ` +
            `n:下一页  p:上一页  g:首页  G:末页  /:搜索  q:退出\x1b[0m`,
        );
    };

    let searchTerm = '';
    let searchMode = false;

    renderPage();

    return new Promise((resolve) => {
        let rawModeSet = false;

        // 启用 raw mode 以捕获键盘事件
        try {
            if (typeof process.stdin.setRawMode === 'function') {
                process.stdin.setRawMode(true);
                rawModeSet = true;
            }
            process.stdin.resume();
        } catch {
            /* ignore - 某些环境不支持 raw mode */
        }

        (rl as any).input.on('keypress', (_str: string, key: { name: string; ctrl: boolean }) => {
            if (searchMode) {
                if (key.name === 'return') {
                    searchMode = false;
                    // 跳转到第一个匹配项
                    for (let i = 0; i < totalLines; i++) {
                        if (lines[i].toLowerCase().includes(searchTerm.toLowerCase())) {
                            currentPage = Math.floor(i / pageSize);
                            renderPage();
                            break;
                        }
                    }
                    searchTerm = '';
                    return;
                }
                if (key.name === 'escape') {
                    searchMode = false;
                    searchTerm = '';
                    renderPage();
                    return;
                }
                if (key.name === 'backspace') {
                    searchTerm = searchTerm.slice(0, -1);
                } else if (_str && _str.length === 1) {
                    searchTerm += _str;
                }
                // 显示搜索状态
                process.stdout.write(`\r\x1b[K\x1b[90m搜索: ${searchTerm}\x1b[0m`);
                return;
            }

            switch (key.name) {
                case 'q':
                case 'escape':
                    rl.close();
                    console.clear();
                    resolve();
                    break;
                case 'n':
                case 'right':
                    if (currentPage < totalPages - 1) {
                        currentPage++;
                        renderPage();
                    }
                    break;
                case 'p':
                case 'left':
                    if (currentPage > 0) {
                        currentPage--;
                        renderPage();
                    }
                    break;
                case 'g':
                    if (key.ctrl) {
                        // Ctrl+G → 末页
                        currentPage = totalPages - 1;
                    } else {
                        // g → 首页
                        currentPage = 0;
                    }
                    renderPage();
                    break;
                case 'G':
                    currentPage = totalPages - 1;
                    renderPage();
                    break;
                case '/':
                    searchMode = true;
                    searchTerm = '';
                    process.stdout.write('\r\x1b[K\x1b[90m搜索: \x1b[0m');
                    break;
                default:
                    // 空格翻页
                    if (_str === ' ') {
                        if (currentPage < totalPages - 1) {
                            currentPage++;
                            renderPage();
                        }
                    }
                    break;
            }
        });

        rl.on('close', () => {
            // 恢复终端原始模式
            if (rawModeSet) {
                try { process.stdin.setRawMode(false); } catch { /* ignore */ }
            }
            resolve();
        });
    });
}
