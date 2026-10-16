/**
 * 语音层的抽象接口。
 *
 * 这一层的存在，就是为了让「用户自己的模型支不支持语音」这件事不影响功能可用性。
 * 识别和合成各自是可替换的适配器，谁有就用谁，都没有就退回浏览器内置。
 */

export type VoiceTier = 'native' | 'cascade' | 'browser' | 'text';

export type EngineKind = 'cloud' | 'browser' | 'none';

export interface SttHandlers {
  /** 边说边出字，用于实时字幕 */
  onPartial?: (text: string) => void;
  /** 一句说完了 */
  onFinal: (text: string) => void;
  onError?: (error: Error) => void;
  /** 识别被动结束（比如浏览器自己停了） */
  onEnd?: () => void;
}

export interface SttAdapter {
  readonly id: string;
  readonly label: string;
  available(): Promise<boolean>;
  start(handlers: SttHandlers): Promise<void>;
  /** 正常收尾，把没说完的话提交出来 */
  stop(): Promise<void>;
  /** 立即丢弃，不要提交任何内容 */
  abort(): void;
}

export interface SpeakOptions {
  lang: string;
  rate?: number;
  voice?: string;
  /** 每合成出一段就回调一次，用于同步字幕 */
  onChunk?: (text: string) => void;
}

export interface TtsAdapter {
  readonly id: string;
  readonly label: string;
  available(): Promise<boolean>;
  speak(text: string, options: SpeakOptions): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
}

/** 当前环境能提供哪些语音能力 */
export interface VoiceCapabilities {
  nativeRealtime: boolean;
  cloudStt: boolean;
  cloudTts: boolean;
  browserStt: boolean;
  browserTts: boolean;
}

export interface EnginePreference {
  stt: 'auto' | 'cloud' | 'browser';
  tts: 'auto' | 'cloud' | 'browser';
}

export interface TierDecision {
  tier: VoiceTier;
  stt: EngineKind;
  tts: EngineKind;
  /** 机器可读的原因码，界面自己翻译成人话 */
  reason:
    | 'voice-disabled'
    | 'native-realtime'
    | 'cascade-cloud'
    | 'mixed'
    | 'browser-only'
    | 'no-stt'
    | 'no-tts';
}

export function browserSttSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function browserTtsSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.speechSynthesis !== 'undefined' && 'SpeechSynthesisUtterance' in window;
}
