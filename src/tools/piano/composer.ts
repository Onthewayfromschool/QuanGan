/**
 * LLM 编曲工具
 * 
 * 通过 LLM 将歌曲名转换为音符序列 + 节拍信息。
 */

import { ILLMClient } from '../../llm/types.js';

export interface NoteEvent {
  note: string;       // 如 'C4', 'E4', 'G4'
  duration: number;   // 毫秒，如 400（四分音符）、200（八分音符）
  isRest?: boolean;   // 是否为休止符
}

export interface ComposedSong {
  title: string;
  notes: NoteEvent[];
}

/**
 * 通过 LLM 将歌曲名编曲为音符序列
 * 
 * 策略：先搜索网络曲谱（web_search），找到后解析；找不到再 LLM 编曲
 * 
 * @param client LLM 客户端
 * @param webSearch web_search 工具函数
 * @param songName 歌曲名
 * @returns 编曲结果（标题 + 音符序列）
 */
export async function composeSong(
  client: ILLMClient,
  webSearch: (query: string) => Promise<string>,
  songName: string
): Promise<ComposedSong> {
  // 策略 1：搜索网络现成曲谱
  try {
    const searchQuery = `${songName} 简谱 钢琴谱 C大调 数字谱`;
    console.log(`[piano] 搜索曲谱: ${searchQuery}`);
    const searchResult = await webSearch(searchQuery);

    // 用 LLM 解析搜索结果为音符序列
    const parsePrompt = `我搜索到了歌曲「${songName}」的简谱信息：
${searchResult}

请将上述简谱转换为钢琴音符序列 JSON。

要求：
1. **只返回 JSON**，不要其他内容
2. 使用 C 大调，音符名称：C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5 C6
3. 节拍：四分音符=400ms，八分音符=200ms，二分音符=800ms
4. **返回完整的主旋律**（包括主歌、副歌、间奏等所有段落）
5. 返回格式：
{"title": "歌曲名", "notes": [{"note": "C4", "duration": 400}, {"note": "G4", "duration": 400}]}

只返回 JSON 对象。`;

    const parseResult = await client.ask(
      parsePrompt,
      '你是音乐解析助手，将简谱转换为钢琴音符序列。只返回 JSON。'
    );

    const jsonMatch = parseResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.title && Array.isArray(parsed.notes) && parsed.notes.length > 0) {
        console.log(`[piano] 搜索到曲谱并解析成功: ${parsed.title} (${parsed.notes.length} 个音符)`);
        return parsed as ComposedSong;
      }
    }
  } catch (err: any) {
    console.warn(`[piano] 搜索曲谱失败: ${err.message}，降级到 LLM 编曲`);
  }
  // 策略 2：LLM 编曲（fallback）
  console.log(`[piano] 使用 LLM 编曲: ${songName}`);
  const prompt = `你是音乐编曲专家，请将歌曲「${songName}」的主旋律转换为钢琴音符序列。

**这是备用方案，请凭借你的音乐知识生成准确、完整的旋律。**

要求：
1. **只返回 JSON**，不要其他内容，不要用 markdown 代码块包裹
2. 使用 C 大调，音域限制在 C4-C6（两个八度）
3. 节拍：四分音符=400ms，八分音符=200ms，二分音符=800ms
4. **返回完整的主旋律**（包括主歌、副歌、间奏等所有段落，不要截断）
5. 返回格式：
{"title": "小星星", "notes": [{"note": "C4", "duration": 400}, {"note": "C4", "duration": 400}, {"note": "G4", "duration": 400}]}

只返回 JSON 对象。`;

  const response = await client.ask(
    prompt,
    '你是音乐编曲助手，擅长将歌曲转换为简谱音符序列。只返回 JSON，不要其他内容。'
  );
  
  // 解析 JSON 响应（容忍 markdown 代码块包裹）
  let jsonStr = response.trim();
  
  // 移除可能的 markdown 代码块标记
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  
  // 提取 JSON 对象
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`LLM 返回格式无效，无法解析 JSON: ${response.slice(0, 200)}`);
  }
  
  const result = JSON.parse(jsonMatch[0]) as ComposedSong;
  
  // 验证结果
  if (!result.title || !Array.isArray(result.notes)) {
    throw new Error('LLM 返回的 JSON 缺少 title 或 notes 字段');
  }
  
  // 校验并过滤无效音符
  const validNotes = new Set([
    'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4',
    'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5', 'A5', 'A#5', 'B5',
    'C6', 'REST'
  ]);
  
  result.notes = result.notes.filter(n => {
    if (!validNotes.has(n.note)) {
      console.warn(`过滤无效音符: ${n.note}`);
      return false;
    }
    return true;
  });
  
  if (result.notes.length === 0) {
    throw new Error('编曲结果为空，没有有效音符');
  }
  
  return result;
}
