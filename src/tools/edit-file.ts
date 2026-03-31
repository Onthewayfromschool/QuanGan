import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolFunction } from './types.js';

/**
 * 工具：编辑文件内容
 * 通过查找替换的方式修改文件，适合局部修改而非完全重写
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: '编辑文件内容，通过查找并替换指定文本，以此来修改文件。适合局部修改，无需重写整个文件。',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: '要编辑的文件路径（相对路径或绝对路径）',
        },
        old_text: {
          type: 'string',
          description: '要查找并替换的原始文本（必须完全匹配）',
        },
        new_text: {
          type: 'string',
          description: '替换后的新文本',
        },
        replace_all: {
          type: 'boolean',
          description: '是否替换所有匹配项，默认只替换第一个匹配项',
        },
      },
      required: ['file_path', 'old_text', 'new_text'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  file_path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}) => {
  try {
    const absPath = path.resolve(args.file_path);

    if (!fs.existsSync(absPath)) {
      return `错误：文件不存在 → ${absPath}`;
    }

    const content = fs.readFileSync(absPath, 'utf-8');

    // 检查是否找到要替换的文本
    if (!content.includes(args.old_text)) {
      return `错误：未找到要替换的文本\n   文件: ${absPath}\n   查找内容: "${args.old_text.slice(0, 100)}${args.old_text.length > 100 ? '...' : ''}"`;
    }

    // 检查是否有多个匹配项（未开启 replace_all 时）
    const matchCount = content.split(args.old_text).length - 1;
    if (matchCount > 1 && !args.replace_all) {
      return `警告：找到 ${matchCount} 处匹配，但 replace_all 未设为 true\n   请确认是否要替换所有匹配项，或提供更精确的查找文本`;
    }

    // 执行替换
    const newContent = args.replace_all
      ? content.split(args.old_text).join(args.new_text)
      : content.replace(args.old_text, args.new_text);

    fs.writeFileSync(absPath, newContent, 'utf-8');

    const replacedCount = args.replace_all ? matchCount : 1;
    return `✅ 文件已修改: ${absPath}\n   替换了 ${replacedCount} 处匹配`;
  } catch (e) {
    return `编辑失败: ${e}`;
  }
};