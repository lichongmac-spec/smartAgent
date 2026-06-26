/**
 * builtin/read-file.ts - 读取文件工具（带沙箱安全校验）
 *
 * 理解：就像打开书本看内容，但不能看别人的日记
 */

import type { ToolExecutor } from '../registry.js';
import { readFileSync } from 'fs';
import { resolveSandboxPath } from '../sandbox.js';

/** 工具定义 */
export const READ_FILE_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: '读取工作目录内的文件内容。支持指定行范围和编码。只能读取项目目录内的文件。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于工作目录的路径）',
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

  // 沙箱安全工作目录校验
  const sandbox = resolveSandboxPath(path as string, 'read');
  if (!sandbox.allowed) {
    return {
      success: false,
      path,
      error: sandbox.message,
      code: sandbox.code,
    };
  }

  const safePath = sandbox.resolvedPath!;

  try {
    let content = readFileSync(safePath, encoding as BufferEncoding);

    // 处理行范围
    const startLine = (args as { startLine?: number }).startLine;
    const endLine = (args as { endLine?: number }).endLine;
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = Math.min(endLine ?? lines.length, lines.length);
      content = lines.slice(start, end).join('\n');
    }

    // 限制最大返回字符数（防止超大文件撑爆上下文）
    const maxChars = 8000;
    const truncated = content.length > maxChars;
    if (truncated) {
      content = content.slice(0, maxChars);
    }

    return {
      success: true,
      path,
      size: content.length,
      truncated,
      ...(truncated && { message: `内容已截断，仅显示前 ${maxChars} 字符` }),
      content,
    };
  } catch (error) {
    return {
      success: false,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
