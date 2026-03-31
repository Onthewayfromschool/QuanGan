import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';
// .env 文件的绝对路径，供持久化写入使用
const ENV_FILE = path.resolve(import.meta.dirname, '../../.env');
// 固定从 Agent 项目自身目录加载 .env，切换工作目录不会影响 Key 读取
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

import React from 'react';
import { render } from 'ink';
import { loadConfigFromEnv, getModelContextLimit, PROVIDERS } from '../config/llm-config.js';
import { createLLMClient } from '../llm/client.js';
import { Agent } from '../agent/agent.js';
import { ToolDefinition } from '../tools/types.js';
import { createCodingAgent } from '../agents/coding/index.js';
import { createDailyAgent } from '../agents/daily/index.js';
import { createGlobalToolRegistry } from '../tools/registry.js';
import { loadSession, saveSession, clearSession } from './session-store.js';
import { createMemoryTools, getCoreMemory, appendLifeMemory, createMemoryToolImpls, MEMORY_BASE_DIR } from '../memory/index.js';
import { recordUntilSilence, cleanupAudioFile } from '../voice/recorder.js';
import { transcribeAudio } from '../voice/asr.js';
import { speakAsync, stopSpeaking } from '../voice/tts.js';
import { ChatStore, } from './ui/store.js';
import { AppMode, } from './ui/types.js';
import { App, AppCallbacks, setAppRunning, setAppRecording, setAppShowProvider } from './ui/App.js';
import { ProviderItem } from './ui/pickers/ProviderPicker.js';

// ─── 初始化 ───────────────────────────────────────────────────────────────────

let config = loadConfigFromEnv();
let client = await createLLMClient(config);
let MODEL_MAX_TOKENS = getModelContextLimit(config.model);
const CWD = process.cwd();

// ─── Store（UI 桥接层）────────────────────────────────────────────────────────

const store = new ChatStore();

// ─── 记忆系统初始化 ──────────────────────────────────────────────────────────

const _initCoreMemory = getCoreMemory(MEMORY_BASE_DIR);
const _memoryContext =
  _initCoreMemory.memories.length > 0
    ? `\n\n## 你的核心记忆\n${_initCoreMemory.memories.map(m => `- [强度:${m.reinforceCount}] ${m.content}`).join('\n')}`
    : '';

let _lifeMemoryUpdateCount = 0;

// ─── 工具：子 Agent 调用时的 UI 回调 ─────────────────────────────────────────

const subAgentCallbacks = {
  onToolCall: (name: string, args: any) =>
    store.push({ type: 'tool-call', name, args }),
  onToolResult: (_name: string, result: string) =>
    store.push({ type: 'tool-result', name: _name, result }),
};

// ─── 工具定义：子 Agent ───────────────────────────────────────────────────────

const codingAgentToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'coding_agent',
    description: '调用 Coding Agent 完成代码相关任务，例如：阅读/修改/创建代码文件、执行命令、搜索代码、调试程序等。也负责联网搜索信息（web_search）、读取网页内容（read_url）等信息检索任务。',
    parameters: {
      type: 'object',
      properties: { task: { type: 'string', description: '要完成的代码任务，请尽量详细描述需求和背景' } },
      required: ['task'],
    },
  },
};

const dailyAgentToolDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'daily_agent',
    description: '调用 Daily Agent 完成日常任务，例如：打开应用、打开网址、执行系统命令、播放音乐等。⚠️ 注意：联网搜索信息、查找资料、查询文档等信息检索类任务请使用 coding_agent（它有 web_search 和 read_url 工具），不要交给 daily_agent。',
    parameters: {
      type: 'object',
      properties: { task: { type: 'string', description: '要完成的日常任务，请尽量详细描述需求' } },
      required: ['task'],
    },
  },
};

// ─── lifeMemory 异步更新 ─────────────────────────────────────────────────────

async function updateLifeMemoryAsync(): Promise<void> {
  try {
    const history = agent
      .getHistory()
      .filter((m: any) => !m._archived && m.role !== 'system')
      .map((m: any) => {
        const role = m.role === 'user' ? '用户' : 'Agent';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${role}]: ${content.slice(0, 400)}`;
      })
      .join('\n\n');

    if (!history.trim()) return;

    const summary = await client.ask(
      `请将以下对话提炼为简洁的日常记忆摘要（150字以内），重点记录：做了什么、讨论了什么决定、遇到什么问题及如何解决：\n\n${history}`,
      '你是记忆整合助手，请用简洁中文生成摘要。',
    );

    const theme = await client.ask(
      `根据以下摘要，提取一个简短的主题词（3-8字，如"Agent开发"、"音乐播放调试"）：\n\n${summary}`,
      '只输出主题词，不要其他内容。',
    );

    appendLifeMemory(MEMORY_BASE_DIR, theme.trim(), summary);

    _lifeMemoryUpdateCount++;
    if (_lifeMemoryUpdateCount % 3 === 0) {
      const { consolidateImpl } = createMemoryToolImpls(client, MEMORY_BASE_DIR);
      await consolidateImpl();
    }
  } catch {
    // 静默失败，不影响主流程
  }
}

// ─── 主 Agent：小玉 ──────────────────────────────────────────────────────────

const agent = new Agent({
  client,
  systemPrompt: `你叫小玉，是权哥的私人助理。

## 你是谁
你是权哥一手所掋的私人助理，小玉。性格聽明温柔，说话自然随和，不会晃扳。
平日负责帮权哥处理各种事务——无论是技术问题、日常操作、信息查询还是随手聊几句，都能应对。

## 如何介绍自己
如果权哥或其他人问你是谁，这样回答（语气自然随意）：
——"我是小玉，权哥的私人助理。平时帮权哥处理各种大小事，不管是查个东西、操控电脑还是聚在这儿聊天，都行。"
不要大段列举自己会什么工具或能力，那样会很生硬。

## 技能与工作方式
你内部有两个助手，可以通过工具调用完成不同类型的任务：
- coding_agent：处理代码相关任务（读写文件、执行命令、代码搜索等），以及**所有联网信息检索**（web_search 搜索、read_url 读网页）
- daily_agent：处理日常操作（打开应用、打开网址、执行系统命令、播放音乐等）

路由原则（重要）：
- 「查资料」「搜一下」「查询XXX」「找信息」「搜索XXX」等信息检索 → 一律交给 coding_agent
- 「打开XXX」「播放音乐」「执行命令」「关闭XXX」等系统操作 → 交给 daily_agent

根据权哥的需求分析任务类型并调用合适的助手完成。
如果是简单的聊天或问候，直接回答就好，无需调助手。
当前工作目录: ${CWD}

## 记忆使用指南
你拥有 recall_memory 工具可以检索记忆，遇到以下情况时主动调用：
- 问题涉及具体项目、人物、过去的决定
- 权哥说"之前"、"上次"、"你还记得"
- 需要了解权哥偏好才能更好回答
闲聊、简单问答、纯技术问题无需检索记忆。${_memoryContext}`,
  onToolCall: (name, args) => {
    if (name === 'coding_agent' || name === 'daily_agent') {
      const label = name === 'coding_agent' ? '💻 Coding Agent' : '🌟 Daily Agent';
      store.push({ type: 'tool-call', name: `${label} ← 路由到`, args: { task: (args as any).task } });
    } else {
      store.push({ type: 'tool-call', name, args });
    }
  },
  onToolResult: (_name, result) => {
    store.push({ type: 'tool-result', name: _name, result });
  },
  onCompressStart: async () => {
    store.push({ type: 'system', content: '⏳ 上下文过长，正在压缩历史对话...' });
    updateLifeMemoryAsync().catch(() => {});
  },
  onCompress: (before, after) => {
    store.push({ type: 'system', content: `♻️  上下文已自动压缩（${before} → ${after} 条消息），旧对话已生成摘要保留` });
  },
});

// 注册子 Agent 工具
agent.registerTool(codingAgentToolDef, async (args: { task: string }) => {
  const codingAgent = createCodingAgent(client, CWD, {
    ...subAgentCallbacks,
    confirm: (msg: string) => new Promise(resolve => {
      store.push({ type: 'system', content: `⚠️  安全确认: ${msg} (自动拒绝)` });
      resolve(false);
    }),
  });
  return await codingAgent.run(args.task);
});

agent.registerTool(dailyAgentToolDef, async (args: { task: string }) => {
  const dailyAgent = createDailyAgent(client, CWD, subAgentCallbacks);
  return await dailyAgent.run(args.task);
});

// 注册记忆工具
const memoryTools = createMemoryTools(client, MEMORY_BASE_DIR);
memoryTools.forEach(({ def, impl, readonly }) => agent.registerTool(def, impl, readonly));

// ─── 会话恢复 ─────────────────────────────────────────────────────────────────

const previousMessages = loadSession(CWD);
if (previousMessages.length > 0) {
  agent.loadMessages(previousMessages);
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function isValidApiKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.length < 20) return false;
  if (/^(.)\1+$/.test(key)) return false;
  if (/your[_-]?/i.test(key)) return false;
  return true;
}

function persistEnv(key: string, value: string): void {
  try {
    let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.endsWith('\n') ? content + line + '\n' : content + '\n' + line + '\n';
    }
    fs.writeFileSync(ENV_FILE, content, 'utf-8');
  } catch { /* 写入失败静默忽略 */ }
}

async function switchProvider(name: string): Promise<void> {
  const preset = PROVIDERS[name];
  if (!preset) {
    store.push({ type: 'error', content: `未知供应商: ${name}，支持：${Object.keys(PROVIDERS).join(', ')}` });
    return;
  }
  const prefix = name.replace(/-/g, '_').toUpperCase();
  const apiKey = process.env[`${prefix}_API_KEY`] || '';
  if (!isValidApiKey(apiKey)) {
    store.push({ type: 'error', content: `${name} 未配置有效 API Key（请在 .env 中设置 ${prefix}_API_KEY）` });
    return;
  }
  const newModel = process.env[`${prefix}_MODEL`] || preset.defaultModel;
  config = { provider: name, apiKey, baseURL: preset.baseURL, model: newModel, headers: preset.headers, protocol: preset.protocol };
  client = await createLLMClient(config);
  MODEL_MAX_TOKENS = getModelContextLimit(config.model);
  agent.updateClient(client);
  persistEnv('LLM_PROVIDER', name);
  const newMemoryTools = createMemoryTools(client, MEMORY_BASE_DIR);
  newMemoryTools.forEach(({ def, impl, readonly }) => agent.registerTool(def, impl, readonly));
  const proto = preset.protocol === 'anthropic' ? ' [Anthropic 协议]' : '';
  store.push({ type: 'system', content: `✅ 已切换至 ${name}${proto} | 模型：${newModel}` });
}

function getProviderItems(): ProviderItem[] {
  const items: ProviderItem[] = Object.entries(PROVIDERS).map(([name, preset]) => {
    const prefix = name.replace(/-/g, '_').toUpperCase();
    return {
      name,
      model: process.env[`${prefix}_MODEL`] || (preset as any).defaultModel,
      active: name === config.provider,
      configured: isValidApiKey(process.env[`${prefix}_API_KEY`]),
      isCustom: false,
      defaultModel: (preset as any).defaultModel,
      envPrefix: prefix,
    };
  });
  // 最后一项：修改当前模型
  items.push({
    name: '__custom__',
    model: config.model,
    active: false,
    configured: true,
    isCustom: true,
    defaultModel: config.model,
    envPrefix: '',
  });
  return items;
}

// ─── 当前模式 ─────────────────────────────────────────────────────────────────

let currentMode: AppMode = 'text';
const setMode = (m: AppMode) => { currentMode = m; };

// ─── 命令处理 ─────────────────────────────────────────────────────────────────

// Plan 模式下前缀注入
function buildPlanPrefix(text: string): string {
  return `[当前处于规划模式，你只能使用只读工具分析代码，禁止修改任何文件]

请按以下步骤完成任务：
1. 使用只读工具（read_file、list_directory、search_code）充分分析相关代码和文件
2. 分析完成后，输出一份清晰的执行计划，格式如下：

📋 执行计划
Step 1: [具体操作描述]
Step 2: [具体操作描述]
...

注意：只输出计划，不要真正修改文件。

用户任务：${text}`;
}

function handleCommand(cmd: string): void {
  switch (cmd.trim()) {
    case '/help':
      store.push({ type: 'system', content: '命令：/history /clear /tools /plan /exec /voice /provider /exit' });
      break;
    case '/clear': {
      agent.clearHistory();
      const archivedFile = clearSession(CWD);
      store.clear();
      store.push({ type: 'header', model: config.model });
      if (archivedFile) store.push({ type: 'system', content: `📦 旧对话已归档：${archivedFile}` });
      store.push({ type: 'system', content: '已开启新对话，旧记录保留在 .sessions/ 目录中' });
      break;
    }
    case '/history': {
      const history = agent.getHistory().filter((m: any) => m.role === 'user' || m.role === 'assistant');
      const maxLen = 200;
      history.forEach((m: any, idx: number) => {
        const prefix = m.role === 'user' ? `[${idx + 1}] You` : `[${idx + 1}] Agent`;
        const content = (m.content || '').slice(0, maxLen) + (m.content?.length > maxLen ? ' ...' : '');
        store.push({ type: 'system', content: `${prefix}  ${content}` });
      });
      if (history.length === 0) store.push({ type: 'system', content: '(暂无对话历史)' });
      break;
    }
    case '/tools': {
      const registry = createGlobalToolRegistry(CWD);
      const names: string[] = [];
      registry.forEach(({ def }) => names.push(`  • ${def.function.name}`));
      names.forEach(n => store.push({ type: 'system', content: n }));
      break;
    }
    case '/plan':
      currentMode = 'plan';
      store.push({ type: 'system', content: '📋 Plan 模式：Agent 只会分析规划，不会执行任何工具' });
      break;
    case '/exec':
      currentMode = 'text';
      store.push({ type: 'system', content: '⚡ 已切换回执行模式' });
      break;
    case '/voice':
      currentMode = currentMode === 'voice' ? 'text' : 'voice';
      store.push({ type: 'system', content: currentMode === 'voice' ? '🎤 Voice 模式：按 Enter 开始录音，Agent 回复将自动朗读' : '⌨️  已切换回文字输入模式' });
      break;
    case '/provider':
      setAppShowProvider(store, true);
      break;
    case '/exit':
    case '/quit':
      stopSpeaking();
      store.push({ type: 'divider' });
      store.push({ type: 'system', content: '再见！👋' });
      setTimeout(() => process.exit(0), 200);
      break;
    default:
      if (cmd.startsWith('/provider ')) {
        switchProvider(cmd.slice('/provider '.length).trim());
      } else {
        store.push({ type: 'error', content: `未知命令: ${cmd}，输入 /help 查看命令列表` });
      }
  }
}

// ─── 消息处理 ─────────────────────────────────────────────────────────────────

async function processMessage(text: string): Promise<void> {
  const messageToSend = currentMode === 'plan' ? buildPlanPrefix(text) : text;

  store.push({ type: 'user', content: text });
  setAppRunning(store, true);

  try {
    const response = await agent.run(messageToSend, currentMode === 'plan');
    store.push({ type: 'assistant', content: response });
    const usage = agent.getTokenUsage();
    store.push({ type: 'token-usage', used: usage.total, max: MODEL_MAX_TOKENS });
    saveSession(CWD, agent.getHistory());
    if (currentMode === 'voice') speakAsync(response);
  } catch (e: any) {
    if (e.message === '⚡ 已中断') {
      store.push({ type: 'system', content: '⚡ 调用已中断，可以继续输入' });
    } else {
      store.push({ type: 'error', content: `调用失败: ${e.message}` });
    }
  } finally {
    setAppRunning(store, false);
  }
}

// ─── 语音输入 ─────────────────────────────────────────────────────────────────

async function handleVoiceInput(): Promise<void> {
  stopSpeaking();
  setAppRecording(store, true);

  let audioFile = '';
  try {
    audioFile = await recordUntilSilence();
  } catch (e: any) {
    setAppRecording(store, false);
    store.push({ type: 'error', content: `录音失败: ${e.message}` });
    return;
  }

  store.push({ type: 'system', content: '语音识别中...' });
  let text = '';
  try {
    text = await transcribeAudio(audioFile, config.apiKey, config.baseURL);
  } catch (e: any) {
    store.push({ type: 'error', content: `ASR 失败: ${e.message}` });
    cleanupAudioFile(audioFile);
    setAppRecording(store, false);
    return;
  } finally {
    cleanupAudioFile(audioFile);
    setAppRecording(store, false);
  }

  if (!text.trim()) {
    store.push({ type: 'error', content: '未识别到语音，请重试' });
    return;
  }

  store.push({ type: 'voice-transcribed', text });
  await processMessage(text);
}

// ─── App 回调 ─────────────────────────────────────────────────────────────────

const appCallbacks: AppCallbacks = {
  onMessage: processMessage,
  onCommand: handleCommand,
  onVoiceTrigger: handleVoiceInput,
  onAbort: () => agent.abort(),
  onSwitchProvider: (name) => switchProvider(name),
  onConfigureApiKey: (providerName, apiKey, model) => {
    const envPrefix = providerName.replace(/-/g, '_').toUpperCase();
    process.env[`${envPrefix}_API_KEY`] = apiKey;
    persistEnv(`${envPrefix}_API_KEY`, apiKey);
    process.env[`${envPrefix}_MODEL`] = model;
    persistEnv(`${envPrefix}_MODEL`, model);
    switchProvider(providerName);
    store.push({ type: 'system', content: '✅ 配置已保存到 .env' });
  },
  onChangeModel: async (newModel) => {
    const envPrefix = config.provider.replace(/-/g, '_').toUpperCase();
    process.env[`${envPrefix}_MODEL`] = newModel;
    persistEnv(`${envPrefix}_MODEL`, newModel);
    config = { ...config, model: newModel };
    client = await createLLMClient(config);
    MODEL_MAX_TOKENS = getModelContextLimit(config.model);
    agent.updateClient(client);
    const newMemoryTools = createMemoryTools(client, MEMORY_BASE_DIR);
    newMemoryTools.forEach(({ def, impl, readonly }) => agent.registerTool(def, impl, readonly));
    store.push({ type: 'system', content: `✅ 模型已更改为: ${newModel}，已保存到 .env` });
  },
  getProviderItems,
};

// ─── 启动 ─────────────────────────────────────────────────────────────────────

// 推入初始事件
store.push({ type: 'header', model: config.model });
store.push({ type: 'system', content: '小玉已就绪！权哥有什么需要尽管说。' });
store.push({ type: 'system', content: `工作目录: ${CWD}` });
store.push({ type: 'system', content: '子 Agent：💻 Coding Agent | 🌟 Daily Agent' });

if (previousMessages.length > 0) {
  const userCount = previousMessages.filter((m: any) => m.role === 'user').length;
  store.push({ type: 'system', content: `已恢复上次会话（${userCount} 轮对话），输入 /clear 可重新开始` });
}
store.push({ type: 'system', content: '输入消息开始对话，/help 查看命令' });

// 挂载 Ink App
render(
  React.createElement(App, {
    store,
    model: config.model,
    mode: currentMode,
    setMode,
    callbacks: appCallbacks,
  })
);

// Ctrl+C / SIGINT 优雅退出
process.on('SIGINT', () => {
  stopSpeaking();
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  store.push({ type: 'error', content: `未捕获异常: ${e.message}` });
});
