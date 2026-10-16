/**
 * 语音会话编排。
 *
 * 所有依赖都是注入进来的，所以这一层不碰任何浏览器 API ——
 * 打断、状态流转、错误恢复这些最容易出 bug 的逻辑，可以用假适配器完整测出来。
 *
 * 状态机：
 *
 *   idle ──start──▶ listening ──用户说完──▶ thinking ──首句就绪──▶ speaking
 *                      ▲                                          │
 *                      └────────── 播完 / 被打断 ──────────────────┘
 */

import { SentenceBuffer } from './sentence';
import type { SttAdapter, TtsAdapter } from './types';

export type SessionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface VoiceSessionDeps {
  stt: SttAdapter;
  tts: TtsAdapter;
  /**
   * 把用户的话发给模型。
   * 边生成边通过 onChunk 回调，最后返回完整回复。
   */
  ask: (text: string, onChunk: (chunk: string) => void, signal: AbortSignal) => Promise<string>;
  onState?: (state: SessionState) => void;
  /**
   * 识别中的文字（边说边出）。
   *
   * 必须传出去 —— 用户得能看见它把话听成了什么。识别错了却看不见，
   * 就只能对着一个答非所问的回复发懵。
   */
  onPartialText?: (text: string) => void;
  onUserText?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onError?: (error: Error) => void;
  /** 允许在 AI 说话时打断 */
  bargeIn?: boolean;
  lang: string;
  ttsRate?: number;
  /**
   * 用户多久没开口就自动结束对话，毫秒。0 表示不自动结束。
   *
   * 为什么要有这个：一直挂着麦克风，浏览器的录音标志一直亮着，用户会不安；
   * 而且真忘了关，它会一直听着屋里所有人说话。给个上限更安心。
   */
  idleTimeoutMs?: number;
  /** 超时前多久先提醒一下，默认 30 秒 */
  idleWarningMs?: number;
  onIdleWarning?: () => void;
  onIdleTimeout?: () => void;
}

export class VoiceSession {
  private state: SessionState = 'idle';
  private controller: AbortController | null = null;
  private buffer = new SentenceBuffer();
  private turn = 0;
  private starting = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: VoiceSessionDeps) {}

  getState(): SessionState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle' || this.starting) return;
    this.starting = true;
    try {
      await this.deps.stt.start({
        onPartial: (text) => this.handlePartial(text),
        onFinal: (text) => {
          void this.handleUserUtterance(text);
        },
        onError: (error) => this.fail(error),
      });
      this.setState('listening');
    } catch (error) {
      this.fail(toError(error));
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    this.turn += 1; // 让进行中的那一轮作废
    this.clearIdle();
    this.controller?.abort();
    this.controller = null;
    this.deps.tts.stop();
    await this.deps.stt.stop();
    this.buffer.reset();
    this.setState('idle');
    // 会话结束了，界面上那句「正在识别」也要收掉
    this.deps.onPartialText?.('');
  }

  /** 打字入口：跳过识别，直接走「思考 → 说话」 */
  async sendText(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    await this.handleUserUtterance(clean, { fromVoice: false });
  }

  /** 用户主动打断（点按钮，不是靠 VAD 检测） */
  interrupt(): void {
    if (this.state !== 'speaking' && this.state !== 'thinking') return;
    this.doInterrupt();
  }

  /**
   * 用户在别的地方有动作了（比如直接在输入框打字），把空闲计时重置一下。
   * 打字也是回应，不该被当成「没反应」。
   */
  poke(): void {
    if (this.state === 'listening') this.armIdle();
  }

  /* ---------------------------------------------------------------------- */

  private handlePartial(text: string): void {
    const clean = text.trim();
    if (!clean) return;

    // 先交出去。识别结果必须实时可见，用户才能当场发现听错了。
    // 浏览器的中间结果是一点点修正的（「今天」→「今天天气」→「今天天气怎么样」），
    // 所以这里会反复覆盖，界面上就是活的。
    this.deps.onPartialText?.(clean);

    // 用户在 AI 说话时开口 → 立刻打断
    if (this.state === 'speaking' && this.deps.bargeIn !== false) {
      this.doInterrupt();
      return;
    }

    // 有识别结果说明用户开口了，空闲计时重新开始。
    // 这里用 onPartial 而不是 onFinal 是对的：用户说得慢、中间停顿长的时候，
    // 只认 final 会让计时在他还在说话时就跑完。
    if (this.state === 'listening') this.armIdle();
  }

  private doInterrupt(): void {
    this.turn += 1;
    this.controller?.abort();
    this.controller = null;
    this.deps.tts.stop();
    this.buffer.reset();
    this.setState('listening');
  }

  private async handleUserUtterance(
    text: string,
    options: { fromVoice?: boolean } = {},
  ): Promise<void> {
    const fromVoice = options.fromVoice ?? true;
    const turn = ++this.turn;

    this.deps.onUserText?.(text);
    this.setState('thinking');

    // 不打断模式下，说话期间先停掉识别，免得把自己的声音听进去
    if (fromVoice && this.deps.bargeIn === false) {
      await this.deps.stt.stop();
    }

    const controller = new AbortController();
    this.controller = controller;
    this.buffer.reset();

    let spoken = '';
    const speakQueue: Promise<void> = Promise.resolve();
    let chain = speakQueue;

    const enqueue = (sentence: string) => {
      chain = chain.then(async () => {
        if (turn !== this.turn) return; // 这一轮已经被打断
        this.setState('speaking');
        spoken += sentence;
        this.deps.onAssistantText?.(spoken);
        await this.deps.tts.speak(sentence, {
          lang: this.deps.lang,
          rate: this.deps.ttsRate,
        });
      });
    };

    try {
      const full = await this.deps.ask(
        text,
        (chunk) => {
          if (turn !== this.turn) return;
          for (const sentence of this.buffer.push(chunk)) enqueue(sentence);
        },
        controller.signal,
      );

      if (turn !== this.turn) return;

      const tail = this.buffer.flush();
      if (tail) enqueue(tail);
      if (!tail && !spoken && full.trim()) {
        // 模型一次性返回、没有流式片段
        enqueue(full.trim());
      }

      await chain;
      if (turn !== this.turn) return;

      this.setState('listening');
      if (fromVoice && this.deps.bargeIn === false) {
        await this.deps.stt.start({
          onPartial: (t) => this.handlePartial(t),
          onFinal: (t) => {
            void this.handleUserUtterance(t);
          },
          onError: (error) => this.fail(error),
        });
      }
    } catch (error) {
      if (isAbort(error)) return; // 被用户打断，不算错误
      this.fail(toError(error));
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private setState(state: SessionState): void {
    if (this.state === state) return;
    this.state = state;
    // 只在「等用户开口」这一档计时。思考和说话的时候不该倒计时 ——
    // 那段时间本来就不该有用户输入。
    if (state === 'listening') this.armIdle();
    else this.clearIdle();
    this.deps.onState?.(state);
  }

  /* ---------------------------------------------------------------------- */
  /* 空闲自动退出                                                            */
  /* ---------------------------------------------------------------------- */

  private armIdle(): void {
    this.clearIdle();
    const total = this.deps.idleTimeoutMs ?? 0;
    if (total <= 0) return;

    // 提醒最多占整个时长的三分之一 —— 否则用户把超时设得比提醒窗口还短时，
    // 提醒会在计时刚开始就弹出来，等于没有提醒
    const warn = Math.max(
      0,
      Math.min(this.deps.idleWarningMs ?? 30_000, Math.floor(total / 3)),
    );
    if (warn > 0) {
      this.warnTimer = setTimeout(() => {
        this.warnTimer = null;
        this.deps.onIdleWarning?.();
      }, total - warn);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.handleIdleTimeout();
    }, total);
  }

  private clearIdle(): void {
    if (this.warnTimer) clearTimeout(this.warnTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.warnTimer = null;
    this.idleTimer = null;
  }

  private async handleIdleTimeout(): Promise<void> {
    this.clearIdle();
    this.deps.onIdleTimeout?.();
    await this.stop();
  }

  private fail(error: Error): void {
    this.clearIdle();
    this.setState('error');
    this.deps.onError?.(error);
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
