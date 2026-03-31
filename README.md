# QuanGan（全干）

> 一个用来练手的 AI Agent 项目，顾名思义——啥都能干。

从最基础的大模型 API 调用开始，一步步搭出一个真正能用的多 Agent 系统。主 Agent「小玉」负责调度，Coding Agent 处理代码任务，Daily Agent 处理日常任务。代码结构保持清晰，适合边看边学，也适合拿来当你自己 Agent 项目的起点。

---

## 目前实现了什么

### 🤖 Agent 核心
- 封装百炼（DashScope）大模型调用，兼容 OpenAI 接口规范
- 支持普通对话 / 流式输出 / 多轮上下文
- 完整的 Function Calling 循环（工具调用 → 执行 → 回传结果 → 继续推理）
- **多 Provider 支持**：通过 `ILLMClient` 统一接口抽象，可无缝切换 DashScope（OpenAI 兼容）/ Kimi / Kimi for Coding（Anthropic 协议）等不同厂商模型

### 🌐 多 Agent 架构（工具型）

主 Agent「小玉」通过 Function Call 调用两个专属子 Agent，自主决策任务路由：

```
用户输入
   ↓
小玉（主 Agent，ReAct 循环）
   ├─ coding_agent(task) → Coding Agent → 返回结果
   └─ daily_agent(task)  → Daily Agent  → 返回结果
```

**🧠 小玉（主 Agent）** — 记忆工具

| 工具 | 能做什么 |
|------|----------|
| `recall_memory` | 检索核心记忆 + 最近 7 天日常记忆，涉及具体项目或历史决定时主动调用 |
| `update_life_memory` | 将当前会话摘要保存到今日 lifeMemory 文件（上下文压缩时自动触发） |
| `consolidate_core_memory` | LLM 分析近 14 天日常记忆，归纳重复主题，更新核心记忆 |

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
| `web_search` | 联网搜索（Tavily API），返回 AI 生成摘要 + 结构化结果列表，支持 basic/advanced 搜索深度 |
| `read_url` | 读取任意网页全文（Jina Reader），自动转换为干净 Markdown，无需 API Key |

**🌟 Daily Agent** — 日常任务

| 工具 | 能做什么 |
|------|----------|
| `open_app` | 打开 macOS 应用程序（QQ音乐、微信等） |
| `open_url` | 在浏览器中打开网址或搜索关键词 |
| `run_shell` | 执行任意 shell 命令；内置网易云 ncm-cli 优先策略，播放/搜索音乐直接调用 ncm-cli，无需手动探索命令格式 |
| `run_applescript` | 执行 AppleScript 脚本，自动化控制任意 macOS 应用（搜索歌曲、操作 UI 等） |
| `browser_action` | Playwright 浏览器自动化（navigate / click / type / 获取页面文本等），登录态持久化保存，首次登录后永久复用 |

内置命令：`/help` `/history` `/tools` `/clear` `/plan` `/exec` `/voice` `/provider` `/exit`

**CLI 快捷交互：**
- 输入 `/` 弹出命令选择菜单，↑↓ 导航，Enter 确认，ESC 取消
- Agent 运行中按 `ESC` 立即中断当次调用（基于 AbortController，fetch 请求即时取消）

### 🔀 多 Provider 切换

输入 `/provider` 弹出供应商选择器：

- **一键切换**：所有已配置（且 API Key 有效）的供应商高亮显示，选中即生效
- **即时配置**：选中未配置的供应商时，直接在终端输入 API Key 和模型名，无需手动改文件
- **自动持久化**：输入的 Key / 模型名立即写入 `.env`，下次启动无需重新配置
- **占位符检测**：自动识别 `xxxx`、`your_key_here` 等无效占位符，确保配置真实有效
- **修改模型**：列表末尾「✏️ 修改当前模型」可随时切换当前供应商的模型

支持的 Provider：

| Provider | 协议 | 默认模型 | 说明 |
|----------|------|----------|------|
| `dashscope` | OpenAI 兼容 | `qwen-plus` | 阿里云百炼，默认供应商 |
| `kimi` | OpenAI 兼容 | `moonshot-v1-8k` | Moonshot AI |
| `openai` | OpenAI 原生 | `gpt-4o` | OpenAI |
| `kimi-code` | Anthropic 协议 | `k2p5` | Kimi for Coding，支持 thinking 模式 |

### 🎤 语音交互模式

输入 `/voice` 进入语音模式，赋予小玉「耳朵」和「嘴巴」：

- **ASR（语音转文字）**：按 Enter 开始录音，静音自动停止，通过阿里云 Qwen3-ASR-Flash 识别为文字后传给 Agent
- **TTS（文字转语音）**：Agent 回复后自动朗读，使用百炼 CosyVoice（cosyvoice-v3.5-plus）合成，默认音色为定制温柔女声，可随时中断
- **可中断设计**：开始录音 / Ctrl+C 退出时立即停止当前朗读，不会录入自己的声音
- **自定义音色**：运行 `npm run voice-design`，用自然语言描述想要的声音，试听满意后自动写入配置，下次启动即生效

> 需要安装 [sox](https://sox.sourceforge.net/)（`brew install sox`）用于录音；ASR 和 TTS 均需要 DashScope API Key

### 💾 会话持久化
每次退出后对话记录自动保存，下次在同一目录启动时自动恢复，不同项目独立存档。输入 `/clear` 会将当前对话**归档**（带时间戳重命名保留）并开启新对话，旧记录不会丢失，保存在 `.sessions/` 目录中。

### 📋 Plan 模式
输入 `/plan` 进入规划模式：Agent 可以读取代码、搜索文件，但**不会写入任何文件**，最终输出结构化执行计划。确认后输入 `/exec` 切回执行模式，让 Agent 按计划执行。

### 📊 Token 用量可视化
每次回复后自动展示上下文占用进度条，颜色随占用比例变化（绿 → 黄 → 红），一眼看出距离上下文上限还有多少空间。

### ♻️ 上下文自动压缩
token 用量超过阈值时自动触发滚动摘要压缩：旧消息由 LLM 生成摘要后存档，仅保留摘要节点 + 最近几轮对话发给模型，上下文 token 量始终有上界，不会随对话长度无限增长。完整历史仍保留在 `/history` 可查看。

### 🧠 记忆系统
小玉拥有跨会话的两层记忆，类人类的重复强化机制：

- **coreMemory（核心记忆）**：长期稳定的用户偏好、项目背景、重要结论，存储在 `.memory/core-memory.json`。每次启动自动注入到系统提示词，无需调用即可感知。
- **lifeMemory（日常记忆）**：每次上下文压缩时，自动将当前会话摘要为一篇日记，存储在 `.memory/life/lifeMemory-<主题>-<日期>-<id>.md`，可通过 `recall_memory` 工具按需检索。
- **晋升机制**：每 3 次压缩后，LLM 自动分析近 14 天日记，将重复出现的主题归纳写入 coreMemory，`reinforceCount` 字段记录强化次数——越常出现的记忆越重要。

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

### 4. 配置联网搜索（可选）

去 [app.tavily.com](https://app.tavily.com) 注册，免费 1000 次/月，拿到 Key 后写入 `.env`：

```env
TAVILY_API_KEY=tvly-你的密钥
```

> `read_url`（Jina Reader）无需 API Key，直接可用

### 5. 全局命令（可选）

配置后可在任意目录使用 `quangan` 命令：

```bash
echo 'alias quangan="node /path/to/QuanGan/bin/coding-agent.cjs"' >> ~/.zshrc
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
│   ├── coding/      # Coding Agent 工厂（deny list 权限控制）
│   └── daily/       # Daily Agent 工厂（deny list 权限控制）
├── tools/           # 全局工具池（所有工具统一注册，14 个工具 + registry.ts + types.ts）
├── memory/          # 记忆系统（memory-store.ts 文件 I/O、tools.ts 工具定义）
├── voice/           # 语音模块（ASR 识别 + TTS 朗读 + 录音 + voice-design 音色定制）
├── cli/
│   ├── session-store.ts  # 会话持久化（JSON 文件读写）
│   ├── index.ts          # 小玉主 Agent 入口
│   └── ui/               # Ink 组件层
│       ├── App.tsx        # 根组件（Static 历史区 + 动态底部）
│       ├── store.ts       # ChatStore：命令式→响应式桥接
│       ├── types.ts       # ChatEvent 联合类型
│       ├── components/    # Header / ChatMessage / ToolCall / ToolResult / SystemMsg / Spinner / TokenBar
│       ├── pickers/       # CommandPicker（/命令菜单）/ ProviderPicker（供应商切换）
│       └── utils/         # highlightJson（工具参数语法高亮）
├── examples/        # 学习用示例代码
bin/
└── coding-agent.cjs # 全局启动入口（CJS 包装器，spawn tsx/esm）
docs/                # 开发日志
skills/              # 自定义 Skill（dev-log-writer / developer-words-recorder / daily-record）
.sessions/           # 会话存档（自动生成，已 gitignore）
.memory/             # 记忆存档（自动生成，已 gitignore）
```

---

## 如何扩展

**添加新工具：**
1. 在 `src/tools/` 下新建文件，导出 `definition` 和 `implementation`
2. 在 `src/tools/registry.ts` 的 `createGlobalToolRegistry()` 中注册新工具
3. 如需限制某 Agent 不能使用该工具，将工具名加入对应的 deny list（`CODING_AGENT_DENY` 或 `DAILY_AGENT_DENY`）

**添加新的子 Agent：**
1. 在 `src/agents/` 下新建目录，创建工厂函数 `createXxxAgent()`
2. 调用 `createGlobalToolRegistry()` + `registerWithDenyList()` 注入工具（按需设置 deny list）
3. 在 `src/cli/index.ts` 里将新 Agent 注册为小玉的工具

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
- [x] `/clear` 归档化（旧对话带时间戳归档保留，不再直接删除）
- [x] Daily Agent 提示词策略化（移除内联实现细节，提示词只管优先级）
- [x] Agent 两层记忆系统（coreMemory 长期记忆 + lifeMemory 每日日记，压缩时自动更新，记忆存储在 QuanGan 全局目录，跨项目共享）
- [x] 多 Provider 支持（DashScope / Kimi / Kimi for Coding / OpenAI）
- [x] `ILLMClient` 统一接口抽象，支持 OpenAI 兼容和 Anthropic 协议双层客户端
- [x] `/provider` 命令：TUI 一键切换 Provider，配置即时持久化到 `.env`
- [x] CLI UI 迁移至 Ink + Clack（React 组件化 TUI，`<Static>` 历史区 + 动态底部，输入框圆角边框）
- [x] Coding Agent 联网搜索（Tavily API `web_search` + Jina Reader `read_url`，信息检索路由加固）
- [ ] 终端输出代码片段显示文件名 + 行号（便于快速定位和复制）
- [ ] ReAct 推理过程可视化
- [ ] 更多等你来提 Issue

---

## 技术栈

- TypeScript + tsx（ESM 模式，`node --import tsx/esm`）
- 百炼 DashScope API（OpenAI 兼容）
- Kimi for Coding（Anthropic Messages API 协议，`k2p5` thinking 模式）
- Qwen3-ASR-Flash（语音识别）
- 百炼 CosyVoice（cosyvoice-v3.5-plus，WebSocket TTS 语音合成）
- **Ink**（React-based 终端 UI，组件化渲染）+ **Clack**（交互式流程向导）
- **Tavily API**（联网搜索，AI 生成摘要）+ **Jina Reader**（网页全文转 Markdown，零 Key）
- Node.js 内置 readline / child_process
- sox（录音，需单独安装）

---

## License

MIT
