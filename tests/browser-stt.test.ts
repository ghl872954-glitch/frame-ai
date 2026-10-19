/**
 * 浏览器识别适配器的测试。
 *
 * 重点是判句逻辑：判定「说完了」之后只能提交结果，不能把识别引擎停掉 ——
 * 停了就要等 onend + 重启延迟，那段时间用户说的话会丢。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrowserStt } from '@/lib/voice/browser';

/* -------------------------------------------------------------------------- */
/* 假的 SpeechRecognition                                                     */
/* -------------------------------------------------------------------------- */

class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;

  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  started = 0;
  stopped = 0;

  start(): void {
    this.started += 1;
  }

  stop(): void {
    this.stopped += 1;
    // 真实浏览器里 stop() 之后会异步触发 onend
    this.onend?.();
  }

  abort(): void {
    this.stopped += 1;
  }

  /** 模拟一次识别结果 */
  emit(text: string, isFinal: boolean): void {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal, length: 1, 0: { transcript: text } }],
    });
  }
}

let lastRecognition: FakeRecognition | null = null;

/** 记录最后创建的那个实例。用函数而不是 `x = this` —— 直接别名 this 会被 lint 拦。 */
function track(instance: FakeRecognition): void {
  lastRecognition = instance;
}

/* -------------------------------------------------------------------------- */

describe('BrowserStt 判句', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    lastRecognition = null;
    (globalThis as { window?: unknown }).window = {
      SpeechRecognition: class extends FakeRecognition {
        constructor() {
          super();
          track(this);
        }
      },
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('静音到时间就提交这句，但**不**停引擎', async () => {
    const finals: string[] = [];
    const stt = new BrowserStt({ lang: 'zh-CN', silenceMs: 60 });

    await stt.start({
      onFinal: (text) => finals.push(text),
    });

    lastRecognition?.emit('今天天气怎么样', false);

    // 等静音计时器触发
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(finals).toEqual(['今天天气怎么样']);
    // 核心断言：判句后引擎必须还在跑，停了就会丢接下来那句话
    expect(lastRecognition?.stopped).toBe(0);

    await stt.stop();
  });

  it('判句后缓冲区清空，接着说下一句不会重复上一句', async () => {
    const finals: string[] = [];
    const stt = new BrowserStt({ lang: 'zh-CN', silenceMs: 60 });

    await stt.start({ onFinal: (text) => finals.push(text) });

    lastRecognition?.emit('第一句', false);
    await new Promise((resolve) => setTimeout(resolve, 120));

    lastRecognition?.emit('第二句', false);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(finals).toEqual(['第一句', '第二句']);

    await stt.stop();
  });

  it('识别中的文字会实时回调出去', async () => {
    const partials: string[] = [];
    const stt = new BrowserStt({ lang: 'zh-CN', silenceMs: 500 });

    await stt.start({ onFinal: () => undefined, onPartial: (t) => partials.push(t) });

    lastRecognition?.emit('今天', false);
    lastRecognition?.emit('今天天气', false);

    expect(partials).toEqual(['今天', '今天天气']);

    await stt.stop();
  });

  it('正常 stop 时才真的停引擎', async () => {
    const stt = new BrowserStt({ lang: 'zh-CN', silenceMs: 500 });
    await stt.start({ onFinal: () => undefined });

    await stt.stop();

    expect(lastRecognition?.stopped).toBeGreaterThan(0);
  });
});
