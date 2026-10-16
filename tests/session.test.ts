import { describe, expect, it, vi } from 'vitest';

import { VoiceSession } from '@/lib/voice/session';
import type { SttAdapter, SttHandlers, TtsAdapter } from '@/lib/voice/types';

/**
 * 语音会话最容易出错的是「打断」：用户开口时，正在生成的那一轮必须彻底作废，
 * 不能有半个字漏出来。这套逻辑不碰任何浏览器 API，所以可以用假适配器完整测。
 */

class FakeStt implements SttAdapter {
  readonly id = 'fake-stt';
  readonly label = '假识别';
  started = 0;
  stopped = 0;
  aborted = 0;
  private handlers: SttHandlers | null = null;

  async available(): Promise<boolean> {
    return true;
  }

  async start(handlers: SttHandlers): Promise<void> {
    this.handlers = handlers;
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  abort(): void {
    this.aborted += 1;
  }

  /* 下面两个是测试用的：模拟识别引擎的回调 */
  partial(text: string): void {
    this.handlers?.onPartial?.(text);
  }

  final(text: string): void {
    this.handlers?.onFinal(text);
  }
}

class FakeTts implements TtsAdapter {
  readonly id = 'fake-tts';
  readonly label = '假合成';
  spoken: string[] = [];
  stopped = 0;
  private busy = false;

  async available(): Promise<boolean> {
    return true;
  }

  async speak(text: string): Promise<void> {
    this.spoken.push(text);
    this.busy = true;
    await Promise.resolve();
    this.busy = false;
  }

  stop(): void {
    this.stopped += 1;
  }

  isSpeaking(): boolean {
    return this.busy;
  }
}

/** 等所有微任务和一次宏任务跑完，让链式的说话队列落地 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Harness {
  session: VoiceSession;
  stt: FakeStt;
  tts: FakeTts;
  /** 手动往流里塞一段模型输出 */
  chunk: (text: string) => void;
  /** 手动结束这一轮，返回完整回复 */
  finish: (full: string) => void;
  /** 让这一轮以错误收场 */
  fail: (error: unknown) => void;
  states: string[];
  userTexts: string[];
  assistantTexts: string[];
  /** 识别中的文字，按时间顺序全记下来 */
  partialTexts: string[];
  errors: Error[];
  /** 「还在吗」提醒响了几次 */
  warnings: number;
  /** 空闲自动退出触发了几次 */
  timeouts: number;
}

function makeHarness(
  options: {
    bargeIn?: boolean;
    idleTimeoutMs?: number;
    idleWarningMs?: number;
  } = {},
): Harness {
  const stt = new FakeStt();
  const tts = new FakeTts();
  const states: string[] = [];
  const userTexts: string[] = [];
  const assistantTexts: string[] = [];
  const partialTexts: string[] = [];
  const errors: Error[] = [];

  let emit: (text: string) => void = () => undefined;
  let resolveAsk: (full: string) => void = () => undefined;
  let rejectAsk: (error: unknown) => void = () => undefined;

  const harness: Harness = {
    session: null as unknown as VoiceSession,
    stt,
    tts,
    chunk: (text) => emit(text),
    finish: (full) => resolveAsk(full),
    fail: (error) => rejectAsk(error),
    states,
    userTexts,
    assistantTexts,
    partialTexts,
    errors,
    warnings: 0,
    timeouts: 0,
  };

  harness.session = new VoiceSession({
    stt,
    tts,
    lang: 'zh-CN',
    bargeIn: options.bargeIn,
    idleTimeoutMs: options.idleTimeoutMs,
    idleWarningMs: options.idleWarningMs,
    onState: (state) => states.push(state),
    onPartialText: (text) => partialTexts.push(text),
    onUserText: (text) => userTexts.push(text),
    onAssistantText: (text) => assistantTexts.push(text),
    onError: (error) => errors.push(error),
    onIdleWarning: () => {
      harness.warnings += 1;
    },
    onIdleTimeout: () => {
      harness.timeouts += 1;
    },
    ask: (_text, onChunk) => {
      emit = onChunk;
      return new Promise<string>((resolve, reject) => {
        resolveAsk = resolve;
        rejectAsk = reject;
      });
    },
  });

  return harness;
}

/** 让会话进入「正在思考」状态：启动识别 → 用户说完一句 */
async function startAndSpeak(h: Harness, text = '你好'): Promise<void> {
  await h.session.start();
  h.stt.final(text);
  await settle();
}

describe('状态流转', () => {
  it('启动后进入 listening', async () => {
    const h = makeHarness();
    await h.session.start();
    expect(h.session.getState()).toBe('listening');
    expect(h.stt.started).toBe(1);
  });

  it('重复 start 不会重复启动识别', async () => {
    const h = makeHarness();
    await h.session.start();
    await h.session.start();
    expect(h.stt.started).toBe(1);
  });

  it('用户说完 → thinking', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    expect(h.session.getState()).toBe('thinking');
  });

  it('第一句切出来 → speaking，全部播完 → 回到 listening', async () => {
    const h = makeHarness();
    await startAndSpeak(h);

    h.chunk('第一句。');
    await settle();
    expect(h.session.getState()).toBe('speaking');

    h.finish('第一句。');
    await settle();
    expect(h.session.getState()).toBe('listening');
  });

  it('stop 之后回到 idle', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    await h.session.stop();
    expect(h.session.getState()).toBe('idle');
    expect(h.stt.stopped).toBe(1);
  });

  it('状态变化会通知出去，界面靠它换动效', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('好。');
    await settle();
    h.finish('好。');
    await settle();
    expect(h.states).toEqual(['listening', 'thinking', 'speaking', 'listening']);
  });
});

describe('流式切句与朗读', () => {
  it('一次来两句就依次播两句', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('第一句。第二句。');
    await settle();
    expect(h.tts.spoken).toEqual(['第一句。', '第二句。']);
  });

  it('分多次来的碎片也能拼成整句再播', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('今天');
    h.chunk('天气');
    await settle();
    expect(h.tts.spoken).toEqual([]);
    h.chunk('不错。');
    await settle();
    expect(h.tts.spoken).toEqual(['今天天气不错。']);
  });

  it('最后没说完的尾巴也要念出来', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('说到一半');
    await settle();
    expect(h.tts.spoken).toEqual([]);

    h.finish('说到一半');
    await settle();
    expect(h.tts.spoken).toEqual(['说到一半']);
  });

  it('模型完全不流式、一次性返回，也要念出来', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.finish('好的，我知道了。');
    await settle();
    expect(h.tts.spoken).toEqual(['好的，我知道了。']);
  });

  it('累计的助手文本回调出去，字幕靠它同步', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('第一句。第二句。');
    await settle();
    h.finish('第一句。第二句。');
    await settle();
    expect(h.assistantTexts).toEqual(['第一句。', '第一句。第二句。']);
  });

  it('用户说的话回调出去，界面才知道该显示什么', async () => {
    const h = makeHarness();
    await startAndSpeak(h, '帮我查一下');
    expect(h.userTexts).toEqual(['帮我查一下']);
  });
});

describe('打断', () => {
  it('AI 说话时用户开口 → 立刻停播、回到 listening', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('我先说一大段。');
    await settle();
    expect(h.session.getState()).toBe('speaking');

    h.stt.partial('等等');
    expect(h.session.getState()).toBe('listening');
    expect(h.tts.stopped).toBe(1);
  });

  it('被打断后，这一轮剩下的内容一个字都不能再念', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('第一句。');
    await settle();
    expect(h.tts.spoken).toEqual(['第一句。']);

    h.stt.partial('等等');
    h.chunk('第二句。');
    h.finish('第一句。第二句。');
    await settle();

    expect(h.tts.spoken).toEqual(['第一句。']);
  });

  it('点按钮也能打断，thinking 阶段就有效', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    expect(h.session.getState()).toBe('thinking');

    h.session.interrupt();
    expect(h.session.getState()).toBe('listening');

    h.finish('迟到的回复');
    await settle();
    expect(h.tts.spoken).toEqual([]);
  });

  it('没在说话的时候点打断，什么也不做', async () => {
    const h = makeHarness();
    await h.session.start();
    expect(h.session.getState()).toBe('listening');
    h.session.interrupt();
    expect(h.session.getState()).toBe('listening');
    expect(h.tts.stopped).toBe(0);
  });

  it('关掉打断开关后，说话期间听到声音也不打断', async () => {
    const h = makeHarness({ bargeIn: false });
    await startAndSpeak(h);
    h.chunk('我在说话。');
    await settle();
    expect(h.session.getState()).toBe('speaking');

    h.stt.partial('喂');
    expect(h.session.getState()).toBe('speaking');
    expect(h.tts.stopped).toBe(0);
  });

  it('关掉打断开关时，说话期间先把识别停掉，免得把自己的声音听进去', async () => {
    const h = makeHarness({ bargeIn: false });
    await startAndSpeak(h);
    expect(h.stt.stopped).toBe(1);

    h.finish('说完了。');
    await settle();
    // 说完要重新打开识别
    expect(h.stt.started).toBe(2);
  });

  it('stop 会把进行中的那一轮一起作废', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    await h.session.stop();
    expect(h.session.getState()).toBe('idle');

    h.chunk('迟到的内容。');
    h.finish('迟到的内容。');
    await settle();
    expect(h.tts.spoken).toEqual([]);
    expect(h.session.getState()).toBe('idle');
  });
});

describe('打字入口', () => {
  it('打字不发识别，直接思考', async () => {
    const h = makeHarness();
    await h.session.start();
    // sendText 会一直等到模型回复，所以不能 await —— 它要等我们手动 finish
    void h.session.sendText('帮我看一下');
    await settle();
    expect(h.userTexts).toEqual(['帮我看一下']);
    expect(h.session.getState()).toBe('thinking');
  });

  it('打字进来时，就算关了打断也不停识别（没在说话）', async () => {
    const h = makeHarness({ bargeIn: false });
    await h.session.start();
    void h.session.sendText('打字的');
    await settle();
    expect(h.stt.stopped).toBe(0);
  });

  it('空白内容不触发任何东西', async () => {
    const h = makeHarness();
    await h.session.start();
    await h.session.sendText('   ');
    expect(h.userTexts).toEqual([]);
    expect(h.session.getState()).toBe('listening');
  });
});

describe('空闲自动退出', () => {
  it('一直没开口就自己结束，把麦克风让出来', async () => {
    const h = makeHarness({ idleTimeoutMs: 120 });
    await h.session.start();
    expect(h.session.getState()).toBe('listening');

    await sleep(200);

    expect(h.timeouts).toBe(1);
    expect(h.session.getState()).toBe('idle');
    expect(h.stt.stopped).toBeGreaterThan(0);
  });

  it('超时前先提醒一声，别让它悄悄关掉', async () => {
    // 提醒窗口是 min(60, 160/3=53) ≈ 53ms，所以 160ms 的计时会在约 107ms 时提醒
    const h = makeHarness({ idleTimeoutMs: 160, idleWarningMs: 60 });
    await h.session.start();

    await sleep(120);
    expect(h.warnings).toBe(1);
    expect(h.timeouts).toBe(0);
    expect(h.session.getState()).toBe('listening');

    await sleep(100);
    expect(h.timeouts).toBe(1);
  });

  it('超时设得比提醒窗口还短时，提醒不会一上来就弹 —— 最多占三分之一', async () => {
    // 总时长 120ms，提醒窗口 30s 明显过长，实际应该是 40ms 左右才响
    const h = makeHarness({ idleTimeoutMs: 120, idleWarningMs: 30_000 });
    await h.session.start();

    await sleep(20);
    expect(h.warnings).toBe(0);

    await sleep(60); // 累计 80ms，已经过了 40ms 的提醒点
    expect(h.warnings).toBe(1);
    expect(h.timeouts).toBe(0);
  });

  it('用户在超时前开口，计时重新开始', async () => {
    const h = makeHarness({ idleTimeoutMs: 150 });
    await h.session.start();

    await sleep(100);
    h.stt.partial('嗯');
    await sleep(100); // 累计 200ms，但距上次开口只有 100ms

    expect(h.timeouts).toBe(0);
    expect(h.session.getState()).toBe('listening');

    await sleep(120);
    expect(h.timeouts).toBe(1);
  });

  it('打字也算回应，不会被当成没反应', async () => {
    const h = makeHarness({ idleTimeoutMs: 150 });
    await h.session.start();

    await sleep(100);
    h.session.poke();
    await sleep(100);

    expect(h.timeouts).toBe(0);
    expect(h.session.getState()).toBe('listening');
  });

  it('AI 在想、在说的时候不倒计时 —— 那段时间本来就不该有输入', async () => {
    const h = makeHarness({ idleTimeoutMs: 120 });
    await startAndSpeak(h);
    expect(h.session.getState()).toBe('thinking');

    await sleep(200);
    expect(h.timeouts).toBe(0);
    expect(h.session.getState()).toBe('thinking');
  });

  it('回答完之后重新开始计时', async () => {
    const h = makeHarness({ idleTimeoutMs: 150 });
    await startAndSpeak(h);
    h.chunk('好的。');
    await settle();
    h.finish('好的。');
    await settle();
    expect(h.session.getState()).toBe('listening');

    await sleep(220);
    expect(h.timeouts).toBe(1);
  });

  it('设成 0 就永远不自动退出', async () => {
    const h = makeHarness({ idleTimeoutMs: 0 });
    await h.session.start();

    await sleep(200);
    expect(h.timeouts).toBe(0);
    expect(h.session.getState()).toBe('listening');
  });

  it('手动结束之后，计时器不会再响', async () => {
    const h = makeHarness({ idleTimeoutMs: 120 });
    await h.session.start();
    await h.session.stop();

    await sleep(200);
    expect(h.timeouts).toBe(0);
    expect(h.warnings).toBe(0);
  });

  it('被打断回到 listening 之后也重新开始计时', async () => {
    const h = makeHarness({ idleTimeoutMs: 150 });
    await startAndSpeak(h);
    h.chunk('我在说话。');
    await settle();
    expect(h.session.getState()).toBe('speaking');

    h.stt.partial('等等');
    expect(h.session.getState()).toBe('listening');

    await sleep(220);
    expect(h.timeouts).toBe(1);
  });
});

describe('识别中的文字要实时交出去', () => {
  it('边说边出，每一版都传出来 —— 用户才能当场发现听错了', async () => {
    const h = makeHarness();
    await h.session.start();

    h.stt.partial('今天');
    h.stt.partial('今天天气');
    h.stt.partial('今天天气怎么样');

    expect(h.partialTexts).toEqual(['今天', '今天天气', '今天天气怎么样']);
  });

  it('说完之后落定的那句照样交出去', async () => {
    const h = makeHarness();
    await h.session.start();
    h.stt.partial('今天天气怎么样');
    h.stt.final('今天天气怎么样');

    expect(h.userTexts).toEqual(['今天天气怎么样']);
  });

  it('空文本不往外传，免得界面闪一下空白', async () => {
    const h = makeHarness();
    await h.session.start();
    h.stt.partial('   ');
    expect(h.partialTexts).toEqual([]);
  });

  it('AI 说话时用户插话，识别结果一样要传出来', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.chunk('我先说一大段。');
    await settle();
    expect(h.session.getState()).toBe('speaking');

    h.stt.partial('等等');
    expect(h.partialTexts).toEqual(['等等']);
  });

  it('会话结束时发一个空串，把界面上那句「正在识别」收掉', async () => {
    const h = makeHarness();
    await h.session.start();
    h.stt.partial('说到一半');
    await h.session.stop();

    expect(h.partialTexts).toEqual(['说到一半', '']);
  });
});

describe('出错', () => {
  it('模型报错 → error 状态，并把错误交出去', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.fail(new Error('模型挂了'));
    await settle();
    expect(h.session.getState()).toBe('error');
    expect(h.errors[0].message).toBe('模型挂了');
  });

  it('被打断导致的 abort 不算错误，不该弹报错', async () => {
    const h = makeHarness();
    await startAndSpeak(h);
    h.session.interrupt();

    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    h.fail(abortError);
    await settle();

    expect(h.errors).toEqual([]);
    expect(h.session.getState()).toBe('listening');
  });

  it('识别启动失败也会进 error 状态', async () => {
    const h = makeHarness();
    h.stt.start = vi.fn(async () => {
      throw new Error('拿不到麦克风');
    });
    await h.session.start();
    expect(h.session.getState()).toBe('error');
    expect(h.errors[0].message).toBe('拿不到麦克风');
  });
});
