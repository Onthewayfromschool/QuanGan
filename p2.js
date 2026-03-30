const fs = require('fs');
let src = fs.readFileSync('src/cli/display.ts', 'utf8');

// 主要回答：小玉回复内容 chalk.white → chalk.reset（终端默认色，深浅主题都清晰）
// printAssistantMessage
src = src.replace(
  `chalk.magenta.bold('\\u5c0f\\u7389')} \${chalk.gray('\\u203a')} \${chalk.white(content)}`,
  `chalk.magenta.bold('\\u5c0f\\u7389')} \${chalk.gray('\\u203a')} \${chalk.reset(content)}`
);

// printUserMessage
src = src.replace(
  `chalk.green.bold('You')} \${chalk.gray('›')} \${chalk.white(content)}`,
  `chalk.green.bold('You')} \${chalk.gray('›')} \${chalk.reset(content)}`
);

// printVoiceTranscribed
src = src.replace(
  `chalk.magenta.bold('🎤 You')} \${chalk.gray('›')} \${chalk.white(text)}`,
  `chalk.magenta.bold('🎤 You')} \${chalk.gray('›')} \${chalk.reset(text)}`
);

// /history Agent content
src = src.replace(
  `chalk.cyan.bold(\`[\${idx + 1}] Agent\`)}  \${chalk.white(content)}`,
  `chalk.cyan.bold(\`[\${idx + 1}] Agent\`)}  \${chalk.reset(content)}`
);

// /history You content
src = src.replace(
  `chalk.green.bold(\`[\${idx + 1}] You\`)}  \${chalk.white(content)}`,
  `chalk.green.bold(\`[\${idx + 1}] You\`)}  \${chalk.reset(content)}`
);

fs.writeFileSync('src/cli/display.ts', src, 'utf8');
console.log('done');
