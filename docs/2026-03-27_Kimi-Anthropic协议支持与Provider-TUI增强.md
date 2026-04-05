# 2026-03-27 开发日志

## 今日实现

### 1. Kimi for Coding Anthropic 协议支持

**背景/问题：** Kimi for Coding 不走 OpenAI 兼容接口，而是采用 Anthropic Messages API 协议——端点 `/messages`、鉴权 `x-api-key`、`system` 提取为顶层字段、工具调用格式为 `tool_use`/`tool_result`。原来统一走 OpenAI 格式的 `LLMClient` 无法对接，导致 403 / 调用失败。

**涉及文件：**
- `src/llm/types.ts` — 新增 `ChatOptions`、`AgentCallRequest`、`AgentCallResponse` 类型；定义 `ILLMClient` 统一接口（`chat / chatStream / agentCall / ask`）
- `src/llm/anthropic-client.ts`（新建）— 完整 Anthropic 协议客户端：消息双向格式转换（OpenAI-like ↔ Anthropic）、`tool_use`/`tool_result` 批处理、thinking 模式自动启用（`k2p5`/`kimi-k2-thinking`）
- `src/llm/client.ts` — `LLMClient implements ILLMClient`；新增 `createLLMClient()` 工厂函数，按 `config.protocol` 自动路由到 `LLMClient` 或 `AnthropicClient`
- `src/config/llm-config.ts` — `LLMConfig` 新增 `protocol?: 'openai' | 'anthropic'`；`kimi-code` provider 更新为 `defaultModel: 'k2p5'`、`protocol: 'anthropic'`；`loadConfigFromEnv` 透传 `protocol`
- `src/agent/agent.ts` — `AgentConfig.client` 类型改为 `ILLMClient`；`run()` 改用 `client.agentCall()`；`compressContext()` 改用 `client.chat()`
- `src/agents/coding/index.ts` — 参数类型 `DashScopeClient` → `ILLMClient`
- `src/agents/daily/index.ts` — 同上
- `src/memory/index.ts` — 同上
- `src/memory/tools.ts` — 同上

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 各模块直接对两套协议做 if/else 判断 | 改动少 | 所有调用点都要感知协议，耦合严重 |
| **`ILLMClient` 接口 + 工厂函数（选用）** | 调用方零感知，协议细节封装在客户端内 | 需重构现有类型引用 |

选型理由：让 Agent / 记忆模块完全与协议解耦，后续接入更多 LLM 厂商只需新增客户端实现类，不用改任何业务代码。

**实现要点：**
- Anthropic 协议的 `system` 消息必须从 messages 数组中提取出来作为顶层字段，`AnthropicClient.convertMessages()` 专门处理
- `tool_result` 多条需要批处理成一个 `user` 消息，否则 API 报格式错误
- Agent 历史消息始终用 OpenAI-like 格式存储，`AnthropicClient` 在发请求时负责转换；响应也反向转换回 OpenAI-like 存入历史，避免两套存储格式共存
- Thinking 模式（`budgetTokens: 16000`）只对 `k2p5`/`kimi-k2-thinking` 等特定模型自动启用

---

### 2. `/provider` TUI 增强：kimi-code 支持、密钥输入与持久化

**背景/问题：** 原 `/provider` 选择器有三处缺陷：① `kimi-code` 因名称含连字符，`name.toUpperCase()` 生成无效环境变量名 `KIMI-CODE`，导致被过滤掉；② 只展示「已配置」的 provider，新用户无法通过 TUI 配置；③ 每次换供应商都要手动改 `.env`，体验差。

**涉及文件：**
- `src/cli/index.ts` — `showProviderPicker`：修复连字符转下划线（`replace(/-/g, '_')`）；展示全部 provider（未配置者标注 `[未配置]`）；选中未配置项时弹出 API Key + 模型名输入；末尾新增「✏️ 修改当前模型」选项。新增 `persistEnv(key, value)` 函数（就地更新已有 key 或追加新 key）；`switchProvider` 也改用相同的连字符转下划线规则。

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 弹出 $EDITOR 编辑 .env | 原生体验 | 需要额外依赖，跨平台复杂 |
| **readline 逐行输入 + `fs.writeFileSync`（选用）** | 无额外依赖，已有 readline 实例可复用 | 功能相对简单 |

选型理由：项目已有 readline 实例，直接复用，与现有 TUI 流程保持一致；`persistEnv` 用正则就地替换，已存在的 key 不会重复写入。

**实现要点：**
- `persistEnv` 读取 `.env` → 用 `new RegExp('^KEY=.*$', 'm')` 匹配旧值就地替换，不存在则追加；文件末尾换行符做了兼容处理
- provider 名称转环境变量 key 的规则：`name.replace(/-/g, '_').toUpperCase()`，在 `showProviderPicker`、`switchProvider`、`loadConfigFromEnv` 三处保持一致

---

### 3. API Key 有效性校验（占位符检测）

**背景/问题：** `.env` 中 `KIMI_CODE_API_KEY=xxxx` 这类占位符值会被 `!!process.env[key]` 误判为「已配置」，TUI 不弹出输入框，用户配置流程被跳过。

**涉及文件：**
- `src/cli/index.ts` — 新增 `isValidApiKey(key)` 函数；`showProviderPicker` 的 `configured` 字段改用此函数；`switchProvider` 的 key 检查也改用此函数

**实现要点：**
```
isValidApiKey: 空值 → false | 长度 < 20 → false | 全相同字符（/^(.)\1+$/）→ false | 含 'your' → false
```
覆盖最常见占位符场景（`xxxx`、`your_api_key_here`、`sk-xxx` 等短测试值），不依赖厂商特定格式，对所有 provider 通用。

---

### 4. `/provider` 输入 UI 优化

**背景/问题：** 原来用 `process.stdout.write` 写标签、`rl.question('')` 空字符串接收输入，两者分开导致标签和输入光标在终端中错位显示，用户不清楚应在何处输入。

**涉及文件：**
- `src/cli/index.ts` — `promptForApiKey`、`promptForModel` 中将标签并入 `rl.question()` 的第一个参数；两函数均在输入前打印横线分隔框和标题，明确当前交互上下文；`API Key > ` / `新模型名 > ` 作为明确的输入提示符

**实现要点：** `rl.question(prompt, callback)` 的 prompt 参数由 readline 与输入光标紧密结合，不会产生 `stdout.write` 与 readline 事件循环的时序错位。

---

## 关键收获

1. **接口抽象时机**：当同一行为（调用 LLM）需要两套完全不同的实现时，立即引入接口层而非条件分支——改动面更小，日后扩展更自然
2. **协议无关的历史存储**：Agent 消息历史统一用一种格式（OpenAI-like）存储，客户端在发送前负责格式转换——避免历史数据与协议耦合，切换供应商不需要迁移历史
3. **readline 的正确姿势**：输入提示必须放在 `rl.question()` 的第一个参数，而非用 `stdout.write` 提前写出，否则在某些终端会出现光标与提示错位的问题
4. **通用占位符检测优于特定格式校验**：用「最短合理长度 + 全相同字符 + 关键词」三条规则可覆盖 99% 的占位符场景，且对所有 provider 通用，无需维护各厂商 key 格式的白名单
