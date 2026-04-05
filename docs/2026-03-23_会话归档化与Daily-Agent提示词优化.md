# 2026-03-23 开发日志

## 今日实现

### 1. `/clear` 命令升级：归档替代删除

**背景/问题：** 原来的 `/clear` 直接调用 `fs.unlinkSync` 删除会话文件，旧的对话记录就永久丢失了。用户需要的语义是「开启新对话」，而不是「销毁历史」。

**涉及文件：**
- `src/cli/session-store.ts` — `clearSession` 改为 `renameSync`，将旧文件重命名为带时间戳的归档文件，返回归档文件名供 UI 展示
- `src/cli/index.ts` — `/clear` 分支接收返回值，展示"已归档：xxx"提示；用 `case '/clear': { }` 块包裹避免 `const` 变量泄漏
- `src/cli/display.ts` — `/help` 中 `/clear` 的描述更新为"归档当前对话，开启新对话（旧记录保留）"
- `src/cli/command-picker.ts` — 命令选择菜单中同步更新描述

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 直接删除（旧方案） | 简单 | 数据不可恢复 |
| 写入 archived 字段 | 单文件 | 文件结构复杂，加载需过滤 |
| **rename + 时间戳（选用）** | 零侵入，文件即归档，随时可查 | .sessions/ 随时间积累多个文件 |

选型理由：文件系统层面隔离最干净，旧会话保持完整，无需改 loadSession / saveSession 逻辑。

**实现要点：**
- 归档文件名格式：`<项目名>-<hash>-archive-YYYY-MM-DDTHH-MM-SS.json`
- `new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)` 生成合法文件名（冒号不能用于文件名）
- `clearSession` 返回 `string | null`，null 表示原本就没有会话文件（首次使用）

---

### 2. Daily Agent 提示词策略化重构

**背景/问题：** Daily Agent 系统提示词里堆了大量实现细节：QQ 音乐 URL Scheme 的中文 encode 示例、y.qq.com 的 CSS 选择器路径、完整的 AppleScript 控制脚本……这违反了「提示词只定策略，工具自带知识」的原则，而且随需求增加会越来越臃肿。

**涉及文件：**
- `src/agents/daily/index.ts` — 系统提示词从 102 行压缩到 30 行；移除所有 QQ 音乐具体操作流程，保留"ncm-cli 优先 → 其他方式兜底"策略声明

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 把策略都塞进提示词 | Agent 执行时不需要探索 | 维护成本高；每种音乐平台各一套流程；提示词越来越长 |
| **提示词只写策略 + 工具自带知识（选用）** | 提示词简洁；工具可独立维护 | 首次使用需探索 |
| 提示词 + Skill 文件 | 知识有组织 | Skill 目前不自动注入 QuanGan agent |

选型理由：Daily Agent 的工具（run_shell / browser_action / run_applescript）各有自己的 description，音乐平台操作方式属于工具使用知识，不属于 Agent 的系统策略。

**实现要点：**
- 提示词只保留：核心原则、工具列表、音乐需求优先策略（ncm-cli first）、其他能力
- 移除内容：URL Scheme 编码示例、y.qq.com 选择器、AppleScript 脚本体、QQ 音乐工作流示例

---

### 3. ncm-cli 播放提示词精准化（减少试错轮次）

**背景/问题：** 测试播放《奇迹再现》时，Agent 走了 4 次错误尝试：`search '歌名' --type song` → `search song '歌名'` → `search all '歌名'` → 调 `--help` 才找到正确格式。根本原因：`ncm-cli commands` 输出会被截断，search 子命令格式看不全；而且提示词没有说明"不要用位置参数"。

**涉及文件：**
- `src/agents/daily/index.ts` — 在提示词中直接内嵌最常用命令格式；明确标注"必须用 --keyword，不能用位置参数"；加入搜索→播放标准 2 步流程；标注 visible=false 的歌曲跳过

**技术选型：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| 让 Agent 自己跑 `--help` 探路 | 通用性强 | 每次播放多 2-3 次工具调用 |
| **把关键命令格式写入提示词（选用）** | 第一次就用对，零试错 | 命令格式变更需同步更新提示词 |
| 改造 ncm-cli 工具 | 封装最完善 | 改动范围大 |

选型理由：ncm-cli 命令格式相对稳定，把「必须用 --keyword」这条关键约束写进提示词，消除最高频的试错路径，收益显著。

**实现要点：**
- 内嵌 bash 代码块需在 TypeScript 模板字符串里转义反引号（`\`\`\`bash`）
- 搜索 → 播放标准流程：search song → 取 id/originalId → play --song
- `visible=true` 筛选逻辑防止播放版权受限歌曲

---

## 关键收获

1. **提示词分层原则**：系统提示词管策略（优先级、使用哪个工具），工具 description 管用法（参数格式、示例），不要混用——越界就会越来越乱
2. **把关键约束显式化**：「不能用位置参数」这种"反直觉约束"如果不写进提示词，LLM 会凭直觉猜，必然出错；把最高频的坑直接写出来是最低成本的修法
3. **数据不删只归档**：用文件系统 rename 代替 unlink，零侵入、数据可恢复、代码量基本不增加
4. **case 块里的 const 要加 `{}` 块作用域**：switch-case 里用 `const` 声明，若不加 `{}` 会因变量提升导致编译错误
