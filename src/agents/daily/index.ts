import { Agent } from '../../agent/agent';
import { DashScopeClient } from '../../llm/client';
import { ALL_DAILY_TOOLS } from './tools';

/**
 * DailyAgent 工厂函数
 * 创建一个专注于日常任务的子 Agent 实例（无状态，每次调用新建）
 *
 * @param client     LLM 客户端
 * @param callbacks  可选：工具调用/结果的 TUI 回调，供主 Agent 界面展示
 */
export function createDailyAgent(
  client: DashScopeClient,
  callbacks?: {
    onToolCall?: (name: string, args: any) => void;
    onToolResult?: (name: string, result: string) => void;
  },
): Agent {
  const agent = new Agent({
    client,
    systemPrompt: `你是一个日常任务助手，擅长帮用户完成各种日常工作。
你可以：
- 打开 macOS 应用程序（QQ音乐、微信、Safari 等）
- 在浏览器中打开网址或搜索关键词
- 执行 shell 命令（查询系统信息、操作文件等）
- 直接回答用户的问题（知识问答、命令查询等）

请根据用户的需求选择合适的工具或直接回答。对于知识性问题（如"Mac 上列出文件的命令"），
可以直接回答，无需调用工具。`,
    onToolCall: callbacks?.onToolCall,
    onToolResult: callbacks?.onToolResult,
  });

  // 注册所有 daily 工具
  ALL_DAILY_TOOLS.forEach(({ def, impl }) =>
    agent.registerTool(def, impl),
  );

  return agent;
}
