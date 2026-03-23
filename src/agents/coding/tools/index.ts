import * as readFile from './read-file';
import * as writeFile from './write-file';
import * as editFile from './edit-file';
import * as listDirectory from './list-directory';
import * as executeCommand from './execute-command';
import * as searchCode from './search-code';
import * as verifyCode from './verify-code';

/**
 * 工厂函数：创建完整的 coding 工具集
 * @param workDir   项目根目录，用于 execute_command 的路径安全守卫
 * @param confirmFn 当 execute_command 检测到越界路径时，调用此函数询问用户
 */
export function createAllCodingTools(
  workDir: string,
  confirmFn?: (msg: string) => Promise<boolean>,
) {
  return [
    { def: readFile.definition,       impl: readFile.implementation,                              readonly: true  },
    { def: writeFile.definition,      impl: writeFile.implementation,                             readonly: false },
    { def: editFile.definition,       impl: editFile.implementation,                              readonly: false },
    { def: listDirectory.definition,  impl: listDirectory.implementation,                         readonly: true  },
    { def: executeCommand.definition, impl: executeCommand.createImplementation(workDir, confirmFn), readonly: false },
    { def: searchCode.definition,     impl: searchCode.implementation,                            readonly: true  },
    { def: verifyCode.definition,     impl: verifyCode.implementation,                            readonly: false },
  ];
}

/**
 * 静态默认工具集（无路径守卫，兼容旧用法 / 示例代码）
 * readonly: true  → 只读工具，Plan 模式下也允许使用（读文件、搜索等）
 * readonly: false → 写操作工具，Plan 模式下隐藏，Agent 无法调用
 */
export const ALL_CODING_TOOLS = createAllCodingTools(process.cwd());

// 也单独导出，方便按需引用
export { readFile, writeFile, editFile, listDirectory, executeCommand, searchCode, verifyCode };

