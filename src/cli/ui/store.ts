import { ChatEvent, PianoState } from './types.js';
import { AppMode } from './types.js';

let _counter = 0;
export function nextId(): string {
  return String(++_counter);
}

// 将 Omit 分布式地应用到 union 的每个成员上，确保 discriminated union 的类型收窄正常
type DistributedOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;
export type ChatEventInput = DistributedOmit<ChatEvent, 'id'>;

type Listener = (events: ChatEvent[]) => void;

/**
 * ChatStore：命令式推送事件 → React 响应式重渲染的桥接层
 * index.ts 中调用 store.push() 代替原来的 printX() 函数
 */
export class ChatStore {
  private _events: ChatEvent[] = [];
  private _mode: AppMode = 'text';
  private _listeners = new Set<Listener>();
  private _modeListeners = new Set<(mode: AppMode) => void>();
  private _pianoState: PianoState = { visible: false, activeNote: null, songTitle: '', progress: 0 };
  private _pianoListeners = new Set<(state: PianoState) => void>();

  push(event: ChatEventInput): void {
    const full = { ...event, id: nextId() } as ChatEvent;
    this._events = [...this._events, full];
    this._listeners.forEach(l => l(this._events));
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  getAll(): ChatEvent[] {
    return this._events;
  }

  clear(): void {
    this._events = [];
    this._listeners.forEach(l => l(this._events));
  }

  // ── mode 管理 ─────────────────────────────────────────────────────
  setMode(mode: AppMode): void {
    this._mode = mode;
    this._modeListeners.forEach(l => l(mode));
  }

  getMode(): AppMode {
    return this._mode;
  }

  subscribeMode(fn: (mode: AppMode) => void): () => void {
    this._modeListeners.add(fn);
    return () => this._modeListeners.delete(fn);
  }

  // ── piano 管理 ─────────────────────────────────────────────────────
  pushPiano(state: Partial<PianoState>): void {
    this._pianoState = { ...this._pianoState, ...state };
    this._pianoListeners.forEach(l => l(this._pianoState));
  }

  getPianoState(): PianoState {
    return this._pianoState;
  }

  subscribePiano(fn: (state: PianoState) => void): () => void {
    this._pianoListeners.add(fn);
    return () => this._pianoListeners.delete(fn);
  }
}
