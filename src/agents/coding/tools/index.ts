import * as readFile from './read-file';
import * as writeFile from './write-file';
import * as listDirectory from './list-directory';
import * as executeCommand from './execute-command';
import * as searchCode from './search-code';

/**
 * 所有 coding 工具的集合
 * readonly: true  → 只读工具，Plan 模式下也允许使用（读文件、搜索等）
 * readonly: false → 写操作工具，Plan 模式下隐藏，Agent 无法调用
 */
export const ALL_CODING_TOOLS = [
  { def: readFile.definition,       impl: readFile.implementation,       readonly: true  },
  { def: writeFile.definition,      impl: writeFile.implementation,      readonly: false },
  { def: listDirectory.definition,  impl: listDirectory.implementation,  readonly: true  },
  { def: executeCommand.definition, impl: executeCommand.implementation, readonly: false },
  { def: searchCode.definition,     impl: searchCode.implementation,     readonly: true  },
];

// 也单独导出，方便按需引用
export { readFile, writeFile, listDirectory, executeCommand, searchCode };
