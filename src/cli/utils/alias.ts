/**
 * 命令别名模块
 *
 * 职责：
 * 1. 为 CLI 命令提供简写别名
 * 2. 支持别名自动展开
 *
 * 使用方式：
 *   import { expandAlias } from './utils/alias.js';
 *   const args = expandAlias(process.argv.slice(2));
 *
 *   // 用户输入: agent cfg list
 *   // 实际执行: agent config list
 */

/** 别名映射表 */
const ALIAS_MAP: Record<string, string> = {
    'cfg': 'config',
    'cfg:set': 'config set',
    'cfg:get': 'config get',
    'cfg:list': 'config list',
    'q': 'ask',
    'query': 'ask',
};

/**
 * 获取别名映射表的只读副本
 */
export function getAliasMap(): Readonly<Record<string, string>> {
    return { ...ALIAS_MAP };
}

/**
 * 展开别名：如果输入匹配别名，返回展开后的命令数组
 *
 * 与 Commander 解耦：在解析前预处理 argv，避免修改 Commander 内部状态
 *
 * @param args - 原始命令行参数（不含 node 和 script 路径）
 * @returns 展开后的参数数组，或原始数组（如果不是别名）
 *
 * @example
 *   expandAlias(['cfg', 'list'])        // → ['config', 'list']
 *   expandAlias(['q', 'hello'])         // → ['ask', 'hello']
 *   expandAlias(['unknown-cmd', 'arg']) // → ['unknown-cmd', 'arg']
 */
export function expandAlias(args: string[]): string[] {
    if (args.length > 0 && args[0] in ALIAS_MAP) {
        const alias = args[0];
        const realCmd = ALIAS_MAP[alias];
        return [...realCmd.split(' '), ...args.slice(1)];
    }
    return args;
}
