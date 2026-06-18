/**
 * 命令别名模块
 *
 * 职责：
 * 1. 为 CLI 命令提供简写别名
 * 2. 支持别名自动展开
 *
 * 使用方式：
 *   import { registerAliases } from './utils/alias.js';
 *   registerAliases(program);
 *
 *   // 用户输入: agent cfg list
 *   // 实际执行: agent config list
 */

import { Command } from 'commander';

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
 * @param args - 原始参数数组（不含 node 和 script 路径）
 * @returns 展开后的参数数组，或原始数组（如果不是别名）
 */
export function expandAlias(args: string[]): string[] {
    if (args.length > 0 && args[0] in ALIAS_MAP) {
        const alias = args[0];
        const realCmd = ALIAS_MAP[alias];
        return [...realCmd.split(' '), ...args.slice(1)];
    }
    return args;
}

/**
 * 注册命令别名（通过拦截 Commander 的 parse 方法）
 *
 * Commander 不支持原生别名，通过拦截参数实现：
 * - 检查第一个参数是否为别名
 * - 如果是，替换为真实命令
 */
export function registerAliases(program: Command): void {
    // 在解析前拦截参数
    const originalParse = program.parse.bind(program);

    program.parse = function (argv: string[]) {
        // 过滤掉 node 和 script 路径，找到第一个命令行参数
        // Commander 的 parse 会自动处理前两个参数
        const explicitArgs = argv.length > 2 ? argv.slice(2) : [];

        if (explicitArgs.length > 0 && explicitArgs[0] in ALIAS_MAP) {
            const alias = explicitArgs[0];
            const realCmd = ALIAS_MAP[alias];
            const expandedArgs = [...realCmd.split(' '), ...explicitArgs.slice(1)];
            // 替换原参数：保留 node 和 script 路径，替换后面的命令参数
            argv.splice(2, explicitArgs.length, ...expandedArgs);
        }

        return originalParse(argv);
    };
}
