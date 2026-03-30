import { ToolDefinition, ToolFunction } from '../../../tools/types.js';

/**
 * 工具：使用 Jina Reader 读取网页全文内容
 *
 * Jina Reader 将任意网页转换为干净的 Markdown，无需 API Key。
 * 用法：在目标 URL 前拼接 https://r.jina.ai/
 *
 * 典型用法：先用 web_search 拿到 URL 列表，再用 read_url 精读感兴趣的页面。
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_url',
    description:
      '读取指定网页的完整内容（转换为 Markdown 格式）。适合在 web_search 找到相关链接后，深入阅读某个页面的详细内容。支持文档、博客、GitHub README 等各类网页。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要读取的网页 URL，例如："https://docs.react.dev/learn"',
        },
        max_length: {
          type: 'number',
          description: '返回内容的最大字符数，默认 8000，避免内容过长撑爆上下文',
        },
      },
      required: ['url'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  url: string;
  max_length?: number;
}) => {
  const maxLength = args.max_length ?? 8000;

  // 基本 URL 格式验证
  let targetUrl: string;
  try {
    const parsed = new URL(args.url);
    targetUrl = parsed.href;
  } catch {
    return `错误：无效的 URL → "${args.url}"`;
  }

  const jinaUrl = `https://r.jina.ai/${targetUrl}`;

  try {
    const response = await fetch(jinaUrl, {
      headers: {
        // 请求 Markdown 格式（Jina 默认就是 Markdown，此 header 可明确指定）
        Accept: 'text/markdown, text/plain, */*',
        'User-Agent': 'QuanGan-Agent/1.0',
        // 设置 X-Return-Format 确保拿到 Markdown
        'X-Return-Format': 'markdown',
      },
      signal: AbortSignal.timeout(30_000), // 30s 超时
    });

    if (!response.ok) {
      return `读取失败 (${response.status} ${response.statusText}): ${targetUrl}`;
    }

    const text = await response.text();

    if (!text || text.trim().length === 0) {
      return `页面内容为空: ${targetUrl}`;
    }

    // 截断过长内容，避免占满上下文窗口
    if (text.length > maxLength) {
      const truncated = text.slice(0, maxLength);
      return `${truncated}\n\n---\n[内容已截断，原始长度 ${text.length} 字符，显示前 ${maxLength} 字符]\nURL: ${targetUrl}`;
    }

    return `URL: ${targetUrl}\n\n${text}`;
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      return `读取超时（30s）: ${targetUrl}`;
    }
    return `读取失败: ${e instanceof Error ? e.message : String(e)}`;
  }
};
