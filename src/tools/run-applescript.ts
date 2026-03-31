import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ToolDefinition, ToolFunction } from './types.js';

/**
 * 工具：执行 AppleScript 脚本，用于自动化控制 macOS 应用
 *
 * 重要：脚本写入临时文件再用 osascript 执行，支持多行脚本。
 * osascript -e "..." 只支持单行，多行必须用文件方式。
 *
 * 常见使用场景：
 *   - 控制 QQ 音乐搜索/播放歌曲
 *   - 控制任意 macOS 应用的 UI（点击、输入、选择）
 *   - 读取应用状态（当前播放歌曲、窗口标题等）
 *
 * 注意：使用 System Events 发送按键需要终端拥有辅助功能权限
 *   → 系统设置 → 隐私与安全性 → 辅助功能 → 添加你使用的终端
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_applescript',
    description: `执行 AppleScript 脚本（支持多行），自动化控制 macOS 应用程序。
适合：
  - 控制 QQ 音乐搜索歌曲、播放/暂停（优先用 qqmusicmac:// URL scheme）
  - 用键盘/鼠标自动操作任意 macOS app（需辅助功能权限）
  - 读取 app 状态（正在播放什么、窗口内容等）
  - 批量操作 Finder 文件、日历事件等

使用 QQ 音乐的推荐顺序：
  1. 先尝试 URL scheme（通过 run_shell 执行 open "qqmusicmac://..."）
  2. 再用 AppleScript UI 自动化（需辅助功能权限）`,
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: '完整的 AppleScript 代码（支持多行），脚本会写入临时文件后执行，无需转义换行',
        },
      },
      required: ['script'],
    },
  },
};

export const implementation: ToolFunction = async (args: { script: string }) => {
  const script = args.script.trim();
  if (!script) return '❌ 脚本内容为空';

  // 写入临时文件：osascript -e "..." 不支持多行，必须用文件方式
  const tmpFile = join(tmpdir(), `quangan-as-${Date.now()}.applescript`);
  try {
    writeFileSync(tmpFile, script, 'utf-8');

    const output = execSync(`osascript ${JSON.stringify(tmpFile)}`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return output.trim() || '✅ AppleScript 执行成功（无输出）';
  } catch (e: any) {
    const stderr: string = e.stderr?.toString().trim() || '';
    const msg = stderr || e.message || '未知错误';

    // 辅助功能权限错误（error 1002）
    if (msg.includes('1002') || msg.includes('不允许发送按键') || msg.includes('is not allowed')) {
      return [
        '❌ AppleScript 执行失败：需要辅助功能权限',
        '',
        '请按以下步骤授权：',
        '1. 打开「系统设置」→「隐私与安全性」→「辅助功能」',
        '2. 点击「+」，添加你使用的终端（Terminal / iTerm2 等）',
        '3. 授权后重新执行命令',
        '',
        '原始错误：' + msg,
      ].join('\n');
    }

    return `❌ AppleScript 执行失败:\n${msg}`;
  } finally {
    // 清理临时文件
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
};
