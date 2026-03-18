import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 工具：写入文件内容
 * 如果文件不存在则创建，目录不存在则自动创建目录
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description: '创建或覆盖写入文件内容，目录不存在时自动创建',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '目标文件路径（相对路径或绝对路径）',
        },
        content: {
          type: 'string',
          description: '要写入文件的完整内容',
        },
      },
      required: ['file_path', 'content'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  file_path: string;
  content: string;
}) => {
  try {
    const absPath = path.resolve(args.file_path);

    // 自动创建多级目录
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, args.content, 'utf-8');

    const lines = args.content.split('\n').length;
    return `✅ 文件已写入: ${absPath}\n   共 ${lines} 行，${args.content.length} 字节`;
  } catch (e) {
    return `写入失败: ${e}`;
  }
};
