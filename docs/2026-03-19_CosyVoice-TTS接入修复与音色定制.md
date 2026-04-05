# 2026-03-19 开发日志

## 今日实现

### 1. 百炼 CosyVoice TTS 接入 & isBinary 修复

**背景/问题：** 接入百炼 CosyVoice WebSocket TTS 后测试显示 OK，但实际播放没有声音。

**根本原因：** ws 库 v8 中 `message` 回调的所有参数均为 `Buffer`，包括文本 JSON 帧，`Buffer.isBuffer()` 对两者都返回 `true`，导致 JSON 控制事件（`task-started` 等）被误当成音频数据收集，`continue-task` 从未发出，服务端收不到文本，自然不返回音频。

**涉及文件：**
- `src/voice/tts.ts` — 修复消息类型判断，改用 `isBinary` 参数区分音频帧与 JSON 帧

**实现要点：**
```typescript
// 修复前：Buffer.isBuffer() 无法区分文本帧和音频帧
// 修复后：使用 isBinary 参数
ws.on('message', (data: Buffer, isBinary: boolean) => {
  if (isBinary) {
    chunks.push(data);   // 真正的音频二进制帧
    return;
  }
  // isBinary=false → JSON 控制事件
  const msg = JSON.parse(data.toString());
  // ...处理 task-started / task-finished 等事件
});
```

---

### 2. cosyvoice-v3.5-plus 定制音色（温柔女声）

**背景/问题：** 内置系统音色不满足需求，希望创建一个 28 岁左右、性格温柔的女性音色，用于 CLI 语音交互回复。

**技术路径：** 通过百炼声音设计 API（HTTP POST）用自然语言描述生成音色，获取 `voice_id` 后存入 `.env`，TTS 合成时动态读取。

**涉及文件：**
- `src/voice/tts.ts` — 新增 `getTtsConfig()` 函数，运行时从 `.env` 的 `TTS_MODEL`/`TTS_VOICE_ID` 读取音色配置
- `src/voice/voice-design.ts` — 新建，交互式音色设计命令行工具
- `package.json` — 新增 `voice-design` 脚本
- `.env` — 写入 `TTS_MODEL=cosyvoice-v3.5-plus`、`TTS_VOICE_ID=cosyvoice-v3.5-plus-vd-quangan-48d55179913d49ca82e4b7698297c3ef`

**声音设计 API 关键信息：**
- 端点：`POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization`
- 请求体必须含：`model: "voice-enrollment"`、`task_group: "audio"`、`task: "tts"`、`function: "customization"`
- 输入字段：`action: "create_voice"`、`target_model`、`prefix`、`voice_prompt`（自然语言描述）、`preview_text`
- 响应：`output.voice_id`、`output.preview_audio.data`（base64 WAV）

**使用方式：** `npm run voice-design` → 输入描述 → 试听 → 满意后自动写入 `.env`，下次启动 TTS 立即生效，无需改代码。

---

### 3. Agent 角色改造（小玉）

**背景/问题：** 原角色名"全干哥"定位模糊、风格生硬，不符合私人助理的使用场景；自我介绍时罗列工具能力过于机械。

**涉及文件：**
- `src/cli/index.ts` — 系统提示词重写，明确小玉作为权哥私人助理的身份、性格与自我介绍方式
- `src/cli/display.ts` — 标题栏从 `全干哥` 改为 `小玉 · 权哥的私人助理`，回复前缀从 `Agent` 改为 `小玉`

**改造要点：**
- 身份定位：温柔聪明的女性私人助理，说话自然随和
- 自我介绍：不列举工具，自然表达"帮权哥处理各种大小事"
- 视觉风格：标题和回复前缀统一换成粉紫色（`chalk.magenta`）

---

## 关键收获

- ws v8 中区分文本帧和音频二进制帧**唯一可靠方式**是 `isBinary` 回调参数，`Buffer.isBuffer()` 对两者均返回 `true`
- 百炼声音设计 API 端点与 TTS 推理端点**完全不同**，需看 Python SDK 源码才能找到正确路径
- 系统提示词的"角色感"比工具清单更影响交互体验，自然的自我介绍比能力列表更有代入感
