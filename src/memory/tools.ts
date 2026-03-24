import { ToolDefinition } from '../tools/types';
import { DashScopeClient } from '../llm/client';
import {
  getCoreMemory,
  saveCoreMemory,
  appendLifeMemory,
  getRecentLifeMemories,
  CoreMemoryItem,
} from './memory-store';

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

export const recallMemoryDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'recall_memory',
    description:
      '检索小玉的记忆，包括核心长期记忆和最近的日常记忆摘要。' +
      '当问题涉及具体项目、人物、过去的决定或用户偏好时主动调用；闲聊或简单问答无需调用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要检索的关键词或问题描述',
        },
      },
      required: ['query'],
    },
  },
};

export const updateLifeMemoryDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_life_memory',
    description: '将当前会话的核心内容保存到今日日常记忆文件中。',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: '本次会话的核心摘要（150字以内）',
        },
        theme: {
          type: 'string',
          description: '本次会话的主题词（3-8字，如"Agent开发"、"音乐播放调试"）',
        },
      },
      required: ['summary', 'theme'],
    },
  },
};

export const consolidateCoreMemoryDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'consolidate_core_memory',
    description:
      '分析最近 14 天的日常记忆，识别重复出现的主题，自动更新核心长期记忆。' +
      '当感知到某个主题反复出现时可主动调用。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

// ─── 工具实现 ─────────────────────────────────────────────────────────────────

export function createMemoryToolImpls(client: DashScopeClient, cwd: string) {
  /** recall_memory：关键词匹配 coreMemory + 展示最近 lifeMemory 列表 */
  const recallImpl = async (args: { query: string }): Promise<string> => {
    const queryWords = args.query.toLowerCase().split(/\s+/);
    const core = getCoreMemory(cwd);

    // 关键词匹配核心记忆
    const relevant = core.memories.filter(m =>
      queryWords.some(kw => m.content.toLowerCase().includes(kw)),
    );

    const recentLife = getRecentLifeMemories(cwd, 7);
    let result = '';

    if (core.memories.length === 0) {
      result += '## 核心记忆\n暂无核心记忆。\n\n';
    } else if (relevant.length > 0) {
      result += `## 核心记忆（共 ${core.memories.length} 条，匹配 ${relevant.length} 条）\n`;
      result += relevant.map(m => `- [强度:${m.reinforceCount}] ${m.content}`).join('\n');
      result += '\n\n';
    } else {
      result += `## 核心记忆（无精确匹配，显示全部 ${core.memories.length} 条）\n`;
      result += core.memories.map(m => `- ${m.content}`).join('\n');
      result += '\n\n';
    }

    if (recentLife.length > 0) {
      result += `## 最近 7 天日常记忆（${recentLife.length} 个文件）\n`;
      result += recentLife
        .map(f => `### ${f.filename}\n${f.content.slice(0, 400)}`)
        .join('\n\n---\n\n');
    } else {
      result += '## 日常记忆\n暂无日常记忆记录。';
    }

    return result;
  };

  /** update_life_memory：写入今日 lifeMemory 文件 */
  const updateLifeImpl = async (args: { summary: string; theme: string }): Promise<string> => {
    const filename = appendLifeMemory(cwd, args.theme, args.summary);
    return `✅ 今日记忆已保存：${filename}`;
  };

  /** consolidate_core_memory：LLM 归纳近期 lifeMemory → 更新 coreMemory */
  const consolidateImpl = async (): Promise<string> => {
    const recentLife = getRecentLifeMemories(cwd, 14);
    if (recentLife.length === 0) {
      return '暂无日常记忆可供归纳。';
    }

    const currentCore = getCoreMemory(cwd);
    const lifeContent = recentLife
      .map(f => `=== ${f.filename} ===\n${f.content}`)
      .join('\n\n');
    const existingCore =
      currentCore.memories.length > 0
        ? currentCore.memories.map(m => `- [id:${m.id}] ${m.content}`).join('\n')
        : '（暂无）';

    const prompt =
      `## 最近 14 天的日常记忆：\n${lifeContent}\n\n` +
      `## 现有核心记忆：\n${existingCore}\n\n` +
      `## 任务：\n` +
      `分析日常记忆中重复出现的主题、事实、偏好，与现有核心记忆对比，输出更新后的核心记忆列表。\n` +
      `规则：\n` +
      `1. 现有核心记忆中有对应内容的，如有补充则更新描述，reinforceCount +1\n` +
      `2. 重复出现 2 次以上的新主题，添加为新核心记忆，reinforceCount 设为出现次数\n` +
      `3. 每条记忆用一句话概括，保持 id 不变（新增则生成简短英文 id）\n` +
      `4. 只输出 JSON，不要包裹 markdown 代码块，格式：\n` +
      `{"memories":[{"id":"xxx","content":"...","firstSeen":"YYYY-MM-DD","reinforceCount":N}]}`;

    try {
      const result = await client.ask(prompt, '你是记忆整合助手，只输出纯 JSON，不加任何说明。');
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return '❌ 无法解析 LLM 返回的记忆 JSON';

      const parsed = JSON.parse(jsonMatch[0]) as { memories: CoreMemoryItem[] };
      saveCoreMemory(cwd, {
        updatedAt: new Date().toISOString().slice(0, 10),
        memories: parsed.memories,
      });

      return `✅ 核心记忆已更新，共 ${parsed.memories.length} 条`;
    } catch (e) {
      return `❌ 记忆整合失败: ${e}`;
    }
  };

  return { recallImpl, updateLifeImpl, consolidateImpl };
}
