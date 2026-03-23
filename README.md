# QuanGan（全干）

> 一个用来练手的 AI Agent 项目，顾名思义——啥都能干。

从最基础的大模型 API 调用开始，一步步搭出一个真正能用的多 Agent 系统。主 Agent「小玉」负责调度，Coding Agent 处理代码任务，Daily Agent 处理日常任务。代码结构保持清晰，适合边看边学，也适合拿来当你自己 Agent 项目的起点。

---

## 目前实现了什么

### 🤖 Agent 核心
- 封装百炼（DashScope）大模型调用，兼容 OpenAI 接口规范
- 支持普通对话 / 流式输出 / 多轮上下文
- 完整的 Function Calling 循环（工具调用 → 执行 → 回传结果 → 继续推理）

### 🌐 多 Agent 架构（工具型）

主 Agent「小玉」通过 Function Call 调用两个专属子 Agent，自主决策任务路由：

```
用户输入
   ↓
小玉（主 Agent，ReAct 循环）
   ├─ coding_agent(task) → Coding Agent → 返回结果
   └─ daily_agent(task)  → Daily Agent  → 返回结果
```

**💻 Coding Agent** — 代码相关任务

| 工具 | 能做什么 |
|------|----------|
| `read_file` | 读取文件内容，支持指定行范围 |
| `write_file` | 创建 / 覆盖写入文件 |
| `edit_file` | 局部编辑文件，查找替换指定文本 |
| `list_directory` | 列出目录结构 |
| `execute_command` | 执行 shell 命令（支持后台启动服务）；对项目目录外的 rm/mv/cp 操作自动拦截并询问确认 |
| `search_code` | 在代码库中搜索关键词（支持正则） |
| `verify_code` | 对 TypeScript 项目运行 `tsc --noEmit` 编译检查，Agent 写完代码后自动验证类型正确性 |

**🌟 Daily Agent** — 日常任务

| 工具 | 能做什么 |
|------|----------|
| `open_app` | 打开 macOS 应用程序（QQ音乐、微信等） |
| `open_url` | 在浏览器中打开网址或搜索关键词 |
| `run_shell` | 执行任意 shell 命令 |
| `run_applescript` | 执行 AppleScript 脚本，自动化控制任意 macOS 应用（搜索歌曲、操作 UI 等） |
| `browser_action` | Playwright 浏览器自动化（navigate / click / type / 获取页面文本等），登录态持久化保存，首次登录后永久复用 |

内置命令：`/help` `/history` `/tools` `/clear` `/plan` `/exec` `/voice` `/exit`

**CLI 快捷交互：**
- 输入 `/` 弹出命令选择菜单，↑↓ 导航，Enter 确认，ESC 取消
- Agent 运行中按 `ESC` 立即中断当次调用（基于 AbortController，fetch 请求即时取消）

### 🎤 语音交互模式

输入 `/voice` 进入语音模式，赋予小玉「耳朵」和「嘴巴」：

- **ASR（语音转文字）**：按 Enter 开始录音，静音自动停止，通过阿里云 Qwen3-ASR-Flash 识别为文字后传给 Agent
- **TTS（文字转语音）**：Agent 回复后自动朗读，使用百炼 CosyVoice（cosyvoice-v3.5-plus）合成，默认音色为定制温柔女声，可随时中断
- **可中断设计**：开始录音 / Ctrl+C 退出时立即停止当前朗读，不会录入自己的声音
- **自定义音色**：运行 `npm run voice-design`，用自然语言描述想要的声音，试听满意后自动写入配置，下次启动即生效

> 需要安装 [sox](https://sox.sourceforge.net/)（`brew install sox`）用于录音；ASR 和 TTS 均需要 DashScope API Key

### 💾 会话持久化
每次退出后对话记录自动保存，下次在同一目录启动时自动恢复，不同项目独立存档。

### 📋 Plan 模式
输入 `/plan` 进入规划模式：Agent 可以读取代码、搜索文件，但**不会写入任何文件**，最终输出结构化执行计划。确认后输入 `/exec` 切回执行模式，让 Agent 按计划执行。

### 📊 Token 用量可视化
每次回复后自动展示上下文占用进度条，颜色随占用比例变化（绿 → 黄 → 红），一眼看出距离上下文上限还有多少空间。

### ♻️ 上下文自动压缩
token 用量超过阈值时自动触发滚动摘要压缩：旧消息由 LLM 生成摘要后存档，仅保留摘要节点 + 最近几轮对话发给模型，上下文 token 量始终有上界，不会随对话长度无限增长。完整历史仍保留在 `/history` 可查看。

---

## 快速上手

### 1. 克隆 & 安装

```bash
git clone https://github.com/你的用户名/QuanGan.git
cd QuanGan
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env`，填入你的百炼 API Key：

```env
DASHSCOPE_API_KEY=sk-你的密钥
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus
```

> 没有 Key？去 [百炼控制台](https://bailian.console.aliyun.com/) 免费申请

### 3. 启动

```bash
# 启动小玉
npm run cli

# 自定义 TTS 音色（可选）
npm run voice-design

# 或者只跑基础对话示例
npm run dev
```

### 4. 全局命令（可选）

配置后可在任意目录使用 `quangan` 命令：

```bash
echo 'alias quangan="node /path/to/QuanGan/bin/coding-agent.js"' >> ~/.zshrc
source ~/.zshrc

# 然后去你的项目目录
cd ~/my-project
quangan
```

---

## 项目结构

```
src/
├── config/          # 配置管理（从环境变量加载）
├── llm/             # 大模型客户端
├── agent/           # Agent 基类（通用 Function Calling 循环）
├── agents/
│   ├── coding/      # Coding Agent 工厂 + 工具（read/write/exec 等）
│   └── daily/       # Daily Agent 工厂 + 工具（open_app/open_url/run_shell/run_applescript/browser_action）
├── voice/           # 语音模块（ASR 识别 + TTS 朗读 + 录音）
├── tools/           # 工具类型定义
├── cli/
│   ├── session-store.ts  # 会话持久化（JSON 文件读写）
│   ├── display.ts        # TUI 渲染（chalk + spinner）
│   ├── command-picker.ts # `/` 命令快捷选择菜单
│   └── index.ts          # 小玉主 Agent 入口
├── voice/
│   ├── tts.ts       # CosyVoice WebSocket TTS 合成
│   ├── asr.ts       # Qwen3-ASR-Flash 语音识别
│   ├── recorder.ts  # sox 录音控制
│   └── voice-design.ts  # 交互式音色定制工具
├── examples/        # 学习用示例代码
bin/
└── coding-agent.js  # 全局启动入口
docs/                # 开发日志
skills/              # 自定义 Skill（dev-log-writer / developer-words-recorder / daily-record）
.sessions/           # 会话存档（自动生成，已 gitignore）
```

---

## 如何扩展

**添加 Coding 工具：**
1. 在 `src/agents/coding/tools/` 下新建文件，导出 `definition` 和 `implementation`
2. 在 `src/agents/coding/tools/index.ts` 里追加到 `ALL_CODING_TOOLS`

**添加 Daily 工具：**
1. 在 `src/agents/daily/tools/` 下新建文件
2. 在 `src/agents/daily/tools/index.ts` 里追加到 `ALL_DAILY_TOOLS`

**添加新的子 Agent：**
1. 在 `src/agents/` 下新建目录，创建工厂函数 `createXxxAgent()`
2. 在 `src/cli/index.ts` 里将新 Agent 注册为小玉的工具

---

## 后续计划

- [x] 多 Agent 架构（全干哥 + Coding Agent + Daily Agent）
- [x] Plan & Execute 模式
- [x] 会话持久化
- [x] Token 用量展示 + 上下文自动压缩
- [x] 语音交互模式（ASR + TTS，`/voice` 命令）
- [x] 百炼 CosyVoice TTS 集成（定制音色，替代 macOS say）
- [x] 交互式音色定制工具（`npm run voice-design`）
- [x] Daily Agent AppleScript 工具（控制任意 macOS 应用）
- [x] Daily Agent 浏览器自动化（Playwright，持久化登录态）
- [x] CLI `/` 命令快捷选择菜单
- [x] ESC 中断 Agent 调用（AbortController 即时取消）
- [x] Coding Agent 路径安全守卫（危险命令越界自动拦截 + y/N 确认）
- [x] `verify_code` 编译验证工具（tsc --noEmit，Agent 写完代码后自检）
- [ ] 终端输出代码片段显示文件名 + 行号（便于快速定位和复制）
- [ ] ReAct 推理过程可视化
- [ ] 更多等你来提 Issue

---

## 技术栈

- TypeScript + ts-node
- 百炼 DashScope API（OpenAI 兼容）
- Qwen3-ASR-Flash（语音识别）
- 百炼 CosyVoice（cosyvoice-v3.5-plus，WebSocket TTS 语音合成）
- chalk（终端颜色）
- Node.js 内置 readline / child_process
- sox（录音，需单独安装）

---

## License

MIT
