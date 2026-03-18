import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 工具：列出目录内容
 * 文件夹排在前面，并标注 / 后缀方便区分
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description: '列出目录下的文件和子目录，文件夹优先显示',
    parameters: {
      type: 'object',
      properties: {
        dir_path: {
          type: 'string',
          description: '目录路径，默认为当前工作目录',
        },
      },
    },
  },
};

export const implementation: ToolFunction = async (args: { dir_path?: string }) => {
  try {
    const targetPath = path.resolve(args.dir_path || '.');

    if (!fs.existsSync(targetPath)) {
      return `错误：目录不存在 → ${targetPath}`;
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });

    // 文件夹优先，再按名称排序
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const lines = sorted.map(e => {
      const icon = e.isDirectory() ? '📁' : '📄';
      const suffix = e.isDirectory() ? '/' : '';
      return `  ${icon}  ${e.name}${suffix}`;
    });

    return `${targetPath}\n${lines.join('\n')}`;
  } catch (e) {
    return `列目录失败: ${e}`;
  }
};
