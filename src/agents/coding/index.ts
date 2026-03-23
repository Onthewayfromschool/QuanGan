import { Agent } from '../../agent/agent';
import { DashScopeClient } from '../../llm/client';
import { createAllCodingTools } from './tools';

/**
 * CodingAgent 工厂函数
 * 创建一个专注于代码任务的子 Agent 实例（无状态，每次调用新建）
 *
 * @param client     LLM 客户端
 * @param workDir    当前工作目录，注入到系统提示中
 * @param callbacks  可选：工具调用/结果的 TUI 回调，以及路径安全守卫的 confirm 函数
 */
export function createCodingAgent(
  client: DashScopeClient,
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

  // 使用工厂函数创建工具集，注入 workDir 和 confirm 回调
  const tools = createAllCodingTools(workDir, callbacks?.confirm);
  tools.forEach(({ def, impl, readonly }) =>
    agent.registerTool(def, impl, readonly),
  );

  return agent;
}

