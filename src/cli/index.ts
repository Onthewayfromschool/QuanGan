import dotenv from 'dotenv';
import path from 'path';
// 固定从 Agent 项目自身目录加载 .env，切换工作目录不会影响 Key 读取
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import * as readline from 'readline';
import { loadConfigFromEnv, getModelContextLimit } from '../config/llm-config';
import { DashScopeClient } from '../llm/client';
import { Agent } from '../agent/agent';
import { ToolDefinition } from '../tools/types';
import {
  printHeader,
  printSystem,
  printHelp,
  printUserMessage,
  printAssistantMessage,
  printToolCall,
  printToolResult,
  printToolList,
  printHistory,
  printDivider,
  printError,
  printModeSwitch,
  printTokenUsage,
  createSpinner,
} from './display';
import { createCodingAgent } from '../agents/coding';
import { createDailyAgent } from '../agents/daily';
import { ALL_CODING_TOOLS } from '../agents/coding/tools';
import { ALL_DAILY_TOOLS } from '../agents/daily/tools';
import { loadSession, saveSession, clearSession } from './session-store';

// ─── 初始化 ───────────────────────────────────────────────────────────────────

const config = loadConfigFromEnv();
const client = new DashScopeClient(config);
const MODEL_MAX_TOKENS = getModelContextLimit(config.model);
const CWD = process.cwd();

// 子 Agent 工具调用的 TUI 回调（复用主界面的 display 函数）
const subAgentCallbacks = {
  onToolCall: (name: string, args: any) => printToolCall(name, args),
  onToolResult: (_name: string, result: string) => printToolResult(result),
};

// ─── 工具定义：子 Agent 作为主 Agent 的两个工具 ──────────────────────────────

const codingAgentToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'coding_agent',
    description: '调用 Coding Agent 完成代码相关任务，例如：阅读/修改/创建代码文件、执行命令、搜索代码、调试程序等',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '要完成的代码任务，请尽量详细描述需求和背景',
        },
      },
      required: ['task'],
    },
  },
};

const dailyAgentToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'daily_agent',
    description: '调用 Daily Agent 完成日常任务，例如：打开应用、打开网址/搜索、执行系统命令、回答知识性问题等',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '要完成的日常任务，请尽量详细描述需求',
        },
      },
      required: ['task'],
    },
  },
};

// ─── 主 Agent：全干哥 ─────────────────────────────────────────────────────────

const agent = new Agent({
  client,
  systemPrompt: `你是全干哥（QuanGanGe），一个全能智能助手。
你拥有两个专属子 Agent，可以通过工具调用来完成不同类型的任务：
- coding_agent：处理所有代码相关任务（读写文件、执行命令、代码搜索等）
- daily_agent：处理日常任务（打开应用、网页搜索、系统命令、知识问答等）

当用户提出需求时，分析任务类型并调用合适的子 Agent 完成任务。
如果任务涉及多个领域，可以依次调用多个子 Agent。
对于简单的聊天或问候，可以直接回答，无需调用子 Agent。
当前工作目录: ${CWD}`,
  onToolCall: (name, args) => {
    // 子 Agent 被调用时，展示路由信息
    if (name === 'coding_agent' || name === 'daily_agent') {
      const label = name === 'coding_agent' ? '💻 Coding Agent' : '🌟 Daily Agent';
      printToolCall(`${label} ← 路由到`, { task: args.task });
    } else {
      printToolCall(name, args);
    }
  },
  onToolResult: (_name, result) => {
    printToolResult(result);
  },
  onCompressStart: () => {
    process.stdout.write(`\n  ${'\x1b[33m'}⏳ 上下文过长，正在压缩历史对话...${'\x1b[0m'}`);
  },
  onCompress: (before, after) => {
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
    printSystem(`♻️  上下文已自动压缩（${before} → ${after} 条消息），旧对话已生成摘要保留`);
  },
});

// 注册 coding_agent 工具：每次调用新建 CodingAgent 实例（无状态）
agent.registerTool(codingAgentToolDef, async (args: { task: string }) => {
  const codingAgent = createCodingAgent(client, CWD, subAgentCallbacks);
  return await codingAgent.run(args.task);
});

// 注册 daily_agent 工具：每次调用新建 DailyAgent 实例（无状态）
agent.registerTool(dailyAgentToolDef, async (args: { task: string }) => {
  const dailyAgent = createDailyAgent(client, subAgentCallbacks);
  return await dailyAgent.run(args.task);
});

// ─── 会话恢复 ─────────────────────────────────────────────────────────────────

const previousMessages = loadSession(CWD);
if (previousMessages.length > 0) {
  agent.loadMessages(previousMessages);
}

// ─── 命令处理 ─────────────────────────────────────────────────────────────────

// Plan 模式标志：true 时 Agent 只规划不执行工具
let isPlanMode = false;

// readline 实例（在 handleCommand 中需要访问以更新 prompt）
let rlInstance: ReturnType<typeof readline.createInterface> | null = null;

function updatePrompt() {
  if (!rlInstance) return;
  const prompt = isPlanMode
    ? '\x1b[33m[PLAN] >\x1b[0m '   // 黄色 [PLAN] > 提示符
    : '\x1b[32m>\x1b[0m ';          // 绿色 > 提示符
  rlInstance.setPrompt(prompt);
  rlInstance.prompt();
}

function handleCommand(cmd: string): boolean {
  switch (cmd.trim()) {
    case '/help':
      printHelp();
      return true;
    case '/clear':
      agent.clearHistory();
      clearSession(CWD);
      console.clear();
      printHeader(config.model);
      printSystem('对话历史已清空，重新开始！');
      return true;
    case '/history':
      printHistory(agent.getHistory());
      return true;
    case '/tools': {
      const codingNames = ALL_CODING_TOOLS.map(t => `  [coding] ${t.def.function.name}`);
      const dailyNames  = ALL_DAILY_TOOLS.map(t  => `  [daily]  ${t.def.function.name}`);
      printToolList([...codingNames, ...dailyNames]);
      return true;
    }
    case '/plan':
      isPlanMode = true;
      printModeSwitch(true);
      updatePrompt();
      return true;
    case '/exec':
      isPlanMode = false;
      printModeSwitch(false);
      updatePrompt();
      return true;
    case '/exit':
    case '/quit':
      printDivider();
      printSystem('再见！👋');
      process.exit(0);
    default:
      printError(`未知命令: ${cmd}，输入 /help 查看命令列表`);
      return true;
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

async function main() {
  // 打印欢迎界面
  printHeader(config.model);
  printSystem('全干哥（QuanGanGe）已就绪！');
  printSystem(`工作目录: ${CWD}`);
  printSystem('子 Agent：💻 Coding Agent | 🌟 Daily Agent');
  if (previousMessages.length > 0) {
    const userCount = previousMessages.filter((m: any) => m.role === 'user').length;
    printSystem(`已恢复上次会话（${userCount} 轮对话），输入 /clear 可重新开始`);
    printHistory(agent.getHistory());
  }
  printSystem('输入消息开始对话，/help 查看命令\n');

  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[32m>\x1b[0m ',
    terminal: true,
  });
  rlInstance = rl;

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();

    // 空行忽略
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // 处理命令
    if (trimmed.startsWith('/')) {
      handleCommand(trimmed);
      rl.prompt();
      return;
    }

    // 打印用户消息
    printUserMessage(trimmed);

    // Plan 模式下在用户消息前注入规划指令，引导 LLM 输出结构化计划
    const messageToSend = isPlanMode
      ? `[当前处于规划模式，你只能使用只读工具分析代码，禁止修改任何文件]

请按以下步骤完成任务：
1. 使用只读工具（read_file、list_directory、search_code）充分分析相关代码和文件
2. 分析完成后，输出一份清晰的执行计划，格式如下：

📋 执行计划
Step 1: [具体操作描述]
Step 2: [具体操作描述]
...

注意：只输出计划，不要真正修改文件。

用户任务：${trimmed}`
      : trimmed;

    // 暂停输入，显示 spinner
    rl.pause();
    const spinner = createSpinner('Agent 思考中...');

    try {
      const response = await agent.run(messageToSend, isPlanMode);
      spinner.stop();
      printAssistantMessage(response);
      // 展示 token 用量进度条
      const usage = agent.getTokenUsage();
      printTokenUsage(usage.total, MODEL_MAX_TOKENS);
      // 每次回复后自动保存（完整历史含 _archived 标记）
      saveSession(CWD, agent.getHistory());
    } catch (e: any) {
      spinner.stop();
      printError(`调用失败: ${e.message}`);
    }

    // 恢复输入
    rl.resume();
    console.log('');
    rl.prompt();
  });

  // Ctrl+C 优雅退出
  rl.on('close', () => {
    printDivider();
    printSystem('再见！👋');
    process.exit(0);
  });

  // 未捕获异常
  process.on('uncaughtException', (e) => {
    printError(`未捕获异常: ${e.message}`);
    rl.prompt();
  });
}

main();
