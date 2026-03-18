import { execSync } from 'child_process';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 工具：打开 macOS 应用程序
 * 使用 `open -a "AppName"` 命令打开应用
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_app',
    description: '在 macOS 上打开一个应用程序，例如打开 QQ音乐、微信、Safari、计算器等',
    parameters: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description: '应用程序名称，例如: "QQ音乐"、"微信"、"Safari"、"Calculator"',
        },
      },
      required: ['app_name'],
    },
  },
};

export const implementation: ToolFunction = async (args: { app_name: string }) => {
  const name = args.app_name.trim();
  try {
    execSync(`open -a "${name}"`, { timeout: 5000 });
    return `✅ 已打开应用: ${name}`;
  } catch (e: any) {
    const msg = e.stderr?.toString().trim() || e.message;
    return `❌ 打开应用失败: ${name}\n${msg}\n提示：请确认应用名称正确，或尝试英文名称`;
  }
};
