/**
 * tools/index.ts - 工具系统总入口
 */

export { ToolRegistry, type ToolExecutor, type ToolEntry } from './registry.js';
export {
  READ_FILE_DEFINITION,
  readFileExecutor,
  WRITE_FILE_DEFINITION,
  writeFileExecutor,
  SEARCH_WEB_DEFINITION,
  searchWebExecutor,
  CALCULATOR_DEFINITION,
  calculatorExecutor,
  createDefaultToolRegistry,
} from './builtin/index.js';
