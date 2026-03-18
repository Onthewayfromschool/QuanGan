import chalk from 'chalk';

const DIVIDER = chalk.gray('─'.repeat(56));

/**
 * 打印顶部标题栏
 */
export function printHeader(model: string): void {
  console.log('\n' + chalk.cyan('═'.repeat(56)));
  console.log(chalk.bold.cyan('  🤖  QuanGanGe · 全干哥'));
  console.log(chalk.gray(`  powered by ${model}`));
  console.log(chalk.cyan('═'.repeat(56)) + '\n');
}

/**
 * 打印系统提示信息
 */
export function printSystem(msg: string): void {
  console.log(chalk.gray(`[System] ${msg}`));
}

/**
 * 打印帮助信息
 */
export function printHelp(): void {
  console.log('\n' + chalk.bold.yellow('📖 命令列表:'));
  const cmds: [string, string][] = [
    ['/help', '显示帮助信息'],
    ['/history', '查看当前会话历史'],
    ['/clear', '清空对话历史，重新开始'],
    ['/tools', '查看当前已加载的工具'],
    ['/plan', '进入规划模式（只分析、不执行工具）'],
    ['/exec', '退出规划模式，切回执行模式'],
    ['/exit', '退出程序'],
  ];
  cmds.forEach(([cmd, desc]) => {
    console.log(`  ${chalk.yellow(cmd.padEnd(10))} ${chalk.gray(desc)}`);
  });
  console.log('');
}

/**
 * 打印模式切换提示
 */
export function printModeSwitch(isPlanMode: boolean): void {
  if (isPlanMode) {
    console.log('\n' + chalk.bgYellow.black.bold('  📋 Plan 模式  ') + chalk.yellow(' Agent 只会分析规划，不会执行任何工具'));
    console.log(chalk.gray('  输入任务，Agent 会给出执行计划。确认后输入 /exec 切换到执行模式\n'));
  } else {
    console.log('\n' + chalk.bgCyan.black.bold('  ⚡ Exec 模式  ') + chalk.cyan(' Agent 可以调用工具执行操作'));
    console.log(chalk.gray('  已切换回执行模式，输入 /plan 可再次进入规划模式\n'));
  }
}

/**
 * 打印用户消息
 */
export function printUserMessage(content: string): void {
  console.log(`\n${chalk.green.bold('You')} ${chalk.gray('›')} ${chalk.white(content)}`);
}

/**
 * 打印 Agent 最终回答
 */
export function printAssistantMessage(content: string): void {
  console.log(`\n${chalk.cyan.bold('Agent')} ${chalk.gray('›')} ${chalk.white(content)}`);
}

/**
 * 打印工具调用信息
 */
export function printToolCall(name: string, args: object): void {
  console.log(`\n  ${chalk.yellow('🔧')} ${chalk.yellow.bold(name)}`);
  const argsStr = JSON.stringify(args, null, 2);
  const indented = argsStr.split('\n').map(l => `     ${l}`).join('\n');
  console.log(chalk.gray(indented));
}

/**
 * 打印工具执行结果
 */
export function printToolResult(result: string): void {
  const maxLen = 400;
  const preview = result.length > maxLen
    ? result.slice(0, maxLen) + chalk.gray('\n     ... (已截断)')
    : result;
  const indented = preview.split('\n').map((l, i) => i === 0 ? `  ${chalk.blue('📤')} ${l}` : `     ${l}`).join('\n');
  console.log(chalk.white(indented));
}

/**
 * 打印已加载工具列表
 */
export function printToolList(tools: string[]): void {
  if (tools.length === 0) {
    console.log(chalk.gray('\n  (暂无工具)\n'));
    return;
  }
  console.log('\n' + chalk.bold.yellow('🛠  已加载工具:'));
  tools.forEach(t => {
    console.log(`  ${chalk.yellow('•')} ${chalk.white(t)}`);
  });
  console.log('');
}

/**
 * 打印会话历史记录
 */
export function printHistory(messages: { role: string; content: string; name?: string; tool_calls?: any[] }[]): void {
  // 过滤掉 system 消息
  const dialogue = messages.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool');

  if (dialogue.length === 0) {
    console.log(chalk.gray('\n  (暂无对话历史)\n'));
    return;
  }

  console.log('\n' + chalk.bold.yellow(`📜 会话历史 (共 ${dialogue.length} 条)`));
  console.log(DIVIDER);

  dialogue.forEach((msg, idx) => {
    const maxLen = 200;

    if (msg.role === 'user') {
      const content = msg.content.length > maxLen ? msg.content.slice(0, maxLen) + chalk.gray(' ...') : msg.content;
      console.log(`${chalk.green.bold(`[${idx + 1}] You`)}  ${chalk.white(content)}`);

    } else if (msg.role === 'assistant') {
      if (msg.tool_calls?.length) {
        // 这条是模型发出工具调用请求，展示调用了哪些工具
        const names = msg.tool_calls.map((t: any) => chalk.yellow.bold(t.function?.name)).join(', ');
        console.log(`${chalk.cyan.bold(`[${idx + 1}] Agent`)}  ${chalk.gray('🔧 调用工具:')} ${names}`);
      } else {
        const content = msg.content?.length > maxLen ? msg.content.slice(0, maxLen) + chalk.gray(' ...') : msg.content;
        console.log(`${chalk.cyan.bold(`[${idx + 1}] Agent`)}  ${chalk.white(content)}`);
      }

    } else if (msg.role === 'tool') {
      const content = msg.content.length > maxLen ? msg.content.slice(0, maxLen) + chalk.gray(' ...') : msg.content;
      const toolName = msg.name ? chalk.yellow(msg.name) : chalk.yellow('tool');
      console.log(`${chalk.blue.bold(`[${idx + 1}] Tool`)}  ${chalk.gray(`(${toolName})`)} ${chalk.gray(content)}`);
    }

    if (idx < dialogue.length - 1) console.log('');
  });

  console.log(DIVIDER + '\n');
}


export function printDivider(): void {
  console.log('\n' + DIVIDER + '\n');
}

/**
 * 打印 token 用量进度条
 * 示例：📊 Context  ████░░░░░░░░░░░  12,345 / 1,000,000 (1.2%)
 */
export function printTokenUsage(used: number, maxLimit: number): void {
  if (used === 0) return;

  const pct = used / maxLimit;
  const BAR_LEN = 20;
  const filled = Math.round(pct * BAR_LEN);
  const empty = BAR_LEN - filled;

  // 根据占比决定颜色：绿 → 黄 → 红
  const barColor = pct < 0.5 ? chalk.green : pct < 0.8 ? chalk.yellow : chalk.red;
  const bar = barColor('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));

  const usedStr  = used.toLocaleString();
  const limitStr = maxLimit.toLocaleString();
  const pctStr   = (pct * 100).toFixed(1) + '%';

  console.log(`  ${chalk.gray('📊 Context')}  ${bar}  ${chalk.white(usedStr)} / ${chalk.gray(limitStr)} ${chalk.gray(`(${pctStr})`)}`);
}

/**
 * 打印错误信息
 */
export function printError(msg: string): void {
  console.log(`\n${chalk.red('✖')} ${chalk.red(msg)}`);
}

/**
 * 创建 CLI 加载动画
 */
export function createSpinner(text: string) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(frames[i % frames.length])} ${chalk.gray(text)}  `);
    i++;
  }, 80);

  return {
    stop() {
      clearInterval(timer);
      process.stdout.write('\r' + ' '.repeat(text.length + 10) + '\r');
    },
  };
}
