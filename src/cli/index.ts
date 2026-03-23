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
  printVoiceModeSwitch,
  printRecordingStart,
  printRecordingDone,
  printVoiceTranscribed,
  createSpinner,
} from './display';
import { recordUntilSilence, cleanupAudioFile } from '../voice/recorder';
import { transcribeAudio } from '../voice/asr';
import { speakAsync, stopSpeaking } from '../voice/tts';
import { createCodingAgent } from '../agents/coding';
import { createDailyAgent } from '../agents/daily';
import { ALL_CODING_TOOLS } from '../agents/coding/tools';
import { ALL_DAILY_TOOLS } from '../agents/daily/tools';
import { loadSession, saveSession, clearSession } from './session-store';
import { startCommandPicker } from './command-picker';

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

// ─── 主 Agent：小玉 ─────────────────────────────────────────────────────

const agent = new Agent({
  client,
  systemPrompt: `你叫小玉，是权哥的私人助理。

## 你是谁
你是权哥一手所掋的私人助理，小玉。性格聽明温柔，说话自然随和，不会晃扳。
平日负责帮权哥处理各种事务——无论是技术问题、日常操作、信息查询还是随手聊几句，都能应对。

## 如何介绍自己
如果权哥或其他人问你是谁，这样回答（语气自然随意）：
——“我是小玉，权哥的私人助理。平时帮权哥处理各种大小事，不管是查个东西、操控电脑还是聚在这儿聊天，都行。”
不要大段列举自己会什么工具或能力，那样会很生硬。

## 技能与工作方式
你内部有两个助手，可以通过工具调用完成不同类型的任务：
- coding_agent：处理代码相关任务（读写文件、执行命令、代码搜索等）
- daily_agent：处理日常任务（打开应用、网页搜索、系统命令、知识问答等）

根据权哥的需求分析任务类型并调用合适的助手完成。
如果是简单的聊天或问候，直接回答就好，无需调助手。
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
  const codingAgent = createCodingAgent(client, CWD, {
    ...subAgentCallbacks,
    confirm: makeConfirmFn(),
  });
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
// Voice 模式标志：true 时按 Enter 开始录音，Agent 回复自动 TTS
let isVoiceMode = false;
// Agent 运行中标志（ESC 中断时使用）
let isAgentRunning = false;
// 当前正在运行的 spinner（按 ESC 时需要立即停止并给出反馈）
let currentSpinner: ReturnType<typeof createSpinner> | null = null;

// readline 实例（在 handleCommand 中需要访问以更新 prompt）
let rlInstance: ReturnType<typeof readline.createInterface> | null = null;

/**
 * 路径安全守卫：当 execute_command 检测到越界路径时，在终端询问用户 y/n
 * 通过闭包捕获 rlInstance，在 main() 设置好 rl 之后调用时自动生效
 */
function makeConfirmFn(): (msg: string) => Promise<boolean> {
  return (msg: string) =>
    new Promise(resolve => {
      const rl = rlInstance;
      if (!rl) { resolve(false); return; }

      rl.pause();
      process.stdout.write(
        `\n\x1b[33m⚠️  安全确认\x1b[0m\n${msg}\n\x1b[33m确认执行？\x1b[0m \x1b[1m[y/N]\x1b[0m `,
      );
      process.stdin.once('data', buf => {
        const answer = buf.toString().trim().toLowerCase();
        process.stdout.write('\n');
        rl.resume();
        resolve(answer === 'y' || answer === 'yes');
      });
    });
}

function updatePrompt() {
  if (!rlInstance) return;
  let prompt: string;
  if (isPlanMode) {
    prompt = '\x1b[33m[PLAN] >\x1b[0m ';          // 黄色
  } else if (isVoiceMode) {
    prompt = '\x1b[35m[🎤 VOICE] Enter=录音 >\x1b[0m ';  // 紫色
  } else {
    prompt = '\x1b[32m>\x1b[0m ';                  // 绳色
  }
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
    case '/voice':
      isVoiceMode = !isVoiceMode;
      printVoiceModeSwitch(isVoiceMode);
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

// ─── 公共处理逻辑：文字输入和语音输入共用 ─────────────────────────────────────

/**
 * 将用户消息交给 Agent 处理，并在语音模式下自动朗读回复
 * 文字输入和语音输入共用这一函数，避免重复逻辑
 */
async function processUserMessage(
  text: string,
  rl: ReturnType<typeof readline.createInterface>,
): Promise<void> {
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

用户任务：${text}`
    : text;

  rl.pause();
  process.stdin.resume(); // 保持 stdin 流动，使 ESC 按键事件可以被捕获
  isAgentRunning = true;
  currentSpinner = createSpinner(`Agent 思考中...  \x1b[2m(Esc 可中断)\x1b[0m`);

  try {
    const response = await agent.run(messageToSend, isPlanMode);
    if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
    printAssistantMessage(response);
    // 展示 token 用量进度条
    const usage = agent.getTokenUsage();
    printTokenUsage(usage.total, MODEL_MAX_TOKENS);
    // 每次回复后自动保存（完整历史含 _archived 标记）
    saveSession(CWD, agent.getHistory());
    // 语音模式下自动朗读回复
    if (isVoiceMode) {
      speakAsync(response);
    }
  } catch (e: any) {
    if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
    if (e.message === '⚡ 已中断') {
      printSystem('⚡ 调用已中断，可以继续输入');
    } else {
      printError(`调用失败: ${e.message}`);
    }
  } finally {
    isAgentRunning = false;
  }

  rl.resume();
  console.log('');
  rl.prompt();
}

/**
 * 语音输入处理：录音 → ASR 识别 → 交给 processUserMessage
 */
async function handleVoiceInput(
  rl: ReturnType<typeof readline.createInterface>,
): Promise<void> {
  rl.pause();
  // 开始录音前先停止正在进行的朗读，避免录到自己的声音
  stopSpeaking();
  printRecordingStart();

  let audioFile = '';
  try {
    audioFile = await recordUntilSilence();
  } catch (e: any) {
    printRecordingDone();
    printError(`录音失败: ${e.message}`);
    rl.resume();
    rl.prompt();
    return;
  }

  printRecordingDone();
  const spinner = createSpinner('语音识别中...');

  let text = '';
  try {
    text = await transcribeAudio(audioFile, config.apiKey, config.baseURL);
  } catch (e: any) {
    spinner.stop();
    printError(`ASR 失败: ${e.message}`);
    cleanupAudioFile(audioFile);
    rl.resume();
    rl.prompt();
    return;
  } finally {
    cleanupAudioFile(audioFile);
  }

  spinner.stop();

  if (!text.trim()) {
    printError('未识别到语音，请重试');
    rl.resume();
    rl.prompt();
    return;
  }

  printVoiceTranscribed(text);
  // 复用文字输入的处理流程（含 TTS）
  await processUserMessage(text, rl);
}

async function main() {
  // 打印欢迎界面
  printHeader(config.model);
  printSystem('小玉已就绪！权哥有什么需要尽管说。');
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

  // ── 全局按键监听：ESC 中断 Agent + '/' 唤起命令选择器 ────────────────────
  readline.emitKeypressEvents(process.stdin);
  process.stdin.on('keypress', (str, key) => {
    if (!key) return;

    // 功能 1： ESC 中断当前 Agent 运行
    if (key.name === 'escape' && isAgentRunning) {
      // 立即停止 spinner、展示中断提示
      if (currentSpinner) { currentSpinner.stop(); currentSpinner = null; }
      process.stdout.write('\n');
      printSystem('⚡ 中断中...');
      agent.abort();
      return;
    }

    // 功能 2： '/' 唤起命令选择器（仅当行内只有 '/' 且 Agent 未运行时）
    if (str === '/' && !isAgentRunning && rl.line === '/') {
      startCommandPicker(rl, (cmd) => {
        if (cmd) {
          console.log('');
          handleCommand(cmd);
          rl.prompt();
        } else {
          rl.prompt();
        }
      });
    }
  });

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();

    // 空行：语音模式下触发录音，否则忽略
    if (!trimmed) {
      if (isVoiceMode) {
        await handleVoiceInput(rl);
      } else {
        rl.prompt();
      }
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
    // 交给公共处理函数（文字输入路径）
    await processUserMessage(trimmed, rl);
  });

  // Ctrl+C 优雅退出
  rl.on('close', () => {
    stopSpeaking();  // 退出时立即终止朗读
    printDivider();
    printSystem('再见！👋');
    process.exit(0);
  });

  // 未捕获异常
  // SIGINT (Ctrl+C) 时也确保停止朗读
  process.on('SIGINT', () => {
    stopSpeaking();
    process.exit(0);
  });

  process.on('uncaughtException', (e) => {
    printError(`未捕获异常: ${e.message}`);
    rl.prompt();
  });
}

main();
