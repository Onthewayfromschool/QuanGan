import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, Static } from 'ink';
import TextInput from 'ink-text-input';

import { ChatStore } from './store.js';
import { ChatEvent, AppMode, PianoState } from './types.js';
import { Header } from './components/Header.js';
import { ChatMessage } from './components/ChatMessage.js';
import { ToolCall } from './components/ToolCall.js';
import { ToolResult } from './components/ToolResult.js';
import { SystemMsg, ErrorMsg, Divider } from './components/SystemMsg.js';
import { Spinner } from './components/Spinner.js';
import { TokenBar } from './components/TokenBar.js';
import { CommandPicker } from './pickers/CommandPicker.js';
import { ProviderPicker, ProviderItem } from './pickers/ProviderPicker.js';
import { Piano } from './components/Piano.js';

// ── 单条事件渲染 ──────────────────────────────────────────────────────────────
function EventItem({ event }: { event: ChatEvent }) {
  switch (event.type) {
    case 'header':
      return <Header model={event.model} />;
    case 'user':
      return <ChatMessage role="user" content={event.content} />;
    case 'voice-transcribed':
      return <ChatMessage role="voice-transcribed" content={event.text} />;
    case 'assistant':
      return <ChatMessage role="assistant" content={event.content} />;
    case 'tool-call':
      return <ToolCall name={event.name} args={event.args} />;
    case 'tool-result':
      return <ToolResult result={event.result} />;
    case 'system':
      return <SystemMsg content={event.content} />;
    case 'error':
      return <ErrorMsg content={event.content} />;
    case 'token-usage':
      return <TokenBar used={event.used} max={event.max} />;
    case 'divider':
      return <Divider />;
    default:
      return null;
  }
}

// ── InputArea：输入框 + 模式标签 ──────────────────────────────────────────────
interface InputAreaProps {
  mode: AppMode;
  isRunning: boolean;
  isRecording: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onSlash: () => void;
}

function InputArea({ mode, isRunning, isRecording, onSubmit, onAbort, onSlash }: InputAreaProps) {
  const [value, setValue] = useState('');

  // ESC 中断 agent
  useInput((_, key) => {
    if (key.escape && isRunning) {
      onAbort();
    }
    // voice 模式下 Enter 触发录音（但不在这里处理，交给 TextInput 的 onSubmit，避免重复）
  });

  const handleChange = (val: string) => {
    setValue(val);
    // 输入 '/' 时立即触发命令选择器
    if (val === '/') {
      onSlash();
      setValue('');
    }
  };

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    setValue('');
    console.log(`[InputArea] handleSubmit called with: "${trimmed}" (mode=${mode})`);
    // voice 模式下空 Enter 也需要透传（触发录音）
    if (trimmed || mode === 'voice') onSubmit(trimmed);
  };

  if (isRunning) {
    return <Spinner />;
  }

  if (isRecording) {
    return (
      <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red">🔴 </Text>
        <Text bold color="red">录音中... </Text>
        <Text dimColor>（说话后静音 1.5s 自动停止）</Text>
      </Box>
    );
  }

  const borderColor = mode === 'plan' ? 'yellow' : mode === 'voice' ? 'magenta' : 'gray';
  const promptColor = mode === 'plan' ? 'yellow' : mode === 'voice' ? 'magenta' : 'green';
  const promptText  = mode === 'plan' ? '[PLAN] › ' : mode === 'voice' ? '[🎤] › ' : '› ';
  const hint        = mode === 'voice'
    ? '  Enter 开始录音   /  查看命令   ESC 中断'
    : '  输入消息   /  查看命令   ESC 中断';

  return (
    <Box marginTop={1} flexDirection="column">
      <Box borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={promptColor} bold>{promptText}</Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          focus={true}
        />
      </Box>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

// ── App 根组件 ────────────────────────────────────────────────────────────────

export interface AppCallbacks {
  onMessage:    (text: string) => Promise<void>;
  onCommand:    (cmd: string)  => void;
  onVoiceTrigger: () => Promise<void>;
  onAbort:      () => void;
  onSwitchProvider:    (name: string) => void;
  onConfigureApiKey:   (providerName: string, apiKey: string, model: string) => void;
  onChangeModel:       (model: string) => void;
  getProviderItems:    () => ProviderItem[];
}

interface AppProps {
  store: ChatStore;
  model: string;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  callbacks: AppCallbacks;
}

export function App({ store, model, mode: initialMode, setMode, callbacks }: AppProps) {
  const [events, setEvents]           = useState<ChatEvent[]>(() => store.getAll());
  const [mode, setModeState]          = useState<AppMode>(initialMode);
  const [isRunning, setIsRunning]     = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showCmd, setShowCmd]         = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [pianoState, setPianoState]   = useState<PianoState>(() => store.getPianoState());
  const isRunningRef = useRef(false);

  // 订阅 store 事件变化
  useEffect(() => {
    return store.subscribe(evts => setEvents([...evts]));
  }, [store]);

  // 订阅 store mode 变化
  useEffect(() => {
    return store.subscribeMode(m => setModeState(m));
  }, [store]);

  // 订阅 store piano 变化
  useEffect(() => {
    return store.subscribePiano(state => setPianoState(state));
  }, [store]);

  // 暴露 setIsRunning / setIsRecording 给外部
  useEffect(() => {
    (store as any).__setRunning   = (v: boolean) => { isRunningRef.current = v; setIsRunning(v); };
    (store as any).__setRecording = (v: boolean) => setIsRecording(v);
    (store as any).__setShowProvider = (v: boolean) => setShowProvider(v);
  }, [store]);

  const handleSubmit = useCallback(async (text: string) => {
    if (isRunningRef.current) return;
    if (text.startsWith('/')) {
      callbacks.onCommand(text);
      return;
    }
    isRunningRef.current = true;
    setIsRunning(true);
    try {
      await callbacks.onMessage(text);
    } finally {
      isRunningRef.current = false;
      setIsRunning(false);
    }
  }, [callbacks]);

  const handleVoiceSubmit = useCallback(async () => {
    if (isRunningRef.current || isRecording) return;
    setIsRecording(true);
    try {
      await callbacks.onVoiceTrigger();
    } finally {
      setIsRecording(false);
    }
  }, [callbacks, isRecording]);

  const handleSlash = useCallback(() => {
    if (!isRunningRef.current) setShowCmd(true);
  }, []);

  const handleCmdSelect = useCallback((cmd: string | null) => {
    setShowCmd(false);
    if (cmd) callbacks.onCommand(cmd);
  }, [callbacks]);

  // voice 模式下 Enter 触发录音（空提交）
  const handleTextSubmit = useCallback((text: string) => {
    if (mode === 'voice' && !text) {
      handleVoiceSubmit();
      return;
    }
    handleSubmit(text);
  }, [mode, handleSubmit, handleVoiceSubmit]);

  return (
    <Box flexDirection="column">
      {/* ── 静态历史区（渲染后不再重绘，随终端自然滚动）── */}
      <Static items={events}>
        {(evt) => (
          <Box key={evt.id} flexDirection="column">
            <EventItem event={evt} />
          </Box>
        )}
      </Static>

      {/* ── 动态底部区域 ─────────────────────────── */}

      {/* 命令选择器覆盖层 */}
      {showCmd && (
        <CommandPicker onSelect={handleCmdSelect} />
      )}

      {/* 供应商选择器覆盖层 */}
      {showProvider && (
        <ProviderPicker
          items={callbacks.getProviderItems()}
          currentModel={model}
          onSelect={(name) => {
            setShowProvider(false);
            callbacks.onSwitchProvider(name);
          }}
          onConfigureKey={(providerName, apiKey, model) => {
            setShowProvider(false);
            callbacks.onConfigureApiKey(providerName, apiKey, model);
          }}
          onChangeModel={(newModel) => {
            setShowProvider(false);
            callbacks.onChangeModel(newModel);
          }}
          onCancel={() => setShowProvider(false)}
        />
      )}

      {/* 主输入区（钢琴演奏时隐藏） */}
      {!showCmd && !showProvider && !pianoState.visible && (
        <InputArea
          mode={mode}
          isRunning={isRunning}
          isRecording={isRecording}
          onSubmit={handleTextSubmit}
          onAbort={callbacks.onAbort}
          onSlash={handleSlash}
        />
      )}

      {/* 钢琴 UI（演奏时显示，替代输入区） */}
      {pianoState.visible && (
        <Piano
          activeNote={pianoState.activeNote}
          songTitle={pianoState.songTitle}
          progress={pianoState.progress}
        />
      )}
    </Box>
  );
}

/** 对外暴露：通过 store 上附带的 __setRunning 控制 spinner */
export function setAppRunning(store: ChatStore, v: boolean) {
  (store as any).__setRunning?.(v);
}
export function setAppRecording(store: ChatStore, v: boolean) {
  (store as any).__setRecording?.(v);
}
export function setAppShowProvider(store: ChatStore, v: boolean) {
  (store as any).__setShowProvider?.(v);
}
