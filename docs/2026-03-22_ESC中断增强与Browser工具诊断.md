# 2026-03-22 开发日志

## 今日实现

### 1. ESC 中断 Agent 功能修复与增强

**背景/问题：** ESC 中断只设 `_aborted` 标志位，需等当前 fetch 返回才能检测，LLM 接口响应慢时几乎无感；同时按下 ESC 没有任何即时视觉反馈。

**涉及文件：**
- `src/agent/agent.ts` — 新增 `_abortController: AbortController`；`abort()` 同时调用 `controller.abort()`；fetch 加 `signal` 参数；catch 块捕获 `AbortError` 统一抛出 `'⚡ 已中断'`
- `src/cli/index.ts` — 新增模块级 `currentSpinner` 变量；ESC 时立即 stop spinner 并打印 `⚡ 中断中...`；spinner 文字加 `(Esc 可中断)` 暗色提示

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 标志位轮询（旧方案） | 实现简单 | 等 LLM 响应才生效，延迟高达数秒 |
| **AbortController（选用）** | 立即取消 in-flight fetch，毫秒级响应 | 需额外处理 AbortError catch |

选型理由：用户体验要求中断即刻生效，AbortController 是取消 fetch 的标准原生方案。

**实现要点：** 每轮迭代前新建 `AbortController`，`abort()` 同时置 `_aborted = true` 和 `controller.abort()`。`currentSpinner` 必须提升为模块级变量，keypress 回调才能访问并立即停止动画。

---

### 2. Browser 工具 CDP 连接错误诊断

**背景/问题：** CDP 连接失败时静默 fallback 到新 Chromium，用户和 Agent 均不知原因；Chrome 94+ 新增了连接来源限制导致 HTTP 400。

**涉及文件：**
- `src/agents/daily/tools/browser.ts` — catch 块捕获 CDP 错误存入 `lastCdpError`；navigate 在 fallback 模式时返回含原因 + 正确启动命令的提示信息

**实现要点：** Chrome 94+ 必须启动时加 `--remote-allow-origins=*`，否则返回 HTTP 400，Playwright 抛出 `Unexpected status 400`。用户用旧命令启动后遇到此错误，通过错误提示引导到正确命令。

---

### 3. Browser 工具持久化登录态改造

**背景/问题：** Fallback 到新 Chromium 每次都需重新登录；要求用户关闭已有 Chrome 来启用 CDP 成本过高（会丢失所有已打开的标签页）。

**涉及文件：**
- `src/agents/daily/tools/browser.ts` — 移除 `localBrowser / localContext`；改用 `chromium.launchPersistentContext(PROFILE_DIR)` 专属持久化 profile；Mode 三态从 `'cdp'|'local'|'unknown'` 改为 `'cdp'|'persistent'|'unknown'`；close action 持久化模式下只关页面，不关 context（保留登录态）；CDP 超时改为 3000ms 快速失败

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 新 Chromium 实例（旧方案） | 实现简单 | 每次无登录态，体验差 |
| CDP 复用用户 Chrome | 直接用现有登录态 | 要求用户完全退出 Chrome，成本极高 |
| **launchPersistentContext（选用）** | 不影响用户 Chrome，一次登录永久复用 | 首次需在专属窗口手动登录 |

选型理由：不干扰用户工作流，同时彻底解决登录态问题，首次登录后对用户完全透明。

**实现要点：** Profile 存储在 `~/.xiaoyu-browser-profile`，`launchPersistentContext` 直接返回 `BrowserContext`，无需管理 `Browser` 对象。`getPage()` 在 `persistent` 分支也加了 try-catch，context 失效时重置 mode 重新建立。

---

### 4. daily-record Skill 全局安装

**背景/问题：** `daily-record` skill 仅存在于项目本地 `skills/` 目录，其他项目无法使用。

**涉及文件：**
- `~/.qoder/skills/daily-record/SKILL.md` — 复制项目 skill 到全局目录

**实现要点：** `cp -r skills/daily-record ~/.qoder/skills/daily-record`，安装后在所有项目中触发 `/daily-record` 即可同时完成开发日志和发言归档。

---

## 关键收获

1. **fetch 取消标准方案**：`fetch(url, { signal: controller.signal })` + `controller.abort()`，catch `err.name === 'AbortError'` 是中断 in-flight 请求的原生方案，优于轮询标志位
2. **跨回调状态共享用模块级变量**：spinner 等需要在 keypress 回调里访问的状态，必须提升为模块级，函数内局部变量对外不可见
3. **Playwright 持久化登录态**：`chromium.launchPersistentContext(dir, options)` 直接返回 BrowserContext，Profile 目录存储 Cookie/localStorage，首次登录后永久复用，比每次 CDP 连接更稳定
4. **Chrome 94+ CDP 限制**：启动命令必须加 `--remote-allow-origins=*`，否则返回 HTTP 400，Playwright 无法建立 WebSocket 连接
