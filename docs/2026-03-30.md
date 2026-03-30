# 2026-03-30 开发日志

## 今日实现

### 1. Coding Agent 联网搜索能力（Tavily + Jina Reader）

**背景/问题：** Agent 目前只能回答训练数据内的问题，无法获取实时信息（最新文档、新闻、技术更新等）。当用户问"React 19 有什么新特性"或"查一下这个库的用法"时，Agent 只能凭记忆回答，容易出现信息过时或编造的情况。

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 浏览器自动化（已有 browser_action） | 零新增依赖 | 慢、不稳定、反爬风险，返回原始 HTML 噪音多 |
| Google/Bing 搜索 API | 结果权威 | 价格高，免费额度极少 |
| Serper API | Google 结果，速度快 | 免费额度有限，只返回摘要 |
| **Tavily API + Jina Reader（选用）** | Tavily 专为 AI Agent 设计，返回结构化摘要+AI生成答案；Jina 零 Key 读全文；两者免费额度够个人使用 | Tavily 需要注册 Key |

选型理由：Tavily 返回的 `answer` 字段是 AI 生成的摘要，可直接作为 Agent 上下文，不需要额外解析；Jina Reader 通过 `https://r.jina.ai/{url}` 将任意网页转成干净 Markdown，GET 请求无需 Key，两者组合覆盖"搜索→精读"完整链路。

**涉及文件：**
- `src/agents/coding/tools/web-search.ts` — 新建，Tavily API 封装；支持 `search_depth: basic/advanced`、`max_results` 参数；返回 AI 摘要 + 结构化结果列表
- `src/agents/coding/tools/read-url.ts` — 新建，Jina Reader 封装；URL 格式验证、30s 超时、内容超长自动截断（默认 8000 字符）
- `src/agents/coding/tools/index.ts` — 注册两个新工具到 `createAllCodingTools`，均为 `readonly: true`（Plan 模式可用）

**实现要点：**

```typescript
// web-search.ts：调用 Tavily API，include_answer: true 拿 AI 摘要
const response = await fetch('https://api.tavily.com/search', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ query, max_results, search_depth, include_answer: true }),
});

// read-url.ts：Jina Reader 零配置，拼接 URL 即可
const jinaUrl = `https://r.jina.ai/${targetUrl}`;
const response = await fetch(jinaUrl, {
  headers: { 'X-Return-Format': 'markdown' },
  signal: AbortSignal.timeout(30_000),
});
```

两个 Tool 均为 `readonly: true`，Plan 模式下也可调用（纯读取，无副作用）。

---

### 2. Agent 路由加固（防止信息搜索误触发 browser_action）

**背景/问题：** 联网搜索工具加入 Coding Agent 后，发现主 Agent 在处理"查一下XXX"、"搜一下"类需求时，仍然路由到 Daily Agent，Daily Agent 手里只有 `browser_action`，于是启动 Playwright 打开浏览器搜索——慢且不稳定。根因是主 Agent 的 `dailyAgentToolDef.description` 包含"网页搜索"字眼，导致信息检索被误判为日常任务。

**涉及文件：**
- `src/cli/index.ts` — 修改 `codingAgentToolDef.description`：明确说明负责联网搜索（web_search / read_url）；修改 `dailyAgentToolDef.description`：加⚠️说明信息检索类不要交给 daily；在主 Agent 系统 prompt 中加「路由原则」，明确"查资料/搜一下 → coding_agent"
- `src/agents/daily/index.ts` — 在 Daily Agent 系统 prompt 末尾加「禁止事项」：明确禁止 `browser_action` 用于信息搜索，只允许用于明确指定的网页自动化操作

**实现要点：** 三道防线叠加——工具描述层约束（主 Agent 路由决策依据）+ 系统 prompt 路由规则（强约束）+ Daily Agent 内部 prompt 禁令（兜底）。任何一层生效都能阻止误路由。

```
主 Agent 路由原则（新增）：
- 「查资料」「搜一下」「查询XXX」「找信息」「搜索XXX」→ 一律交给 coding_agent
- 「打开XXX」「播放音乐」「执行命令」「关闭XXX」→ 交给 daily_agent
```

---

## 关键收获

1. **AI Agent 信息检索的最优链路**：Tavily（搜索 + AI 摘要） + Jina Reader（全文精读）= 免费、零配置、结构化输出，是个人 Agent 项目联网搜索的最佳起点，无需自己爬取和解析 HTML。

2. **Agent 路由质量取决于工具 description 的精确程度**：主 Agent 的路由决策完全依赖 `ToolDefinition.function.description`；description 里出现"搜索"二字，就可能把信息查询路由到错误的子 Agent。工具 description 应精确描述"做什么"，同时明确写出"不做什么"（exclusion），三道防线（工具描述 + 系统 prompt + 子 Agent 内部 prompt）叠加才稳。

3. **`readonly: true` 的工具可在 Plan 模式调用**：凡是无副作用的工具（读文件、搜索、联网查询）都应标记为 `readonly: true`，让 Plan 模式下 Agent 也能"先看资料再规划"，而不是盲目规划。

4. **Jina Reader 30s 超时 + 截断是必须的**：部分网页内容极长（几十万字符），不截断会撑爆上下文窗口；部分网页响应极慢，没有超时会挂死 Agent。`AbortSignal.timeout(30_000)` 是最简洁的超时写法，无需手动 `clearTimeout`。
