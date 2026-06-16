/**
 * 日志工具模块
 * 
 * 职责：
 * 1. 提供分级日志输出（info/success/warn/error/debug）
 * 2. Spinner 进度指示器
 * 3. 进度条渲染
 * 4. 交互式选择列表
 * 
 * 扩展方式：
 * - 添加新的日志级别
 * - 支持写入文件
 * - 支持 JSON 格式输出（CI 环境）
 */

import ora from 'ora';
import pc from 'picocolors';

// ============ 1. 分级日志 ============
export const logger = {
    info: (msg: string) => console.log(pc.blue('ℹ') + ' ' + msg),
    success: (msg: string) => console.log(pc.green('✅') + ' ' + msg),
    warn: (msg: string) => console.log(pc.yellow('⚠️') + ' ' + msg),
    error: (msg: string) => console.log(pc.red('❌') + ' ' + msg),
    debug: (msg: string, verbose: boolean = false) => {
        if (verbose) console.log(pc.gray('🔍') + ' ' + msg);
    },
};

// ============ 2. Spinner ============
export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
    const spinner = ora(pc.blue(text)).start();
    try {
        const result = await fn();
        spinner.succeed(pc.green(text));
        return result;
    } catch (error) {
        spinner.fail(pc.red(text));
        throw error;
    }
}