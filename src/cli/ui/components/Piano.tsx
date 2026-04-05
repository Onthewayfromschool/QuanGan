import React from 'react';
import { Box, Text } from 'ink';

interface PianoProps {
  activeNote: string | null;
  songTitle: string;
  progress: number;
}

/**
 * 钢琴键盘 Ink 组件
 * 渲染 C4-C5 两个八度的钢琴键盘，支持高亮当前弹奏的琴键
 */
export function Piano({ activeNote, songTitle, progress }: PianoProps) {
  const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const octaves = [4, 5];

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* 标题和进度 */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          🎹 正在演奏: {songTitle}
        </Text>
        <Text dimColor>{progress}%</Text>
      </Box>

      {/* 白键行 */}
      <Box>
        {octaves.map(octave =>
          whiteNotes.map(note => {
            const fullName = `${note}${octave}`;
            const isActive = activeNote === fullName;
            return (
              <Box
                key={fullName}
                width={5}
                height={3}
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
                borderStyle="single"
                borderColor={isActive ? 'yellow' : 'gray'}
                backgroundColor={isActive ? 'yellow' : undefined}
              >
                <Text color={isActive ? 'black' : 'white'} bold={isActive}>
                  {note}{octave}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* 提示 */}
      <Box marginTop={1}>
        <Text dimColor>ESC 停止演奏</Text>
      </Box>
    </Box>
  );
}
