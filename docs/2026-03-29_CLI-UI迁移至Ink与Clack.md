# 2026-03-29 开发日志

## 今日实现

### 1. CLI UI 迁移至 Ink + Clack

**背景/问题：** 原 CLI 使用 readline + chalk 手写显示层（`display.ts`），随着功能增多（命令菜单、Provider 选择器、Token Bar、Spinner 等），display.ts 膨胀至数百行，各功能耦合在一起，维护困难；视觉效果也停留在简单 chalk 着色，无法实现输入框边框、响应式重渲染等现代 TUI 交互。

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| chalk + readline（原有） | 零依赖，轻量 | 命令式输出，无状态管理，组件复用困难 |
| @opentui/solid | GPU 级渲染，Flexbox | 依赖 Bun 运行时，Node.js 项目不可用 |
| **Ink + Clack（选用）** | React 组件模型，Node.js 原生，成熟稳定 | ink v6 是 ESM-only，需解决 ESM 兼容 |

选型理由：Ink 将 React 组件树渲染到终端，天然支持状态响应式更新和 Flexbox 布局；Clack 专注流程向导交互，两者互补，覆盖所有 CLI 交互场景。

**涉及文件：**
- `src/cli/ui/types.ts` — 新建，`ChatEvent` 联合类型（10 种事件）
- `src/cli/ui/store.ts` — 新建，`ChatStore` 命令式→响应式桥接层，用 `DistributedOmit` 解决 discriminated union 上 `Omit` 推断错误
- `src/cli/ui/App.tsx` — 新建，Ink 根组件，`<Static>` 渲染历史消息，底部渲染动态区
- `src/cli/ui/components/` — 新建 7 个组件：Header、ChatMessage、ToolCall、ToolResult、SystemMsg、Spinner、TokenBar
- `src/cli/ui/pickers/CommandPicker.tsx` — 新建，`/` 触发命令菜单
- `src/cli/ui/pickers/ProviderPicker.tsx` — 新建，多阶段 Provider 切换，`mask="*"` 密码输入
- `src/cli/ui/utils/highlightJson.ts` — 新建，工具参数 JSON 语法高亮
- `src/cli/index.ts` — 从 771 行重构为 252 行，去除所有 printX，改用 `store.push()` + `render(<App>)`
- `src/cli/display.ts` — 删除
- `src/cli/command-picker.ts` — 删除
- `src/voice/voice-design.ts` — 迁移到 @clack/prompts
- `tsconfig.json` — 加 `jsx: react-jsx`，`module: NodeNext`

**实现要点：**

```typescript
// DistributedOmit：让 Omit 在 discriminated union 上正确分发
type DistributedOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;
export type ChatEventInput = DistributedOmit<ChatEvent, 'id'>;

// ChatStore：命令式推送 → React 响应式
export class ChatStore {
  push(event: ChatEventInput): void {
    const full = { ...event, id: String(this.counter++) } as ChatEvent;
    this.events.push(full);
    this.listeners.forEach(fn => fn(this.events));
  }
}
```

Ink `<Static>` 组件是历史消息区的关键：已渲染项不再重绘，随终端自然滚动；只有底部动态区（输入框、Spinner）保持活跃重渲染，兼顾性能与交互。

---

### 2. ESM 运行时报错修复（ink v6 兼容）

**背景/问题：** Ink + Clack UI 迁移完成后，`quangan` 命令实际运行时报错：`require() cannot be used on an ESM graph with top-level await`。根因是 ink v6 含 top-level await，Node.js 无法通过 `require()` 加载；而项目的 `bin/coding-agent.js` 和 `package.json` 仍是 CJS 模式，tsx 也因此以 CJS 模式运行，遇到 ESM 包就崩溃。

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 降级 ink 到 v3（CJS 版） | 无需改项目配置 | 放弃新特性，版本老旧 |
| `--experimental-require-module` | 无需改配置 | Node 实验性 flag，不稳定 |
| **`"type": "module"` + `node --import tsx/esm`（选用）** | 正确解决根因，ESM 原生支持 | 需同步修复 `__dirname`、bin 脚本 |

选型理由：只有让整个项目以 ESM 模式运行，才能从根本上解决 `require()` ESM 包的问题；tsx 的 `--import` 加载器模式不启动 IPC pipe，比直接用 tsx 二进制更干净。

**涉及文件：**
- `package.json` — 加 `"type": "module"`；`cli` 脚本从 `tsx src/cli/index.ts` 改为 `node --import tsx/esm src/cli/index.ts`
- `bin/coding-agent.cjs` — 新建，替换旧 `coding-agent.js`；`.cjs` 扩展名使其永远以 CJS 引擎加载，内部用 `spawn` 启动 `tsx/esm`
- `bin/coding-agent.js` — 删除
- `src/agent/agent.ts` / `src/llm/client.ts` / `src/llm/types.ts` — 修复内联 `import('../llm/types')` 类型表达式缺 `.js` 后缀（NodeNext 严格检查）

**实现要点：**

```javascript
// bin/coding-agent.cjs：薄 CJS 包装器
const { spawn } = require('child_process');
const path = require('path');
const tsx  = path.join(__dirname, '../node_modules/.bin/tsx');
const entry = path.join(__dirname, '../src/cli/index.ts');
spawn(tsx, [entry], { stdio: 'inherit', shell: false })
  .on('exit', code => process.exit(code ?? 0));
```

---

### 3. `__dirname` ESM 适配

**背景/问题：** 加了 `"type": "module"` 后，Node.js 以 ESM 模式加载文件，`__dirname` 和 `__filename` 不再自动注入，导致 `session-store.ts` 启动时报 `ReferenceError: __dirname is not defined`。

**涉及文件：**
- `src/cli/session-store.ts` — `__dirname` → `import.meta.dirname`
- `src/cli/index.ts` — 同上（2 处）
- `src/memory/memory-store.ts` — 同上

**实现要点：** Node.js 22 原生支持 `import.meta.dirname` / `import.meta.filename`，无需任何 polyfill，直接替换即可。

---

### 4. 输入框圆角边框样式

**背景/问题：** Ink UI 上线后，输入区域只有一个 `>` 提示符 + 光标，视觉上和聊天内容没有明显区分，不容易找到输入焦点。

**涉及文件：**
- `src/cli/ui/App.tsx` — `InputArea` 组件：外层 `Box` 加 `borderStyle="round"`，边框颜色随模式变化，底部加操作提示行

**实现要点：**

```tsx
const borderColor = mode === 'plan' ? 'yellow' : mode === 'voice' ? 'magenta' : 'gray';

<Box marginTop={1} flexDirection="column">
  <Box borderStyle="round" borderColor={borderColor} paddingX={1}>
    <Text color={promptColor} bold>{promptText}</Text>
    <TextInput ... />
  </Box>
  <Text dimColor>{hint}</Text>
</Box>
```

三种模式边框颜色不同（text=灰、plan=黄、voice=品红），底部提示行用 `dimColor` 降调，视觉层次清晰。

---

### 5. daily-record Skill 日期修复

**背景/问题：** daily-record skill 每次执行都用 AI 内置的日期知识判断"今天"，导致日期不准（AI 的训练截止日期 ≠ 用户实际日期）。

**涉及文件：**
- `skills/daily-record/SKILL.md` — 在最前面加"第零步"，强制用 `date '+%Y-%m-%d'` 命令获取系统真实日期
- `~/.qoder/skills/daily-record/SKILL.md` — 同步更新全局 skill

**实现要点：** 在 skill 指令开头明确写"AI 内置的日期知识不可靠，必须通过终端命令获取"，并给出具体命令 `date '+%Y-%m-%d'`，让 AI 每次触发时先执行再继续。

---

## 关键收获

1. **Ink 组件化 TUI 的核心模式**：`ChatStore` 作为命令式→响应式桥接层，外部代码调 `store.push(event)` 推送事件，React 组件通过订阅自动重渲染；`<Static>` 渲染已完成的历史消息（不再重绘），动态底部区域（输入框、Spinner）保持活跃，兼顾性能与实时交互。

2. **DistributedOmit 解决 discriminated union 上的 Omit 推断问题**：`Omit<UnionType, K>` 不会分发到每个成员，导致类型推断错误；正确写法：`type DistributedOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never`。

3. **ESM-only 包的正确兼容路径**：`"type": "module"` + `node --import tsx/esm` 是 Node.js 项目兼容 ink v6 等 ESM-only 包的标准解法；tsx 的 `--import` 加载器模式比 tsx 二进制更轻量，不启动 IPC watch server。

4. **CJS/ESM 共存的扩展名约定**：项目加了 `"type": "module"` 后，`.js` 全变 ESM；需要保留 CJS 语法的文件（如 bin 入口、工具脚本）改用 `.cjs` 扩展名，Node.js 会按扩展名决定引擎，两者可以在同一项目里共存。

5. **`import.meta.dirname` 是 `__dirname` 的 ESM 原生替代**：Node.js 22 无需 shim，直接用，比网上流传的 `fileURLToPath(new URL('.', import.meta.url))` 写法简洁得多。

6. **Skill 日期可靠性**：AI 的日期知识来自训练截止，实际运行日期可能相差数月甚至更久。凡是需要日期的 Skill，都应该在第一步通过 `date` 命令获取系统时间，而非依赖 AI 内置知识。
