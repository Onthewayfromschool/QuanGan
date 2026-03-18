import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 工具：读取文件内容
 * 支持指定读取行范围，方便查看大文件的局部内容
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: '读取文件内容，返回文件的文本内容（可指定行范围）',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '要读取的文件路径（相对路径或绝对路径）',
        },
        start_line: {
          type: 'number',
          description: '从第几行开始读取（从 1 开始，可选）',
        },
        end_line: {
          type: 'number',
          description: '读取到第几行结束（可选）',
        },
      },
      required: ['file_path'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  file_path: string;
  start_line?: number;
  end_line?: number;
}) => {
  try {
    const absPath = path.resolve(args.file_path);

    if (!fs.existsSync(absPath)) {
      return `错误：文件不存在 → ${absPath}`;
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    const start = args.start_line ? args.start_line - 1 : 0;
    const end = args.end_line ? args.end_line : lines.length;

    return lines
      .slice(start, end)
      .map((line, i) => `${String(start + i + 1).padStart(4)} | ${line}`)
      .join('\n');
  } catch (e) {
    return `读取失败: ${e}`;
  }
};
