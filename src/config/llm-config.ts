/**
 * 大模型配置接口
 */
export interface LLMConfig {
  /** 供应商标识，如 dashscope | kimi | openai */
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * 内置供应商预设（baseURL + 默认模型）
 * 添加新厂商只需在此注册一条
 */
export const PROVIDERS: Record<string, { baseURL: string; defaultModel: string }> = {
  dashscope: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  kimi: {
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi2.5',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
};

/**
 * 主流模型的上下文长度上限（单位：token）
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // DashScope / 百炼
  'qwen3.5-plus':             1_000_000,
  'qwen-turbo':               1_000_000,
  'qwen-long':               10_000_000,
  'qwen-plus':                  131_072,
  'qwen-max':                    32_768,
  'qwen-max-longcontext':        28_672,
  // Kimi / Moonshot
  'kimi2.5':                    128_000,
  'moonshot-v1-8k':               8_192,
  'moonshot-v1-32k':             32_768,
  'moonshot-v1-128k':           128_000,
  // OpenAI
  'gpt-4o':                     128_000,
  'gpt-4o-mini':                128_000,
  'gpt-4-turbo':                128_000,
};

/**
 * 获取指定模型的上下文上限，未知模型返回默认值 128k
 */
export function getModelContextLimit(model: string): number {
  const exactMatch = MODEL_CONTEXT_LIMITS[model];
  if (exactMatch) return exactMatch;
  const prefixMatch = Object.keys(MODEL_CONTEXT_LIMITS).find(k => model.startsWith(k));
  return prefixMatch ? MODEL_CONTEXT_LIMITS[prefixMatch] : 128_000;
}

/**
 * 从环境变量加载配置
 * 通过 LLM_PROVIDER 指定供应商（默认 dashscope）
 * 各厂商的 Key / 模型 / BaseURL 配置用大写前缀区分，如：
 *   KIMI_API_KEY, KIMI_MODEL, KIMI_BASE_URL
 *   DASHSCOPE_API_KEY, DASHSCOPE_MODEL, DASHSCOPE_BASE_URL
 */
export function loadConfigFromEnv(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'dashscope').toLowerCase();
  const preset = PROVIDERS[provider] ?? PROVIDERS.dashscope;
  const prefix = provider.toUpperCase();

  return {
    provider,
    apiKey:  process.env[`${prefix}_API_KEY`]  || process.env.DASHSCOPE_API_KEY || '',
    baseURL: process.env[`${prefix}_BASE_URL`] || preset.baseURL,
    model:   process.env[`${prefix}_MODEL`]    || preset.defaultModel,
  };
}

/**
 * 手动创建配置
 */
export function createConfig(
  apiKey: string,
  model?: string,
  baseURL?: string,
  provider = 'dashscope',
): LLMConfig {
  const preset = PROVIDERS[provider] ?? PROVIDERS.dashscope;
  return {
    provider,
    apiKey,
    baseURL: baseURL || preset.baseURL,
    model:   model   || preset.defaultModel,
  };
}
