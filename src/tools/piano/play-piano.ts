/**
 * 钢琴演奏工具
 * 
 * 组合 LLM 编曲 + 音频播放 + UI 渲染。
 * 用户说"帮我弹一首XXX"时调用。
 */

import { ToolDefinition, ToolFunction } from '../../tools/types.js';
import { composeSong } from './composer.js';
import { playNote, rest, resetInterrupt } from './audio-engine.js';

/**
 * 钢琴演奏工具定义
 */
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'play_piano',
    description:
      '在终端中演奏钢琴动画。根据歌曲名实时编曲，渲染钢琴键盘 UI，按旋律高亮琴键并播放音调。当用户要求弹钢琴、演奏歌曲时使用。',
    parameters: {
      type: 'object',
      properties: {
        song_name: {
          type: 'string',
          description:
            '要演奏的歌曲名，如 "小星星"、"欢乐颂"、"生日快乐"、"月亮代表我的心"',
        },
      },
      required: ['song_name'],
    },
  },
};

/**
 * 钢琴演奏工具实现
 * 
 * 注意：此工具需要通过全局 store 推送钢琴事件，store 会在 cli/index.ts 中注入。
 */
let _globalStore: any = null;
let _globalClient: any = null;
let _webSearch: ((query: string) => Promise<string>) | null = null;

/**
 * 初始化钢琴工具的依赖（在 cli/index.ts 启动时调用）
 */
export function initPianoTool(store: any, client: any, webSearch: any) {
  _globalStore = store;
  _globalClient = client;
  _webSearch = webSearch;
}

export const implementation: ToolFunction = async (args: { song_name: string }) => {
  if (!_globalStore || !_globalClient) {
    return '错误：钢琴工具未初始化';
  }

  resetInterrupt();

  try {
    // 1. 推送钢琴 UI 显示事件
    _globalStore.pushPiano({
      visible: true,
      activeNote: null,
      songTitle: args.song_name,
      progress: 0,
    });

    // 2. 编曲（优先搜索网络曲谱，找不到再 LLM 编曲）
    _globalStore.push({
      type: 'system',
      content: `🎹 正在为「${args.song_name}」编曲（搜索曲谱...）`,
    });

    const webSearchFn = _webSearch || (async () => { throw new Error('web_search 不可用'); });
    const song = await composeSong(_globalClient, webSearchFn, args.song_name);

    _globalStore.push({
      type: 'system',
      content: `🎼 编曲完成：${song.title}（共 ${song.notes.length} 个音符，约 ${Math.round(song.notes.reduce((sum, n) => sum + n.duration, 0) / 1000)} 秒）`,
    });

    // 3. 逐个播放音符
    for (let i = 0; i < song.notes.length; i++) {
      const noteEvent = song.notes[i];
      const progress = Math.round(((i + 1) / song.notes.length) * 100);

      // 更新 UI 高亮
      _globalStore.pushPiano({
        visible: true,
        activeNote: noteEvent.isRest ? null : noteEvent.note,
        songTitle: song.title,
        progress,
      });

      // 播放音符或休止
      if (noteEvent.isRest) {
        await rest(noteEvent.duration);
      } else {
        await playNote(noteEvent.note, noteEvent.duration);
      }

      // 音符间短暂停顿
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // 4. 演奏完毕
    _globalStore.pushPiano({
      visible: false,
      activeNote: null,
      songTitle: song.title,
      progress: 100,
    });

    return `🎹 演奏完成：${song.title}`;
  } catch (e: any) {
    // 错误时隐藏钢琴 UI
    _globalStore.pushPiano({
      visible: false,
      activeNote: null,
      songTitle: '',
      progress: 0,
    });

    return `钢琴演奏失败: ${e.message}`;
  }
};
