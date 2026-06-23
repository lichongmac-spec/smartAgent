/**
 * builtin/read-file.ts - 读取文件工具
 *
 * 理解：就像打开书本看内容
 */

import type { ToolExecutor } from '../registry.js';
import { readFileSync } from 'fs';

/** 工具定义 */
export const READ_FILE_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: '读取文件内容。支持指定行范围和编码。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（绝对路径或相对于工作目录的路径）',
        },
        encoding: {
          type: 'string',
          description: '文件编码，默认 utf-8',
          default: 'utf-8',
        },
        startLine: {
          type: 'number',
          description: '起始行号（从 1 开始），不指定则从头读取',
        },
        endLine: {
          type: 'number',
          description: '结束行号（包含），不指定则读取到末尾',
        },
      },
      required: ['path'],
    },
  },
};

/** 工具执行函数 */
export const readFileExecutor: ToolExecutor = async (args) => {
  const { path } = args as { path: string; encoding?: string; startLine?: number; endLine?: number };
  const encoding = (args as { encoding?: string }).encoding ?? 'utf-8';

  try {
    let content = readFileSync(path, encoding as BufferEncoding);

    // 处理行范围
    const startLine = (args as { startLine?: number }).startLine;
    const endLine = (args as { endLine?: number }).endLine;
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = (startLine ?? 1) - 1;
      const end = endLine ?? lines.length;
      content = lines.slice(start, end).join('\n');
    }

    // 限制最大返回字符数
    const maxChars = 8000;
    const truncated = content.length > maxChars;
    if (truncated) {
      content = content.slice(0, maxChars);
    }

    return {
      success: true,
      path,
      content,
      size: content.length,
      truncated,
      ...(truncated && { message: `内容已截断，仅显示前 ${maxChars} 字符` }),
    };
  } catch (error) {
    return {
      success: false,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
