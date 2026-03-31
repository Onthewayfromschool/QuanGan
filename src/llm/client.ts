import { LLMConfig } from '../config/llm-config.js';
import { 
  ChatMessage, 
  ChatOptions,
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ChatCompletionChunk,
  ILLMClient,
  AgentCallRequest,
  AgentCallResponse,
} from './types.js';

/**
 * 通用 LLM 客户端（OpenAI 兼容接口）
 * 支持任意历商：dashscope / kimi / openai / 自定义
 */
export class LLMClient implements ILLMClient {
  public readonly config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.validateConfig();
  }

  /**
   * 验证配置有效性
   */
  private validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error('API Key 不能为空');
    }
    if (!this.config.baseURL) {
      throw new Error('Base URL 不能为空');
    }
    if (!this.config.model) {
      throw new Error('模型名称不能为空');
    }
  }

  /**
   * 普通对话调用（非流式）
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<string> {
    const requestBody: ChatCompletionRequest = {
      model: this.config.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
      stream: false,
    };

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 调用失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as ChatCompletionResponse;
    return data.choices[0]?.message?.content || '';
  }

  /**
   * 流式对话调用
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    const requestBody: ChatCompletionRequest = {
      model: this.config.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
      stream: true,
    };

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 调用失败: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
          
          if (trimmedLine.startsWith('data: ')) {
            try {
              const jsonStr = trimmedLine.slice(6);
              const chunk: ChatCompletionChunk = JSON.parse(jsonStr);
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (e) {
              console.error('解析流式响应失败:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Agent 主循环调用（支持工具 + AbortSignal）
   * messages 使用 OpenAI-like 格式，返回协议无关的 AgentCallResponse
   */
  async agentCall(req: AgentCallRequest): Promise<AgentCallResponse> {
    const { messages, tools, signal } = req;
    const body: any = {
      model: this.config.model,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    };

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 调用失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    const message = data.choices[0].message;
    const toolCalls = message.tool_calls?.length ? message.tool_calls : undefined;

    return {
      message,
      toolCalls,
      usage: data.usage ? {
        prompt:     data.usage.prompt_tokens     ?? 0,
        completion: data.usage.completion_tokens ?? 0,
        total:      data.usage.total_tokens      ?? 0,
      } : undefined,
    };
  }

  /**
   * 简单问答（快捷方法）
   */
  async ask(question: string, systemPrompt?: string): Promise<string> {
    const messages: ChatMessage[] = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: question });
    
    return this.chat(messages);
  }
}

/** 向下兼容别名，现有引用无需修改 */
export { LLMClient as DashScopeClient };

/**
 * 根据配置协议创建对应的 LLM 客户端
 * protocol=anthropic → AnthropicClient
 * 其他 → LLMClient（OpenAI 兼容）
 */
export async function createLLMClient(config: import('../config/llm-config.js').LLMConfig): Promise<import('./types.js').ILLMClient> {
  if (config.protocol === 'anthropic') {
    const { AnthropicClient } = await import('./anthropic-client.js');
    return new AnthropicClient(config);
  }
  return new LLMClient(config);
}
