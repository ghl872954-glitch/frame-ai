/**
 * 云端语音识别（降级阶梯的第 ② 档）。
 *
 * 浏览器内置那套（Web Speech API）识别质量有天花板：安静环境还行，
 * 有口音、有噪音、说快了就错。而它不给你音频数据，所以想换引擎只能自己录。
 *
 * 这里的做法：
 *   1. getUserMedia 拿麦克风
 *   2. 用 AnalyserNode 算音量，判断「开始说话 / 说完了」
 *   3. 说完把这段 webm 传给 /api/stt
 *   4. 拿回文本
 *
 * 代价是延迟：说完之后要多等 1～2 秒才出字。
 * 换来的是准确率明显高一截 —— 对「识别老是错」这个抱怨，这是唯一实质解法。
 */

import type { SttAdapter, SttHandlers } from './types';

export interface CloudSttOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 传给识别服务的语言，可省略（多数模型能自动判断） */
  language?: string;
  /** 静音多久算说完 */
  silenceMs: number;
  /** 音量超过这个值算「在说话」，0~1 */
  threshold?: number;
}

export class CloudStt implements SttAdapter {
  readonly id = 'cloud-stt';
  readonly label = '云端识别';

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;

  private handlers: SttHandlers | null = null;
  private wantRunning = false;
  /** 现在是否处于「用户正在说话」的状态 */
  private talking = false;
  /** 上一次检测到声音的时间 */
  private lastVoiceAt = 0;
  /** 正在上传识别，别重复触发 */
  private busy = false;

  constructor(private readonly options: CloudSttOptions) {}

  async available(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return Boolean(
      this.options.baseUrl &&
        this.options.model &&
        navigator.mediaDevices &&
        typeof MediaRecorder !== 'undefined',
    );
  }

  async start(handlers: SttHandlers): Promise<void> {
    this.handlers = handlers;
    this.wantRunning = true;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    this.tick();
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    this.stopTicker();
    await this.finishSegment(true);

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.analyser = null;
  }

  abort(): void {
    this.wantRunning = false;
    this.stopTicker();
    this.chunks = [];
    this.talking = false;

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.recorder = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.analyser = null;
  }

  /* ---------------------------------------------------------------------- */
  /* 音量检测                                                                */
  /* ---------------------------------------------------------------------- */

  private tick = (): void => {
    if (!this.wantRunning || !this.analyser) return;

    const frame = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(frame);

    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) {
      const centered = (frame[i] - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / frame.length);
    const threshold = this.options.threshold ?? 0.02;
    const now = Date.now();

    if (rms >= threshold) {
      this.lastVoiceAt = now;
      if (!this.talking) this.beginSegment();
    } else if (this.talking && now - this.lastVoiceAt >= this.options.silenceMs) {
      void this.finishSegment(false);
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private stopTicker(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /* ---------------------------------------------------------------------- */
  /* 录音片段                                                                */
  /* ---------------------------------------------------------------------- */

  private beginSegment(): void {
    if (!this.stream || this.talking) return;
    this.talking = true;
    this.chunks = [];

    const recorder = new MediaRecorder(this.stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.start();
    this.recorder = recorder;
  }

  private async finishSegment(flush: boolean): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      this.talking = false;
      return;
    }

    this.talking = false;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    this.recorder = null;

    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.chunks = [];
    if (blob.size === 0) return;

    // flush 表示是主动结束（用户点了停止），这时也要把最后这段送出去
    if (!this.wantRunning && !flush) return;

    await this.transcribe(blob);
  }

  private async transcribe(blob: Blob): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    try {
      const form = new FormData();
      form.append('file', blob, 'speech.webm');
      form.append('baseUrl', this.options.baseUrl);
      form.append('apiKey', this.options.apiKey);
      form.append('model', this.options.model);
      if (this.options.language) form.append('language', this.options.language);

      const response = await fetch('/api/stt', { method: 'POST', body: form });
      const data = (await response.json()) as { text?: string; error?: string };

      if (!response.ok) throw new Error(data.error ?? `识别失败（${response.status}）`);

      const text = (data.text ?? '').trim();
      // 空结果（比如只是咳嗽了一声）不该当成一句话发出去
      if (text) this.handlers?.onFinal?.(text);
    } catch (error) {
      this.handlers?.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.busy = false;
    }
  }
}
