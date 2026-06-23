/**
 * builtin/write-file.ts - 写入文件工具（带沙箱安全校验）
 *
 * 理解：就像在纸上写字——只能写在自己本子上，不能乱涂别人的东西
 */

import type { ToolExecutor } from '../registry.js';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveSandboxPath, SANDBOX_ERROR } from '../sandbox.js';

/** 工具定义 */
export const WRITE_FILE_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description: '在工作目录内写入文件。可以覆盖写入或追加内容。目录不存在会自动创建。只能在工作目录内创建和修改文件。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于工作目录）',
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

  // 沙箱安全工作目录校验
  const sandbox = resolveSandboxPath(path as string, 'write');
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
    // 确保目录存在
    const dir = dirname(safePath);
    mkdirSync(dir, { recursive: true });

    if (mode === 'append') {
      appendFileSync(safePath, content, 'utf-8');
    } else {
      writeFileSync(safePath, content, 'utf-8');
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
