import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 工具：TypeScript 编译验证
 *
 * 对指定目录运行 tsc --noEmit，不产生任何输出文件，
 * 只检查类型错误。Agent 写完代码后可调用此工具自我验证。
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'verify_code',
    description: '对 TypeScript 项目执行编译检查（tsc --noEmit），验证代码是否有类型错误。适合在修改代码后立即验证正确性，无需生成编译产物。',
    parameters: {
      type: 'object',
      properties: {
        project_dir: {
          type: 'string',
          description: '要检查的项目目录路径（需包含 tsconfig.json）。默认为当前工作目录。',
        },
      },
      required: [],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  project_dir?: string;
}) => {
  // 确定检查目录
  const targetDir = args.project_dir
    ? path.resolve(args.project_dir)
    : process.cwd();

  // 检查目录是否存在
  if (!fs.existsSync(targetDir)) {
    return `❌ 目录不存在: ${targetDir}`;
  }

  // 检查是否有 tsconfig.json
  const tsconfigPath = path.join(targetDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return `❌ 未找到 tsconfig.json: ${tsconfigPath}\n   请确认这是一个 TypeScript 项目目录。`;
  }

  try {
    execSync('npx tsc --noEmit', {
      cwd: targetDir,
      encoding: 'utf-8',
      timeout: 60000,      // tsc 可能需要较长时间
      maxBuffer: 1024 * 512,
    });
    return `✅ 编译通过，无类型错误\n   目录: ${targetDir}`;
  } catch (e: any) {
    // tsc 发现错误时以非 0 退出码退出，错误信息在 stdout
    const stdout = e.stdout?.toString().trim();
    const stderr = e.stderr?.toString().trim();
    const errors = stdout || stderr || e.message;

    // 统计错误数量（tsc 每行错误以 "error TS" 开头）
    const errorLines = errors.split('\n').filter((l: string) => l.includes('error TS'));
    const count = errorLines.length;

    return [
      `❌ 编译失败，发现 ${count} 个错误`,
      `   目录: ${targetDir}`,
      '',
      errors,
    ].join('\n');
  }
};
