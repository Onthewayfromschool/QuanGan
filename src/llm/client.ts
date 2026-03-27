import { LLMConfig } from '../config/llm-config';
import { 
  ChatMessage, 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ChatCompletionChunk 
} from './types';

/**
 * 通用 LLM 客户端（OpenAI 兼容接口）
 * 支持任意历商：dashscope / kimi / openai / 自定义
 */
export class LLMClient {
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
    options?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
    }
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
    options?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
    }
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
