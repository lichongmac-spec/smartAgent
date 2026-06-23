/**
 * builtin/write-file.ts - 写入文件工具
 *
 * 理解：就像在纸上写字——把内容写进文件
 */

import type { ToolExecutor } from '../registry.js';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/** 工具定义 */
export const WRITE_FILE_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description: '写入文件内容。可以覆盖写入或追加内容。如果目录不存在会自动创建。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径',
        },
        content: {
          type: 'string',
          description: '要写入的内容',
        },
        mode: {
          type: 'string',
          description: '写入模式：overwrite（覆盖，默认）或 append（追加）',
          enum: ['overwrite', 'append'],
          default: 'overwrite',
        },
      },
      required: ['path', 'content'],
    },
  },
};

/** 工具执行函数 */
export const writeFileExecutor: ToolExecutor = async (args) => {
  const { path, content } = args as { path: string; content: string };
  const mode = (args as { mode?: string }).mode ?? 'overwrite';

  try {
    // 确保目录存在
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });

    if (mode === 'append') {
      appendFileSync(path, content, 'utf-8');
    } else {
      writeFileSync(path, content, 'utf-8');
    }

    return {
      success: true,
      path,
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
      mode,
    };
  } catch (error) {
    return {
      success: false,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
