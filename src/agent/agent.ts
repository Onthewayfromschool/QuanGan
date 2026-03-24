import { DashScopeClient } from '../llm/client';
import { ChatMessage } from '../llm/types';
import { ToolDefinition, ToolCall, ToolResult, ToolRegistry } from '../tools/types';

/**
 * Agent 配置
 */
export interface AgentConfig {
  client: DashScopeClient;
  systemPrompt?: string;
  maxIterations?: number;
  verbose?: boolean;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: string) => void;
  /**
   * token 压缩触发阈值（默认 16000）
   * 每次 API 响应后，若 total_tokens 超过此值则自动压缩旧消息
   */
  compressionThreshold?: number;
  /** 压缩发生时的回调，可用于在 TUI 中展示提示 */
  onCompress?: (beforeCount: number, afterCount: number) => void;
  /** 压缩开始前的回调，可用于在 TUI 中展示 loading 提示；支持 async（会被 await） */
  onCompressStart?: () => void | Promise<void>;
}

/**
 * 智能体 - 支持工具调用的对话代理
 */
export class Agent {
  private client: DashScopeClient;
  private tools: Map<string, ToolRegistry & { readonly: boolean }> = new Map();
  /**
   * 单数组存储所有消息（完整历史）
   * _archived=true 的消息不发给 LLM，但保留供 /history 展示
   * _summary=true 的消息是压缩摘要标记点
   */
  private messages: ChatMessage[] = [];
  private maxIterations: number;
  private verbose: boolean;
  private onToolCall?: (name: string, args: any) => void;
  private onToolResult?: (name: string, result: string) => void;
  /** 最近一次 API 响应的 token 用量 */
  private lastTokenUsage: { prompt: number; completion: number; total: number } = { prompt: 0, completion: 0, total: 0 };
  /** token 压缩触发阈值 */
  private compressionThreshold: number;
  private onCompress?: (beforeCount: number, afterCount: number) => void;
  private onCompressStart?: () => void;
  /** ESC 中断标志 */
  private _aborted = false;
  /** 用于立即取消当前 in-flight fetch 请求 */
  private _abortController: AbortController | null = null;

  constructor(config: AgentConfig) {
    this.client = config.client;
    this.maxIterations = config.maxIterations || 50;
    this.verbose = config.verbose || false;
    this.onToolCall = config.onToolCall;
    this.onToolResult = config.onToolResult;
    this.compressionThreshold = config.compressionThreshold ?? 16_000;
    this.onCompress = config.onCompress;
    this.onCompressStart = config.onCompressStart;

    if (config.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: config.systemPrompt,
      });
    }
  }

  /**
   * 注册工具
   * @param readonly 为 true 时该工具在 Plan 模式下也可被调用（读文件、搜索等安全操作）
   */
  registerTool(definition: ToolDefinition, implementation: (args: any) => Promise<string> | string, readonly = false) {
    this.tools.set(definition.function.name, {
      definition,
      implementation,
      readonly,
    });
    
    if (this.verbose) {
      console.log(`✓ 已注册工具: ${definition.function.name}`);
    }
  }

  /**
   * 从 messages 中派生 LLM 上下文（激进策略）
   * 找到最近一条摘要消息，只取它之后的内容 + 系统提示
   * 发送前剥离 _archived / _summary 元数据字段，LLM 看不到
   */
  private getLLMMessages(): ChatMessage[] {
    const systemMsgs = this.messages.filter(m => m.role === 'system' && !m._summary);

    // 找最近一条摘要的位置
    let lastSummaryIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]._summary) { lastSummaryIdx = i; break; }
    }

    const contextMsgs = lastSummaryIdx >= 0
      // 激进策略：只用最近一次摘要 + 其后的消息
      ? this.messages.slice(lastSummaryIdx)
      // 从未压缩过：过滤掉 _archived（理论上不存在，但保险起见）
      : this.messages.filter(m => !m._archived && m.role !== 'system');

    // 合并并剥离元数据字段，确保 API 收到干净的消息格式
    return [...systemMsgs, ...contextMsgs].map(
      ({ _archived: _a, _summary: _s, ...rest }) => rest as ChatMessage
    );
  }

  /**
   * 上下文压缩（滚动摘要）
   * 旧消息打上 _archived 标记留在数组中（供 /history 展示），
   * 在第一条"保留"消息前插入 _summary 摘要节点
   */
  private async compressContext(): Promise<void> {
    const KEEP_RECENT = 6; // 保留最近 6 条（约 3 轮对话）

    // 只对未归档的非 system 消息计数
    const active = this.messages.filter(m => !m._archived && m.role !== 'system');
    if (active.length <= KEEP_RECENT) return;

    const toCompress = active.slice(0, active.length - KEEP_RECENT);
    const toKeep     = active.slice(active.length - KEEP_RECENT);
    const beforeCount = this.messages.length;

    // 通知外部：压缩即将开始（支持 async，如记忆系统更新）
    if (this.onCompressStart) {
      await this.onCompressStart();
    }

    // 调用大模型生成摘要
    const summaryPrompt = toCompress
      .map(m => {
        const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'Agent' : '工具';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${role}]: ${content.slice(0, 500)}`;
      })
      .join('\n\n');

    const summaryResp = await fetch(
      `${this.client.config.baseURL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.client.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.client.config.model,
          messages: [
            { role: 'system', content: '你是一个对话摘要助手，擅长从编程对话中提炼关键信息。' },
            { role: 'user',   content: `请将以下对话历史压缩成简洁摘要（200字以内），重点保留：已读过的文件路径、做过的代码修改、重要结论。\n\n${summaryPrompt}` },
          ],
        }),
      }
    );

    if (!summaryResp.ok) return; // 压缩失败则静默跳过

    const summaryData = await summaryResp.json() as any;
    const summary: string = summaryData.choices?.[0]?.message?.content ?? '';
    if (!summary) return;

    // 构造摘要标记节点
    const summaryMsg: ChatMessage = {
      role: 'system',
      content: `[历史对话摘要 - 已自动压缩]\n${summary}`,
      _summary: true,
    };

    // 原地修改 messages 数组：toCompress 打标记，摘要插到 toKeep 之前
    const toCompressSet = new Set<ChatMessage>(toCompress);
    const firstKeepRef  = toKeep[0];
    const newMessages: ChatMessage[] = [];
    let summaryInserted = false;

    for (const msg of this.messages) {
      // 在第一条"保留"消息前插入摘要
      if (!summaryInserted && msg === firstKeepRef) {
        newMessages.push(summaryMsg);
        summaryInserted = true;
      }
      // 旧消息打归档标记
      newMessages.push(toCompressSet.has(msg) ? { ...msg, _archived: true } : msg);
    }
    this.messages = newMessages;

    const afterCount = active.length - toCompress.length + 1; // 摘要算 1 条
    this.onCompress?.(beforeCount, afterCount);

    if (this.verbose) {
      console.log(`\n♻️  上下文已压缩: ${beforeCount} → ${afterCount} 条有效消息`);
    }
  }

  /**
   * 获取工具定义列表
   * @param planOnly 为 true 时只返回 readonly 工具（Plan 模式下隐藏写操作工具）
   */
  private getToolDefinitions(planOnly = false): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(t => !planOnly || t.readonly)
      .map(t => t.definition);
  }

  /**
   * 执行工具调用
   */
  private async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const toolName = toolCall.function.name;
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        name: toolName,
        content: `错误：未找到工具 ${toolName}`,
      };
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      if (this.verbose) {
        console.log(`\n🔧 调用工具: ${toolName}`);
        console.log(`📥 参数:`, args);
      }
      this.onToolCall?.(toolName, args);

      const result = await tool.implementation(args);

      if (this.verbose) {
        console.log(`📤 结果:`, result);
      }
      this.onToolResult?.(toolName, result);

      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        name: toolName,
        content: result,
      };
    } catch (error) {
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        name: toolName,
        content: `工具执行失败: ${error}`,
      };
    }
  }

  /**
   * 中断当前正在运行的 run()
   * 同时取消 in-flight fetch，无需等待 LLM 响应返回
   */
  abort(): void {
    this._aborted = true;
    this._abortController?.abort();
  }

  /**
   * 运行 Agent
   * @param userMessage 用户输入
   * @param planOnly 为 true 时进入规划模式：不传工具给 LLM，只做分析和规划，不会执行任何操作
   */
  async run(userMessage: string, planOnly = false): Promise<string> {
    this._aborted = false;          // 每次运行前重置
    this._abortController = null;     // 清空上一次的 controller
    // 添加用户消息到单数组（完整历史）
    this.messages.push({ role: 'user', content: userMessage });

    let iteration = 0;

    while (iteration < this.maxIterations) {
      // 每论迭代开头检查中断标志
      if (this._aborted) {
        this._aborted = false;
        throw new Error('⚡ 已中断');
      }

      iteration++;

      if (this.verbose) {
        console.log(`\n━━━━ 迭代 ${iteration} ━━━━`);
      }
      // 调用大模型：发送派生出的 LLM 上下文（已过滤 archived，含最近摘要）
      const tools = this.getToolDefinitions(planOnly);
      // 每次 fetch 前创建新的 AbortController，供 abort() 取消
      this._abortController = new AbortController();
      let response: Response;
      try {
        response = await fetch(
          `${this.client.config.baseURL}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.client.config.apiKey}`,
            },
            body: JSON.stringify({
              model: this.client.config.model,
              messages: this.getLLMMessages(),
              ...(tools.length > 0 ? { tools } : {}),
            }),
            signal: this._abortController.signal,
          }
        );
      } catch (err: any) {
        // fetch 被 AbortController 取消（ESC 中断）
        if (err.name === 'AbortError' || this._aborted) {
          this._aborted = false;
          throw new Error('⚡ 已中断');
        }
        throw err;
      }

      if (!response.ok) {
        throw new Error(`API 调用失败: ${response.status}`);
      }

      const data = await response.json() as any;
      // 记录 token 用量（百炼每次响应都会返回 usage 字段）
      if (data.usage) {
        this.lastTokenUsage = {
          prompt:     data.usage.prompt_tokens     ?? 0,
          completion: data.usage.completion_tokens ?? 0,
          total:      data.usage.total_tokens      ?? 0,
        };
        // token 超过阈值时自动压缩，下一轮迭代就能用压缩后的 messages
        if (this.lastTokenUsage.total >= this.compressionThreshold) {
          await this.compressContext();
        }
      }
      const choice = data.choices[0];
      const message = choice.message;
      // 添加助手回复（同一个数组）
      this.messages.push(message);

      // 检查是否需要调用工具
      if (message.tool_calls && message.tool_calls.length > 0) {
        if (this.verbose) {
          console.log(`💡 模型请求调用 ${message.tool_calls.length} 个工具`);
        }

        // 执行所有工具调用
        for (const toolCall of message.tool_calls) {
          const toolResult = await this.executeToolCall(toolCall);
          this.messages.push(toolResult as any);
        }

        // 继续下一轮迭代
        continue;
      }

      // 没有工具调用，返回最终结果
      if (this.verbose) {
        console.log('\n✅ Agent 执行完成');
      }

      return message.content || '';
    }

    throw new Error(`达到最大迭代次数 (${this.maxIterations})`);
  }

  /**
   * 载入历史消息（用于恢复上次会话）
   * 包含完整记录（archived 消息也一并恢复）
   */
  loadMessages(messages: ChatMessage[]): void {
    this.messages.push(...messages);
  }

  /**
   * 获取最近一次 API 调用的 token 用量
   */
  getTokenUsage() {
    return { ...this.lastTokenUsage };
  }

  /**
   * 获取完整历史（含 _archived 旧消息，用于 /history 展示和存档）
   */
  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * 清空对话历史（保留系统提示）
   */
  clearHistory() {
    const systemMessages = this.messages.filter(m => m.role === 'system' && !m._summary);
    this.messages = systemMessages;
  }
}
