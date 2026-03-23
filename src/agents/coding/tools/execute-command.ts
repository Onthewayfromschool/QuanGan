import { execSync, spawn } from 'child_process';
import path from 'path';
import { ToolDefinition, ToolFunction } from '../../../tools/types';

/**
 * 硬性黑名单：无论路径在哪里都直接拒绝
 */
const BLOCKED = ['sudo', 'shutdown', 'reboot', 'mkfs', ':(){:|:&};:'];

/**
 * 需要路径检查的危险操作（删除 / 移动 / 复制）
 * 格式：[命令前缀, ...可能的 flag 变体]
 */
const DANGEROUS_OPS = ['rm', 'rmdir', 'mv', 'cp'];

/**
 * 从命令字符串中提取所有非 flag 参数（即路径候选）
 * 例: "rm -rf /tmp/foo ../bar" → ["/tmp/foo", "../bar"]
 */
function extractPaths(cmd: string): string[] {
  // 去掉命令名本身和所有 flag（- 开头的词）
  const parts = cmd.trim().split(/\s+/);
  return parts.slice(1).filter(p => !p.startsWith('-'));
}

/**
 * 判断命令是否涉及项目目录之外的路径
 * @param cmd   完整命令字符串
 * @param cwd   当前工作目录（项目根）
 */
function hasOutsidePath(cmd: string, cwd: string): { outside: boolean; paths: string[] } {
  const candidates = extractPaths(cmd);
  const outsidePaths: string[] = [];

  for (const p of candidates) {
    const abs = path.resolve(cwd, p);
    // 路径必须以 cwd/ 开头（或等于 cwd 本身）才算在项目内
    if (abs !== cwd && !abs.startsWith(cwd + path.sep)) {
      outsidePaths.push(abs);
    }
  }

  return { outside: outsidePaths.length > 0, paths: outsidePaths };
}

/**
 * 判断命令是否属于危险操作类型
 */
function isDangerousOp(cmd: string): boolean {
  const firstWord = cmd.trim().split(/\s+/)[0];
  return DANGEROUS_OPS.includes(firstWord);
}

// ─── 工具定义（静态，不依赖 workDir） ────────────────────────────────────────

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

/**
 * 工厂函数：创建带路径安全守卫的 execute_command 实现
 * @param workDir   项目工作目录，路径检查的基准
 * @param confirmFn 当检测到越界路径时调用此函数询问用户；未传则直接拒绝
 */
export function createImplementation(
  workDir: string,
  confirmFn?: (msg: string) => Promise<boolean>,
): ToolFunction {
  return async (args: { command: string; background?: boolean }) => {
    const cmd = args.command.trim();

    // ── 硬性黑名单：直接拒绝 ──────────────────────────────────────────
    for (const blocked of BLOCKED) {
      if (cmd.includes(blocked)) {
        return `🚫 拒绝执行危险命令: "${blocked}"`;
      }
    }

    // ── 路径越界检查：对危险操作进行额外确认 ─────────────────────────
    if (isDangerousOp(cmd)) {
      const { outside, paths } = hasOutsidePath(cmd, workDir);
      if (outside) {
        const pathList = paths.map(p => `   • ${p}`).join('\n');
        const msg =
          `⚠️  检测到操作路径超出项目目录\n` +
          `   命令: ${cmd}\n` +
          `   越界路径:\n${pathList}`;

        if (confirmFn) {
          const ok = await confirmFn(msg);
          if (!ok) return '❌ 已取消：操作路径超出项目目录，用户拒绝执行';
        } else {
          return `❌ 已拒绝：操作路径超出项目目录\n${pathList}\n   如需执行，请在终端手动运行。`;
        }
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
      if (e.killed || e.code === 'ETIMEDOUT') {
        return `⚠️ 命令执行超时（进程可能仍在运行中）\n提示：如果这是启动服务的命令，请将 background 参数设为 true`;
      }
      // 退出码为 1 且 stdout 有内容时（如 grep 无匹配），视为正常执行、只是无结果
      const stdout = e.stdout?.toString().trim();
      if (e.status === 1 && stdout) {
        return stdout;
      }
      // 退出码为 1 且无输出（如 grep 无匹配且无 stdout），给出友好提示
      if (e.status === 1 && !stdout) {
        return '(命令已执行，无匹配结果)';
      }
      const stderr = e.stderr?.toString().trim();
      return `命令执行失败:\n${stderr || e.message}`;
    }
  };
}

// 兼容旧调用方式：无路径守卫的默认实现（供直接引用时降级使用）
export const implementation: ToolFunction = createImplementation(process.cwd());
