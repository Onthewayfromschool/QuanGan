import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 遍历时跳过的目录
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'coverage']);

/**
 * 工具：在代码库中搜索关键词
 * 递归扫描目录，支持正则，返回匹配行和位置
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_code',
    description: '在指定目录内递归搜索包含关键词的文件和行，支持正则表达式',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '搜索关键词或正则表达式，例如: "useState"、"async function"',
        },
        dir_path: {
          type: 'string',
          description: '搜索起始目录，默认为当前工作目录',
        },
        file_ext: {
          type: 'string',
          description: '只搜索指定后缀的文件，例如: .ts、.js（可选）',
        },
      },
      required: ['pattern'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  pattern: string;
  dir_path?: string;
  file_ext?: string;
}) => {
  const baseDir = path.resolve(args.dir_path || '.');
  const results: string[] = [];

  let regex: RegExp;
  try {
    regex = new RegExp(args.pattern, 'i');
  } catch {
    return `无效的正则表达式: "${args.pattern}"`;
  }

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // 跳过隐藏目录和黑名单目录
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        // 按后缀过滤
        if (args.file_ext && !entry.name.endsWith(args.file_ext)) continue;

        try {
          const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              const rel = path.relative(baseDir, fullPath);
              results.push(`${rel}:${idx + 1}  ${line.trim()}`);
            }
          });
        } catch {
          // 跳过二进制文件或无权限文件
        }
      }
    }
  }

  walk(baseDir);

  if (results.length === 0) {
    return `未找到匹配 "${args.pattern}" 的内容`;
  }

  const MAX = 30;
  const shown = results.slice(0, MAX);
  const suffix = results.length > MAX ? `\n... 共 ${results.length} 条，只显示前 ${MAX} 条` : '';
  return shown.join('\n') + suffix;
};
