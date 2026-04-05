/** 会话中所有可渲染的事件类型 */
export type ChatEvent =
  | { id: string; type: 'header';          model: string }
  | { id: string; type: 'user';        content: string }
  | { id: string; type: 'assistant';   content: string }
  | { id: string; type: 'tool-call';   name: string; args: object }
  | { id: string; type: 'tool-result'; name: string; result: string }
  | { id: string; type: 'system';      content: string }
  | { id: string; type: 'error';       content: string }
  | { id: string; type: 'token-usage'; used: number; max: number }
  | { id: string; type: 'voice-transcribed'; text: string }
  | { id: string; type: 'divider' }

/** 模式类型 */
export type AppMode = 'text' | 'plan' | 'voice'

/** 钢琴 UI 状态 */
export interface PianoState {
  visible: boolean;
  activeNote: string | null;
  songTitle: string;
  progress: number;
}
