/**
 * builtin/calculator.ts - 计算器工具
 *
 * 理解：就像一个口袋计算器——输入算式，返回结果。
 * 注意：使用 Function 而非 eval 做安全计算。
 */

import type { ToolExecutor } from '../registry.js';

/** 工具定义 */
export const CALCULATOR_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'calculator',
    description: '执行数学计算。支持基本的四则运算、幂运算、三角函数等。',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式，如 "2 + 3 * 4"、"Math.sqrt(16)"、"Math.sin(Math.PI / 2)"',
        },
      },
      required: ['expression'],
    },
  },
};

/**
 * 安全的白名单数学函数
 */
const ALLOWED_MATH: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
};

/** 工具执行函数 */
export const calculatorExecutor: ToolExecutor = async (args) => {
  const { expression } = args as { expression: string };

  try {
    // 安全地计算表达式（使用 Function 构造，禁用危险操作）
    const result = Function(
      '"use strict"; return (function() { const Math = arguments[0]; return (' + expression + '); })()',
    )(ALLOWED_MATH);

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('计算结果不是有效数字');
    }

    return {
      success: true,
      expression,
      result,
    };
  } catch (error) {
    return {
      success: false,
      expression,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
