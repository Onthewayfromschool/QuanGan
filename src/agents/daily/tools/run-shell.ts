import { execSync, spawn } from 'child_process';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 危险命令黑名单
 */
const BLOCKED = ['rm -rf', 'sudo', 'shutdown', 'reboot', 'mkfs', ':(){:|:&};:'];

/**
 * 工具：执行任意 shell 命令（日常任务版）
 * 支持普通模式和后台模式，与 coding agent 的 execute_command 逻辑一致
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_shell',
    description: '执行任意 shell 命令，适合日常系统操作、查询信息等。短命令直接返回输出；启动持续运行的程序请将 background 设为 true。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 shell 命令',
        },
        background: {
          type: 'boolean',
          description: '是否后台运行，适合启动长驻进程。默认 false。',
        },
      },
      required: ['command'],
    },
  },
};

export const implementation: ToolFunction = async (args: {
  command: string;
  background?: boolean;
}) => {
  const cmd = args.command.trim();

  // 安全校验
  for (const blocked of BLOCKED) {
    if (cmd.includes(blocked)) {
      return `🚫 拒绝执行危险命令: "${blocked}"`;
    }
  }

  // ── 后台模式 ─────────────────────────────────────────────────────
  if (args.background) {
    const child = spawn('sh', ['-c', cmd], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return `✅ 命令已在后台启动\n   PID: ${child.pid}\n   命令: ${cmd}`;
  }

  // ── 普通模式 ─────────────────────────────────────────────────────
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 1024 * 512,
    });
    return output.trim() || '(命令已执行，无输出)';
  } catch (e: any) {
    if (e.killed || e.code === 'ETIMEDOUT') {
      return `⚠️ 命令执行超时\n提示：如果这是持续运行的程序，请将 background 设为 true`;
    }
    const stderr = e.stderr?.toString().trim();
    return `命令执行失败:\n${stderr || e.message}`;
  }
};
