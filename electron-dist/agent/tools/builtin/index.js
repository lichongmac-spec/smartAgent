"use strict";
/**
 * builtin/index.ts - 内置工具集合
 *
 * 理解：一次性把所有工具打包好，方便注册
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatorExecutor = exports.CALCULATOR_DEFINITION = exports.searchWebExecutor = exports.SEARCH_WEB_DEFINITION = exports.writeFileExecutor = exports.WRITE_FILE_DEFINITION = exports.readFileExecutor = exports.READ_FILE_DEFINITION = void 0;
exports.createDefaultToolRegistry = createDefaultToolRegistry;
var read_file_js_1 = require("./read-file.js");
Object.defineProperty(exports, "READ_FILE_DEFINITION", { enumerable: true, get: function () { return read_file_js_1.READ_FILE_DEFINITION; } });
Object.defineProperty(exports, "readFileExecutor", { enumerable: true, get: function () { return read_file_js_1.readFileExecutor; } });
var write_file_js_1 = require("./write-file.js");
Object.defineProperty(exports, "WRITE_FILE_DEFINITION", { enumerable: true, get: function () { return write_file_js_1.WRITE_FILE_DEFINITION; } });
Object.defineProperty(exports, "writeFileExecutor", { enumerable: true, get: function () { return write_file_js_1.writeFileExecutor; } });
var search_web_js_1 = require("./search-web.js");
Object.defineProperty(exports, "SEARCH_WEB_DEFINITION", { enumerable: true, get: function () { return search_web_js_1.SEARCH_WEB_DEFINITION; } });
Object.defineProperty(exports, "searchWebExecutor", { enumerable: true, get: function () { return search_web_js_1.searchWebExecutor; } });
var calculator_js_1 = require("./calculator.js");
Object.defineProperty(exports, "CALCULATOR_DEFINITION", { enumerable: true, get: function () { return calculator_js_1.CALCULATOR_DEFINITION; } });
Object.defineProperty(exports, "calculatorExecutor", { enumerable: true, get: function () { return calculator_js_1.calculatorExecutor; } });
const registry_js_1 = require("../registry.js");
const read_file_js_2 = require("./read-file.js");
const write_file_js_2 = require("./write-file.js");
const search_web_js_2 = require("./search-web.js");
const calculator_js_2 = require("./calculator.js");
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
function createDefaultToolRegistry(verbose = false) {
    const registry = new registry_js_1.ToolRegistry();
    registry.verbose = verbose;
    registry.register({ definition: read_file_js_2.READ_FILE_DEFINITION, executor: read_file_js_2.readFileExecutor });
    registry.register({ definition: write_file_js_2.WRITE_FILE_DEFINITION, executor: write_file_js_2.writeFileExecutor });
    registry.register({ definition: search_web_js_2.SEARCH_WEB_DEFINITION, executor: search_web_js_2.searchWebExecutor });
    registry.register({ definition: calculator_js_2.CALCULATOR_DEFINITION, executor: calculator_js_2.calculatorExecutor });
    return registry;
}
//# sourceMappingURL=index.js.map