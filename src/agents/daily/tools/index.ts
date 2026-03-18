import * as openApp from './open-app';
import * as openUrl from './open-url';
import * as runShell from './run-shell';

/**
 * 所有 daily 工具的集合
 * Daily Agent 的工具均为可执行操作（无 readonly 区分，不支持 Plan 模式）
 */
export const ALL_DAILY_TOOLS = [
  { def: openApp.definition,   impl: openApp.implementation   },
  { def: openUrl.definition,   impl: openUrl.implementation   },
  { def: runShell.definition,  impl: runShell.implementation  },
];

export { openApp, openUrl, runShell };
