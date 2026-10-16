/**
 * 浏览器内置语音适配器（降级阶梯的第 ③ 档）。
 *
 * 用 Web Speech API：SpeechRecognition 做识别，speechSynthesis 做合成。
 * 零配置、零成本，代价是依赖浏览器 —— Chrome / Edge 支持，Firefox 基本不支持。
 *
 * 两个必须处理的坑：
 *   1. Chrome 的 continuous 模式经常自己停，得在 onend 里重启
 *   2. 它不给你 VAD，得自己用「多久没有新结果」来判句
 */

import type { SpeakOptions, SttAdapter, SttHandlers, TtsAdapter } from './types';
import { browserSttSupported, browserTtsSupported } from './types';

/* -------------------------------------------------------------------------- */
/* 最小类型声明：Web Speech API 没进标准 lib.dom，只能自己声明用到的部分 */
/* -------------------------------------------------------------------------- */

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}

interface RecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: RecognitionResult;
  };
}

interface RecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as RecognitionCtor | undefined;
}

/* -------------------------------------------------------------------------- */
/* 识别 */
/* -------------------------------------------------------------------------- */

export interface BrowserSttOptions {
  lang: string;
  /** 静音多久算说完了 */
  silenceMs: number;
  /** 识别被浏览器掐断后自动重开的延迟 */
  restartDelayMs?: number;
}

export class BrowserStt implements SttAdapter {
  readonly id = 'browser-stt';
  readonly label = '浏览器内置识别';

  private recognition: SpeechRecognitionLike | null = null;
  private handlers: SttHandlers | null = null;
  private wantRunning = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private finalBuffer = '';
  private interim = '';

  constructor(private readonly options: BrowserSttOptions) {}

  async available(): Promise<boolean> {
    return browserSttSupported();
  }

  async start(handlers: SttHandlers): Promise<void> {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      throw new Error('这个浏览器不支持语音识别（Web Speech API）');
    }
    this.handlers = handlers;
    this.wantRunning = true;
    this.resetBuffers();

    const recognition = new Ctor();
    recognition.lang = this.options.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => this.handleError(event);
    recognition.onend = () => this.handleEnd();

    this.recognition = recognition;
    recognition.start();
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    this.clearTimers();
    this.commit();
    try {
      this.recognition?.stop();
    } catch {
      // 没在跑的时候 stop 会抛，忽略
    }
  }

  abort(): void {
    this.wantRunning = false;
    this.clearTimers();
    this.resetBuffers();
    try {
      this.recognition?.abort();
    } catch {
      // 同上
    }
    this.recognition = null;
  }

  /* ---------------------------------------------------------------------- */

  private handleResult(event: RecognitionEvent): void {
    let newFinal = '';
    let newInterim = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) newFinal += text;
      else newInterim += text;
    }

    if (newFinal) {
      this.finalBuffer += newFinal;
      this.interim = '';
    } else {
      this.interim = newInterim;
    }

    const combined = this.combined().trim();
    if (combined) {
      this.handlers?.onPartial?.(combined);
      // 有内容就重置静音计时，没有新内容才允许判句
      this.armSilenceTimer();
    }
  }

  private handleError(event: RecognitionErrorEvent): void {
    // no-speech / aborted 是常态，不该弹错给用户
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      this.wantRunning = false;
      this.handlers?.onError?.(new Error('麦克风权限被拒绝，请在浏览器地址栏左侧重新允许'));
      return;
    }
    this.handlers?.onError?.(new Error(`识别出错：${event.error}`));
  }

  private handleEnd(): void {
    this.handlers?.onEnd?.();
    if (!this.wantRunning) return;
    // Chrome 静音一会儿就自己停了，这里补一次重启
    this.commit();
    this.restartTimer = setTimeout(() => {
      if (!this.wantRunning || !this.recognition) return;
      try {
        this.recognition.start();
      } catch {
        // 已经在跑了会抛，忽略
      }
    }, this.options.restartDelayMs ?? 250);
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.commit();
      // 判句后重启一次，让识别引擎从干净状态继续
      if (this.wantRunning && this.recognition) {
        try {
          this.recognition.stop();
        } catch {
          // 忽略
        }
      }
    }, this.options.silenceMs);
  }

  private commit(): void {
    const text = this.combined().trim();
    this.resetBuffers();
    if (text) this.handlers?.onFinal?.(text);
  }

  private combined(): string {
    return this.finalBuffer + this.interim;
  }

  private resetBuffers(): void {
    this.finalBuffer = '';
    this.interim = '';
  }

  private clearTimers(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.silenceTimer = null;
    this.restartTimer = null;
  }
}

/* -------------------------------------------------------------------------- */
/* 合成 */
/* -------------------------------------------------------------------------- */

export class BrowserTts implements TtsAdapter {
  readonly id = 'browser-tts';
  readonly label = '浏览器内置合成';

  private current: SpeechSynthesisUtterance | null = null;
  private voicesReady: Promise<void> | null = null;

  async available(): Promise<boolean> {
    return browserTtsSupported();
  }

  isSpeaking(): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    return window.speechSynthesis.speaking;
  }

  async speak(text: string, options: SpeakOptions): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const clean = text.trim();
    if (!clean) return;

    await this.ensureVoices();

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = options.lang;
      utterance.rate = clamp(options.rate ?? 1, 0.5, 2);

      const voice = pickVoice(options.lang);
      if (voice) utterance.voice = voice;

      const finish = () => {
        if (this.current === utterance) this.current = null;
        resolve();
      };

      utterance.onend = finish;
      // 合成失败不该卡住整条对话链
      utterance.onerror = finish;

      this.current = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    this.current = null;
  }

  /** 音色列表是异步加载的，第一次 speak 前必须等一次 */
  private ensureVoices(): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve();
    if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
    if (this.voicesReady) return this.voicesReady;

    this.voicesReady = new Promise<void>((resolve) => {
      const done = () => {
        window.speechSynthesis.onvoiceschanged = null;
        resolve();
      };
      window.speechSynthesis.onvoiceschanged = done;
      // 有些浏览器不发这个事件，兜个底
      setTimeout(done, 1200);
    });
    return this.voicesReady;
  }
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return undefined;

  const exact = voices.find((v) => v.lang.replace('_', '-') === lang);
  if (exact) return exact;

  const prefix = lang.split('-')[0];
  const sameLanguage = voices.find((v) => v.lang.toLowerCase().startsWith(prefix.toLowerCase()));
  return sameLanguage;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
