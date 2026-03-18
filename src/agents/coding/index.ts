import { Agent } from '../../agent/agent';
import { DashScopeClient } from '../../llm/client';
import { ALL_CODING_TOOLS } from './tools';

/**
 * CodingAgent 工厂函数
 * 创建一个专注于代码任务的子 Agent 实例（无状态，每次调用新建）
 *
 * @param client     LLM 客户端
 * @param workDir    当前工作目录，注入到系统提示中
 * @param callbacks  可选：工具调用/结果的 TUI 回调，供主 Agent 界面展示
 */
export function createCodingAgent(
  client: DashScopeClient,
  workDir: string,
  callbacks?: {
    onToolCall?: (name: string, args: any) => void;
    onToolResult?: (name: string, result: string) => void;
  },
): Agent {
  const agent = new Agent({
    client,
    systemPrompt: `你是一个专业的 Coding Agent，负责代码相关任务。
你可以帮助用户阅读、创建、修改代码文件，执行命令，搜索代码等。
在回答时请保持简洁清晰。当需要操作文件或执行命令时，直接使用工具完成，无需反复确认。
当前工作目录: ${workDir}`,
    onToolCall: callbacks?.onToolCall,
    onToolResult: callbacks?.onToolResult,
  });

  // 注册所有 coding 工具（readonly 标记决定 Plan 模式下是否可用）
  ALL_CODING_TOOLS.forEach(({ def, impl, readonly }) =>
    agent.registerTool(def, impl, readonly),
  );

  return agent;
}
