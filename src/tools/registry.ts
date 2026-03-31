/**
 * 全局工具注册表
 *
 * 所有工具（coding + daily）统一在此定义。
 * 每个 Agent 通过 deny list 获取自己的工具子集，而非在代码层面隔离能力。
 *
 * 设计原则（来自 OpenClaw 风格）：
 *   - 工具注册是全局的，权限控制是局部的
 *   - 用黑名单而非白名单：即使路由出错，Agent 最多多几个用不上的工具，不会缺少关键能力
 *   - memory tools 仅主 Agent 专属，不在此注册表中（业务语义不同）
 */

import { ToolDefinition, ToolFunction } from './types.js';

// ── Coding 工具 ──────────────────────────────────────────────────────────────
import * as readFile      from './read-file.js';
import * as writeFile     from './write-file.js';
import * as editFile      from './edit-file.js';
import * as listDirectory from './list-directory.js';
import * as executeCommand from './execute-command.js';
import * as searchCode    from './search-code.js';
import * as verifyCode    from './verify-code.js';
import * as webSearch     from './web-search.js';
import * as readUrl       from './read-url.js';

// ── Daily 工具 ───────────────────────────────────────────────────────────────
import * as openApp        from './open-app.js';
import * as openUrl        from './open-url.js';
import * as runShell       from './run-shell.js';
import * as runApplescript from './run-applescript.js';
import * as browser        from './browser.js';

// ─────────────────────────────────────────────────────────────────────────────

export interface ToolEntry {
  def: ToolDefinition;
  impl: ToolFunction;
  /**
   * true = 只读工具，Plan 模式下也允许调用（读文件、搜索等安全操作）
   * false = 写操作工具，Plan 模式下隐藏
   */
  readonly: boolean;
}

/**
 * 创建全局工具注册表
 *
 * @param workDir   当前工作目录，注入到 execute_command 的路径安全守卫
 * @param confirmFn 当 execute_command 检测到越界路径时，询问用户是否继续
 */
export function createGlobalToolRegistry(
  workDir: string,
  confirmFn?: (msg: string) => Promise<boolean>,
): Map<string, ToolEntry> {
  const registry = new Map<string, ToolEntry>();

  function add(def: ToolDefinition, impl: ToolFunction, readonly = false) {
    registry.set(def.function.name, { def, impl, readonly });
  }

  // ── Coding 工具 ────────────────────────────────────────────────────────────
  add(readFile.definition,      readFile.implementation,                                 true);
  add(writeFile.definition,     writeFile.implementation,                                false);
  add(editFile.definition,      editFile.implementation,                                 false);
  add(listDirectory.definition, listDirectory.implementation,                            true);
  add(executeCommand.definition, executeCommand.createImplementation(workDir, confirmFn), false);
  add(searchCode.definition,    searchCode.implementation,                               true);
  add(verifyCode.definition,    verifyCode.implementation,                               false);
  add(webSearch.definition,     webSearch.implementation,                                true);
  add(readUrl.definition,       readUrl.implementation,                                  true);

  // ── Daily 工具 ─────────────────────────────────────────────────────────────
  add(openApp.definition,        openApp.implementation,        false);
  add(openUrl.definition,        openUrl.implementation,        false);
  add(runShell.definition,       runShell.implementation,       false);
  add(runApplescript.definition, runApplescript.implementation, false);
  add(browser.definition,        browser.implementation,        false);

  return registry;
}

// ─── 预定义 deny list 常量，方便各 Agent 引用 ────────────────────────────────

/**
 * Coding Agent 黑名单：排除所有系统/UI 操控类工具
 * 即使路由偏差，Coding Agent 仍能使用 web_search / read_url 等检索工具
 */
export const CODING_AGENT_DENY = new Set([
  'open_app',
  'open_url',
  'run_shell',
  'run_applescript',
  'browser_action',
]);

/**
 * Daily Agent 黑名单：排除代码写入/编译验证类工具
 * Daily Agent 现在可以直接使用 web_search / read_url，无需转发给 coding_agent
 */
export const DAILY_AGENT_DENY = new Set([
  'write_file',
  'edit_file',
  'verify_code',
  'search_code',
  'execute_command',
]);

/**
 * 从注册表中过滤掉 deny list 并注册到 Agent
 */
export function registerWithDenyList(
  registry: Map<string, ToolEntry>,
  denyList: Set<string>,
  registerFn: (def: ToolDefinition, impl: ToolFunction, readonly: boolean) => void,
) {
  registry.forEach(({ def, impl, readonly }, name) => {
    if (!denyList.has(name)) {
      registerFn(def, impl, readonly);
    }
  });
}
