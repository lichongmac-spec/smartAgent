/**
 * sandbox.ts - 工具沙箱安全校验
 *
 * 理解：就像给 AI 的操作加了一个"安全围栏"——它只能访问指定的目录，
 * 不能越界读取 /etc/passwd 或写入 ~/.ssh/authorized_keys。
 *
 * 使用方式：
 *   import { resolveSandboxPath, SANDBOX_ERROR } from './sandbox.js';
 *   const resolved = resolveSandboxPath('/some/input/path');
 */

import { resolve, normalize, relative } from 'path';
import { existsSync, statSync } from 'fs';
import { tmpdir } from 'os';

// ============================================================
//  沙箱配置
// ============================================================

/**
 * 沙箱允许的根目录列表。
 *
 * 按优先级排列，第一个匹配的目录将作为沙箱根。
 * 可通过 SANDBOX_ROOTS 环境变量覆盖（逗号分隔）。
 */
function getSandboxRoots(): string[] {
  const envRoots = process.env.SANDBOX_ROOTS;
  if (envRoots) {
    return envRoots.split(',').map((r) => resolve(r.trim())).filter(Boolean);
  }
  return [
    process.cwd(),                         // 当前工作目录（项目根）
    resolve(process.cwd(), 'test-sandbox'), // 测试沙箱目录
    resolve(process.cwd(), 'test-output'),  // 测试输出目录
  ];
}

/**
 * 禁止访问的路径模式（绝对路径黑名单）
 */
const BLOCKED_PATHS: RegExp[] = [
  /^\/etc\//,        // 系统配置
  /^\/etc$/,          // 系统配置根
  /^\/System\//,      // macOS 系统
  /^\/System$/,       // macOS 系统根
  /^\/Library\//,     // macOS 库
  /^\/Library$/,      // macOS 库根
  /^\/\.Trash\//,     // 回收站
  /\/\.ssh\//,        // SSH 密钥
  /\/\.aws\//,        // AWS 凭证
  /\/\.git\/config$/, // Git 配置（允许读写 .git 目录内容）
  /\/node_modules\//, // 避免意外修改依赖
];

/**
 * 允许访问的敏感文件模式（白名单，优先级高于黑名单）。
 *
 * 例如：允许读取 .git/config 但不能修改（由 write-file 单独控制）。
 * 当前为空，如有需要可扩展。
 */
const ALLOWED_OVERRIDES: RegExp[] = [];

// ============================================================
//  沙箱错误常量
// ============================================================

export const SANDBOX_ERROR = {
  PATH_TRAVERSAL: 'SANDBOX_PATH_TRAVERSAL',
  BLOCKED_PATH: 'SANDBOX_BLOCKED_PATH',
  NOT_FOUND: 'SANDBOX_NOT_FOUND',
  NOT_A_FILE: 'SANDBOX_NOT_A_FILE',
  WRITE_DENIED: 'SANDBOX_WRITE_DENIED',
} as const;

// ============================================================
//  核心校验
// ============================================================

/**
 * 沙箱路径解析结果
 */
export interface SandboxResult {
  /** 是否通过安全校验 */
  allowed: boolean;
  /** 解析后的绝对路径（仅 allowed=true 时有值） */
  resolvedPath?: string;
  /** 拒绝原因代码（仅 allowed=false 时有值） */
  code?: string;
  /** 拒绝原因描述 */
  message?: string;
}

/**
 * 校验并解析沙箱内的路径
 *
 * 校验规则：
 *   1. 输入路径不能为空
 *   2. 不能包含路径穿越（如 ../../../etc/passwd）
 *   3. 必须在沙箱根目录内
 *   4. 不能命中黑名单路径
 *   5. read 模式需要文件存在
 *
 * @param inputPath - 用户/AI 提供的路径
 * @param mode - 'read' 或 'write'
 * @returns 校验结果
 */
export function resolveSandboxPath(
  inputPath: string,
  mode: 'read' | 'write' = 'read',
): SandboxResult {
  // 1. 空路径检查
  if (!inputPath || inputPath.trim() === '') {
    return { allowed: false, code: SANDBOX_ERROR.NOT_FOUND, message: '路径不能为空' };
  }

  // 2. 路径穿越检查（在解析之前）
  if (inputPath.includes('..')) {
    // 特殊：允许以 ./ 或 ../ 开头的相对路径（后续会解析验证）
    // 但如果包含 /../ 则直接拒绝
    if (inputPath.includes('/../') || inputPath.startsWith('../') || inputPath === '..') {
      return {
        allowed: false,
        code: SANDBOX_ERROR.PATH_TRAVERSAL,
        message: `禁止路径穿越操作: "${inputPath}"`,
      };
    }
  }

  // 3. 解析为绝对路径
  const sandboxRoots = getSandboxRoots();
  let resolved = resolve(inputPath);

  // 归一化后再次检查（resolve 可能还原 ../ ）
  let bestRoot: string | null = null;
  for (const root of sandboxRoots) {
    const rel = relative(root, resolved);
    if (!rel.startsWith('..') && !resolve(rel).startsWith('..')) {
      bestRoot = root;
      break;
    }
  }

  // 相对路径：尝试在第一个沙箱根下解析
  if (!bestRoot && !resolve(inputPath).startsWith('/')) {
    // 检查是否是相对路径，尝试逐个沙箱根匹配
    for (const root of sandboxRoots) {
      const candidate = resolve(root, inputPath);
      const rel = relative(root, candidate);
      if (!rel.startsWith('..')) {
        bestRoot = root;
        resolved = candidate;
        break;
      }
    }
  }

  if (!bestRoot) {
    return {
      allowed: false,
      code: SANDBOX_ERROR.PATH_TRAVERSAL,
      message: `路径 "${inputPath}" 不在允许的范围内。允许的目录: ${sandboxRoots.join(', ')}`,
    };
  }

  // 4. 黑名单检查
  const normalized = normalize(resolved);
  for (const pattern of BLOCKED_PATHS) {
    if (pattern.test(normalized)) {
      // 检查白名单覆盖
      const allowed = ALLOWED_OVERRIDES.some((a) => a.test(normalized));
      if (!allowed) {
        return {
          allowed: false,
          code: SANDBOX_ERROR.BLOCKED_PATH,
          message: `禁止访问受保护的路径: "${normalized}"`,
        };
      }
    }
  }

  // 5. 写入额外安全检查（不能写入到现有敏感文件）
  if (mode === 'write') {
    try {
      if (existsSync(normalized)) {
        const stat = statSync(normalized);
        if (stat.isDirectory()) {
          return {
            allowed: false,
            code: SANDBOX_ERROR.NOT_A_FILE,
            message: `目标是目录而非文件，无法写入: "${normalized}"`,
          };
        }
      }
    } catch {
      // 文件不存在是可以的（write 模式允许创建新文件）
    }
  }

  // 6. 读取模式：文件必须存在
  if (mode === 'read') {
    try {
      if (!existsSync(normalized)) {
        return {
          allowed: false,
          code: SANDBOX_ERROR.NOT_FOUND,
          message: `文件不存在: "${normalized}"`,
        };
      }
    } catch {
      return {
        allowed: false,
        code: SANDBOX_ERROR.NOT_FOUND,
        message: `无法访问路径: "${normalized}"`,
      };
    }
  }

  return { allowed: true, resolvedPath: normalized };
}
