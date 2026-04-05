/**
 * 钢琴音频引擎
 * 
 * 使用 speaker + PCM 正弦波生成实现音符播放。
 * 支持 C4-C6 两个八度的音符，带 ADSR 包络让音色更自然。
 */

import Speaker from 'speaker';

/**
 * 音符频率映射表（C4-C6，两个八度）
 */
export const NOTE_FREQS: Record<string, number> = {
  'C4': 261.63,  'C#4': 277.18, 'D4': 293.66,  'D#4': 311.13,
  'E4': 329.63,  'F4': 349.23,  'F#4': 369.99, 'G4': 392.00,
  'G#4': 415.30, 'A4': 440.00,  'A#4': 466.16, 'B4': 493.88,
  'C5': 523.25,  'C#5': 554.37, 'D5': 587.33,  'D#5': 622.25,
  'E5': 659.25,  'F5': 698.46,  'F#5': 739.99, 'G5': 783.99,
  'G#5': 830.61, 'A5': 880.00,  'A#5': 932.33, 'B5': 987.77,
  'C6': 1046.50,
};

/**
 * 中断标志（外部可通过设置此标志中断播放）
 */
let _interrupted = false;

export function interruptPiano() {
  _interrupted = true;
}

export function resetInterrupt() {
  _interrupted = false;
}

/**
 * 生成带 ADSR 包络的正弦波 PCM 数据
 * 
 * @param frequency 频率 (Hz)
 * @param durationMs 时长 (毫秒)
 * @returns 16-bit PCM Buffer
 */
function generateSineWaveWithADSR(frequency: number, durationMs: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const buffer = Buffer.alloc(numSamples * 2); // 16-bit = 2 bytes per sample
  
  // ADSR 参数
  const attackMs = 20;
  const decayMs = 30;
  const sustainLevel = 0.7;
  const releaseMs = 50;
  
  const attackSamples = Math.floor(sampleRate * attackMs / 1000);
  const decaySamples = Math.floor(sampleRate * decayMs / 1000);
  const releaseSamples = Math.floor(sampleRate * releaseMs / 1000);
  const sustainSamples = numSamples - attackSamples - decaySamples - releaseSamples;
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let envelope = 1.0;
    
    // Attack 阶段
    if (i < attackSamples) {
      envelope = i / attackSamples;
    }
    // Decay 阶段
    else if (i < attackSamples + decaySamples) {
      const decayProgress = (i - attackSamples) / decaySamples;
      envelope = 1.0 - (1.0 - sustainLevel) * decayProgress;
    }
    // Sustain 阶段
    else if (i < attackSamples + decaySamples + sustainSamples) {
      envelope = sustainLevel;
    }
    // Release 阶段
    else {
      const releaseProgress = (i - attackSamples - decaySamples - sustainSamples) / releaseSamples;
      envelope = sustainLevel * (1.0 - releaseProgress);
    }
    
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope;
    const int16 = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
    buffer.writeInt16LE(int16, i * 2);
  }
  
  return buffer;
}

/**
 * 播放指定音符
 * 
 * @param note 音符名称，如 'C4', 'E4', 'G4'
 * @param durationMs 时长 (毫秒)
 * @returns Promise，播放完成时 resolve
 */
export async function playNote(note: string, durationMs: number): Promise<void> {
  const freq = NOTE_FREQS[note];
  if (!freq) {
    console.error(`未知音符: ${note}`);
    return;
  }
  
  const pcm = generateSineWaveWithADSR(freq, durationMs);
  
  return new Promise<void>((resolve) => {
    const speaker = new Speaker({
      sampleRate: 44100,
      channels: 1,
      bitDepth: 16,
    });
    
    speaker.on('finish', () => resolve());
    speaker.on('error', () => resolve()); // 错误时也 resolve，避免阻塞
    
    // 写入 PCM 数据
    speaker.write(pcm);
    speaker.end();
  });
}

/**
 * 休止符（静音等待）
 */
export function rest(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}
