/**
 * 云端语音合成（降级阶梯的第 ② 档）。
 *
 * 走 /api/tts 代理，不直连服务商 —— 各家 CORS 开得不一样，直连大概率被浏览器拦。
 * 只要服务商提供 OpenAI 兼容的 /audio/speech，就能用：
 *   硅基流动  FunAudioLLM/CosyVoice2-0.5B
 *   OpenAI    tts-1 / gpt-4o-mini-tts
 *   其他     任何兼容实现的模型
 *
 * 音质和浏览器内置那三个老语音不是一个量级 —— 这是「声音太水」唯一的实质解法。
 */

import type { SpeakOptions, TtsAdapter } from './types';

export interface CloudTtsOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice?: string;
}

export class CloudTts implements TtsAdapter {
  readonly id = 'cloud-tts';
  readonly label = '云端合成';

  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly options: CloudTtsOptions) {}

  async available(): Promise<boolean> {
    return Boolean(this.options.baseUrl && this.options.model);
  }

  async speak(text: string, options: SpeakOptions): Promise<void> {
    const clean = text.trim();
    if (!clean) return;

    // 同一时间只允许一段在放，新的进来先把旧的掐掉
    this.stop();

    const controller = new AbortController();
    this.controller = controller;

    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: { baseUrl: this.options.baseUrl, apiKey: this.options.apiKey },
        model: this.options.model,
        input: clean,
        voice: options.voice?.trim() || this.options.voice?.trim() || undefined,
        speed: options.rate,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(readError(detail) || `合成失败（${response.status}）`);
    }

    const blob = await response.blob();
    // 请求期间被打断了就别再往下走
    if (controller.signal.aborted) return;

    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;

    await new Promise<void>((resolve) => {
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        resolve();
      };
      audio.onended = done;
      // 解码失败不该卡住整条对话链 —— 让它照常往下走，字幕还在
      audio.onerror = done;
      void audio.play().catch(done);
    });

    this.release();
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this.release();
  }

  isSpeaking(): boolean {
    return Boolean(this.audio && !this.audio.paused);
  }

  private release(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

/**
 * 主适配器失败时自动退回备用。
 *
 * 云端合成会因为余额用完、模型下线、网络抖动各种原因失败。
 * 那不该让整轮对话挂掉 —— 退回浏览器内置，声音差但至少能听见。
 */
export class FallbackTts implements TtsAdapter {
  readonly id: string;
  readonly label: string;

  constructor(
    private readonly primary: TtsAdapter,
    private readonly fallback: TtsAdapter,
  ) {
    this.id = `${primary.id}+${fallback.id}`;
    this.label = primary.label;
  }

  async available(): Promise<boolean> {
    if (await this.primary.available()) return true;
    return this.fallback.available();
  }

  async speak(text: string, options: SpeakOptions): Promise<void> {
    try {
      await this.primary.speak(text, options);
    } catch {
      await this.fallback.speak(text, options);
    }
  }

  stop(): void {
    this.primary.stop();
    this.fallback.stop();
  }

  isSpeaking(): boolean {
    return this.primary.isSpeaking() || this.fallback.isSpeaking();
  }
}

function readError(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
    if (typeof message === 'string') return message.slice(0, 200);
  } catch {
    // 不是 JSON，截一段原文
  }
  return raw.slice(0, 200);
}
