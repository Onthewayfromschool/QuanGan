import { Agent } from '../../agent/agent.js';
import { ILLMClient } from '../../llm/types.js';
import { createGlobalToolRegistry, CODING_AGENT_DENY, registerWithDenyList } from '../../tools/registry.js';

/**
 * CodingAgent 工厂函数
 * 创建一个专注于代码任务的子 Agent 实例（无状态，每次调用新建）
 *
 * 工具策略：从全局注册表中取全集，按 CODING_AGENT_DENY 排除系统/UI 操控类工具。
 * 即使路由偏差，Coding Agent 仍能使用 web_search / read_url 等检索工具。
 *
 * @param client     LLM 客户端
 * @param workDir    当前工作目录，注入到系统提示 + execute_command 路径守卫
 * @param callbacks  可选：工具调用/结果的 TUI 回调，以及路径安全守卫的 confirm 函数
 */
export function createCodingAgent(
    client: ILLMClient,
  workDir: string,
  callbacks?: {
    onToolCall?: (name: string, args: any) => void;
    onToolResult?: (name: string, result: string) => void;
    /** 当 execute_command 检测到路径越界时，调用此函数询问用户是否继续 */
    confirm?: (msg: string) => Promise<boolean>;
  },
): Agent {
  const agent = new Agent({
    client,
    systemPrompt: `你是一个专业的 Coding Agent，负责代码相关任务。
你可以帮助用户阅读、创建、修改代码文件，执行命令，搜索代码等。
在回答时请保持简洁清晰。当需要操作文件或执行命令时，直接使用工具完成，无需反复确认。
修改代码后，可以使用 verify_code 工具对项目做编译检查，发现类型错误后自行修正。
当前工作目录: ${workDir}`,
    onToolCall: callbacks?.onToolCall,
    onToolResult: callbacks?.onToolResult,
  });

  // 从全局注册表取全集，按黑名单排除 UI/系统操控类工具
  const registry = createGlobalToolRegistry(workDir, callbacks?.confirm);
  registerWithDenyList(registry, CODING_AGENT_DENY, (def, impl, readonly) =>
    agent.registerTool(def, impl, readonly),
  );

  return agent;
}

