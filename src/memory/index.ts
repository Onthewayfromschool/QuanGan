import { DashScopeClient } from '../llm/client';
import {
  recallMemoryDef,
  updateLifeMemoryDef,
  consolidateCoreMemoryDef,
  createMemoryToolImpls,
} from './tools';

export { getCoreMemory, appendLifeMemory, getRecentLifeMemories } from './memory-store';
export type { CoreMemoryData, CoreMemoryItem } from './memory-store';
export { createMemoryToolImpls } from './tools';

/**
 * 创建所有记忆工具（供主 Agent 注册）
 * @param client LLM 客户端（consolidate 工具需要调用 LLM）
 * @param cwd 项目目录（记忆文件存储位置）
 */
export function createMemoryTools(client: DashScopeClient, cwd: string) {
  const { recallImpl, updateLifeImpl, consolidateImpl } = createMemoryToolImpls(client, cwd);
  return [
    { def: recallMemoryDef,         impl: recallImpl,      readonly: true  },
    { def: updateLifeMemoryDef,     impl: updateLifeImpl,  readonly: false },
    { def: consolidateCoreMemoryDef, impl: consolidateImpl, readonly: false },
  ];
}
