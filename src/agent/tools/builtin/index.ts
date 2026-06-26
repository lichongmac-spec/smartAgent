/**
 * builtin/index.ts - 内置工具集合
 *
 * 理解：一次性把所有工具打包好，方便注册
 */

export { READ_FILE_DEFINITION, readFileExecutor } from './read-file.js';
export { WRITE_FILE_DEFINITION, writeFileExecutor } from './write-file.js';
export { SEARCH_WEB_DEFINITION, searchWebExecutor } from './search-web.js';
export { CALCULATOR_DEFINITION, calculatorExecutor } from './calculator.js';

import { ToolRegistry } from '../registry.js';
import {
  READ_FILE_DEFINITION,
  readFileExecutor,
} from './read-file.js';
import {
  WRITE_FILE_DEFINITION,
  writeFileExecutor,
} from './write-file.js';
import {
  SEARCH_WEB_DEFINITION,
  searchWebExecutor,
} from './search-web.js';
import {
  CALCULATOR_DEFINITION,
  calculatorExecutor,
} from './calculator.js';

/**
 * 创建包含所有内置工具的注册表
 *
 * 理解：就像打开一个"标配工具箱"——包含所有常用工具
 *
 * @param verbose - 是否打印日志，默认 false（安静模式）
 * @returns 预配置好的 ToolRegistry 实例
 *
 * @example
 *   const registry = createDefaultToolRegistry();
 *   console.log(registry.listNames()); // ['calculator', 'read_file', 'search_web', 'write_file']
 */
export function createDefaultToolRegistry(verbose: boolean = false): ToolRegistry {
  const registry = new ToolRegistry();
  registry.verbose = verbose;

  registry.register({ definition: READ_FILE_DEFINITION, executor: readFileExecutor });
  registry.register({ definition: WRITE_FILE_DEFINITION, executor: writeFileExecutor });
  registry.register({ definition: SEARCH_WEB_DEFINITION, executor: searchWebExecutor });
  registry.register({ definition: CALCULATOR_DEFINITION, executor: calculatorExecutor });

  return registry;
}
