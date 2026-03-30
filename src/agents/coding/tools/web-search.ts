import { ToolDefinition, ToolFunction } from '../../../tools/types.js';

/**
 * Tavily 搜索结果单条
 */
interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

/**
 * Tavily API 响应
 */
interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
  query: string;
}

/**
 * 工具：使用 Tavily API 进行联网搜索
 * 返回搜索摘要（answer）+ Top N 条结果（标题、链接、摘要）
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '联网搜索最新信息。当需要查找实时数据、新闻、文档、技术资料等网络内容时使用。返回搜索摘要和相关网页列表。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或问题，例如："React 19 新特性"、"Node.js 22 release notes"',
        },
        max_results: {
          type: 'number',
          description: '返回结果数量，默认 5，最大 10',
        },
        search_depth: {
          type: 'string',
          description:
            '搜索深度：basic（快速，适合简单查询）或 advanced（深度，适合复杂研究）。默认 basic',
          enum: ['basic', 'advanced'],
        },
      },
      required: ['query'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  query: string;
  max_results?: number;
  search_depth?: 'basic' | 'advanced';
}) => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return '错误：未配置 TAVILY_API_KEY，请在 .env 中添加。申请地址：https://app.tavily.com';
  }

  const maxResults = Math.min(args.max_results ?? 5, 10);
  const searchDepth = args.search_depth ?? 'basic';

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: args.query,
        max_results: maxResults,
        search_depth: searchDepth,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return `Tavily 请求失败 (${response.status}): ${err}`;
    }

    const data = (await response.json()) as TavilyResponse;

    const lines: string[] = [];

    // AI 生成的摘要答案
    if (data.answer) {
      lines.push(`## 搜索摘要\n${data.answer}\n`);
    }

    // 搜索结果列表
    if (data.results.length === 0) {
      lines.push('未找到相关结果。');
    } else {
      lines.push(`## 搜索结果（共 ${data.results.length} 条）`);
      data.results.forEach((r, i) => {
        lines.push(`\n### ${i + 1}. ${r.title}`);
        lines.push(`URL: ${r.url}`);
        if (r.published_date) lines.push(`日期: ${r.published_date}`);
        lines.push(`摘要: ${r.content}`);
      });
    }

    return lines.join('\n');
  } catch (e) {
    return `搜索失败: ${e instanceof Error ? e.message : String(e)}`;
  }
};
