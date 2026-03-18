import { execSync } from 'child_process';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 工具：在默认浏览器中打开 URL 或执行搜索
 * - 传入完整 URL 时直接打开
 * - 传入关键词时自动拼接 Google 搜索 URL
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_url',
    description: '在默认浏览器中打开指定网址，或搜索关键词（自动拼接 Google 搜索链接）',
    parameters: {
      type: 'object',
      properties: {
        url_or_query: {
          type: 'string',
          description: '网址（如 https://github.com）或搜索关键词（如 "TypeScript 教程"）',
        },
      },
      required: ['url_or_query'],
    },
  },
};

export const implementation: ToolFunction = async (args: { url_or_query: string }) => {
  const input = args.url_or_query.trim();

  // 判断是否为合法 URL（http/https 开头）
  const isUrl = /^https?:\/\//i.test(input);
  const finalUrl = isUrl
    ? input
    : `https://www.google.com/search?q=${encodeURIComponent(input)}`;

  try {
    execSync(`open "${finalUrl}"`, { timeout: 5000 });
    return isUrl
      ? `✅ 已在浏览器中打开: ${finalUrl}`
      : `✅ 已在浏览器中搜索: "${input}"\n   ${finalUrl}`;
  } catch (e: any) {
    const msg = e.stderr?.toString().trim() || e.message;
    return `❌ 打开失败\n${msg}`;
  }
};
