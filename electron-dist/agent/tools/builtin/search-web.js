"use strict";
/**
 * builtin/search-web.ts - 网页搜索工具（模拟）
 *
 * 理解：就像在百度搜索——输入关键词，获取搜索结果。
 * 当前为模拟实现，后续可对接真实搜索 API。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchWebExecutor = exports.SEARCH_WEB_DEFINITION = void 0;
/** 工具定义 */
exports.SEARCH_WEB_DEFINITION = {
    type: 'function',
    function: {
        name: 'search_web',
        description: '搜索网页信息，获取相关结果。用于查询实时信息、百科知识等。',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词',
                },
                limit: {
                    type: 'number',
                    description: '返回结果数量，默认 3',
                    default: 3,
                },
            },
            required: ['query'],
        },
    },
};
/**
 * 模拟搜索结果数据库
 */
const MOCK_WEB_DATA = {
    天气: [
        { title: '北京今日天气', snippet: '北京今天 25°C，晴，适合户外活动。', url: 'https://weather.example.com/beijing' },
        { title: '上海一周天气预报', snippet: '上海未来一周多云为主，气温 22-30°C。', url: 'https://weather.example.com/shanghai' },
    ],
    TypeScript: [
        { title: 'TypeScript 官方文档', snippet: 'TypeScript 是 JavaScript 的超集，添加了静态类型检查。', url: 'https://www.typescriptlang.org/' },
        { title: 'TypeScript 教程', snippet: '本教程将帮助你从零开始学习 TypeScript。', url: 'https://example.com/typescript-tutorial' },
    ],
    React: [
        { title: 'React 官方文档', snippet: 'React 是一个用于构建用户界面的 JavaScript 库。', url: 'https://react.dev/' },
        { title: 'React 入门指南', snippet: '学习如何用 React 构建现代 Web 应用。', url: 'https://example.com/react-guide' },
    ],
    Node: [
        { title: 'Node.js 官网', snippet: 'Node.js 是一个基于 Chrome V8 引擎的 JavaScript 运行时。', url: 'https://nodejs.org/' },
    ],
    人工智能: [
        { title: '什么是人工智能？', snippet: '人工智能（AI）是计算机科学的一个分支，致力于创建能够执行通常需要人类智能的任务的系统。', url: 'https://example.com/ai-intro' },
        { title: 'AI 最新进展', snippet: '2024 年 AI 领域的主要突破包括多模态模型、Agent 系统等。', url: 'https://example.com/ai-news' },
    ],
};
/** 工具执行函数 */
const searchWebExecutor = async (args) => {
    const { query } = args;
    const limit = args.limit ?? 3;
    // 模拟网络延迟
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 搜索匹配的关键词
    let results = [];
    for (const [keyword, data] of Object.entries(MOCK_WEB_DATA)) {
        if (query.includes(keyword) || keyword.includes(query)) {
            results = results.concat(data);
        }
    }
    // 如果没有精确匹配，返回通用结果
    if (results.length === 0) {
        results = [
            {
                title: `关于 "${query}" 的搜索结果`,
                snippet: `这是关于 ${query} 的模拟搜索结果。在实际使用中，这里会显示真实的网页信息。`,
                url: `https://example.com/search?q=${encodeURIComponent(query)}`,
            },
        ];
    }
    // 限制返回数量
    results = results.slice(0, limit);
    return {
        success: true,
        query,
        totalResults: results.length,
        results,
    };
};
exports.searchWebExecutor = searchWebExecutor;
//# sourceMappingURL=search-web.js.map