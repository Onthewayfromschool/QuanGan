import { execSync, spawn } from 'child_process';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 危险命令黑名单，拒绝执行
 */
const BLOCKED = ['rm -rf', 'sudo', 'shutdown', 'reboot', 'mkfs', ':(){:|:&};:'];

/**
 * 工具：执行 shell 命令
 *
 * 两种模式：
 * - 普通模式（默认）：同步等待命令结束，返回输出。适合 ls、cat、git status 等短命令。
 * - 后台模式（background: true）：将命令在后台启动，立即返回 PID。
 *   适合 npm run dev、python app.py 等长驻进程，不会因超时误判为失败。
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'execute_command',
    description: '执行 shell 命令。短命令直接返回输出；启动服务等长驻进程请将 background 设为 true，命令会在后台运行并立即返回 PID。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 shell 命令，例如: ls -la、npm run dev、python app.py',
        },
        background: {
          type: 'boolean',
          description: '是否后台运行。启动服务/项目时必须设为 true，否则会因超时误判为失败。默认 false。',
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

  // ── 后台模式：适合启动服务、长驻进程 ──────────────────────────────
  if (args.background) {
    const child = spawn('sh', ['-c', cmd], {
      detached: true,  // 与父进程解绑，父进程退出后子进程继续运行
      stdio: 'ignore', // 不接管 stdin/stdout，避免阻塞
    });
    child.unref(); // 允许父进程独立退出

    return `✅ 命令已在后台启动\n   PID: ${child.pid}\n   命令: ${cmd}`;
  }

  // ── 普通模式：同步等待，适合短命令 ───────────────────────────────
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 1024 * 512,
    });
    return output.trim() || '(命令已执行，无输出)';
  } catch (e: any) {
    // 超时通常意味着进程仍在运行（而非崩溃），给出更友好的提示
    if (e.killed || e.code === 'ETIMEDOUT') {
      return `⚠️ 命令执行超时（进程可能仍在运行中）\n提示：如果这是启动服务的命令，请将 background 参数设为 true`;
    }
    const stderr = e.stderr?.toString().trim();
    return `命令执行失败:\n${stderr || e.message}`;
  }
};
