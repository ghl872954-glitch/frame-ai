/**
 * 云端合成与降级包装的测试。
 *
 * 这两个类碰了浏览器 API（fetch / Audio / URL.createObjectURL），
 * 测试环境是 node，所以下面把它们都换成假的 —— 测的是逻辑，不是浏览器。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CloudTts, FallbackTts } from '@/lib/voice/cloud';
import type { SpeakOptions, TtsAdapter } from '@/lib/voice/types';

const speakOptions: SpeakOptions = { lang: 'zh-CN' };

/* -------------------------------------------------------------------------- */
/* 假适配器                                                                    */
/* -------------------------------------------------------------------------- */

class FakeTts implements TtsAdapter {
  readonly id: string;
  readonly label: string;
  spoken: string[] = [];
  stopped = 0;
  speaking = false;

  constructor(
    id: string,
    private readonly shouldFail = false,
  ) {
    this.id = id;
    this.label = id;
  }

  async available(): Promise<boolean> {
    return true;
  }

  async speak(text: string): Promise<void> {
    if (this.shouldFail) throw new Error('主适配器挂了');
    this.spoken.push(text);
  }

  stop(): void {
    this.stopped += 1;
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
}

/* -------------------------------------------------------------------------- */
/* FallbackTts                                                                 */
/* -------------------------------------------------------------------------- */

describe('FallbackTts', () => {
  it('主适配器能用就不碰备用', async () => {
    const primary = new FakeTts('primary');
    const fallback = new FakeTts('fallback');
    const tts = new FallbackTts(primary, fallback);

    await tts.speak('你好', speakOptions);

    expect(primary.spoken).toEqual(['你好']);
    expect(fallback.spoken).toEqual([]);
  });

  it('主适配器挂了自动退回备用，不让整轮对话中断', async () => {
    const primary = new FakeTts('primary', true);
    const fallback = new FakeTts('fallback');
    const tts = new FallbackTts(primary, fallback);

    // 关键：这里不该抛错，否则 VoiceSession 会判定整轮失败
    await expect(tts.speak('你好', speakOptions)).resolves.toBeUndefined();
    expect(fallback.spoken).toEqual(['你好']);
  });

  it('stop 两边都要停 —— 只停一边会留下还在响的声音', () => {
    const primary = new FakeTts('primary');
    const fallback = new FakeTts('fallback');
    const tts = new FallbackTts(primary, fallback);

    tts.stop();

    expect(primary.stopped).toBe(1);
    expect(fallback.stopped).toBe(1);
  });

  it('任何一边在说话都算在说话', () => {
    const primary = new FakeTts('primary');
    const fallback = new FakeTts('fallback');
    const tts = new FallbackTts(primary, fallback);

    expect(tts.isSpeaking()).toBe(false);
    fallback.speaking = true;
    expect(tts.isSpeaking()).toBe(true);
  });

  it('id 里能看出是哪两个拼的', () => {
    const tts = new FallbackTts(new FakeTts('cloud-tts'), new FakeTts('browser-tts'));
    expect(tts.id).toBe('cloud-tts+browser-tts');
  });
});

/* -------------------------------------------------------------------------- */
/* CloudTts                                                                    */
/* -------------------------------------------------------------------------- */

describe('CloudTts', () => {
  const originalFetch = globalThis.fetch;
  const originalAudio = (globalThis as { Audio?: unknown }).Audio;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = () => 'blob:fake';
    URL.revokeObjectURL = () => undefined;
    // 假的 Audio：一播放就当作立刻播完，省得测试挂住
    (globalThis as { Audio?: unknown }).Audio = class {
      src = '';
      paused = true;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play(): Promise<void> {
        this.paused = false;
        setTimeout(() => this.onended?.(), 0);
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { Audio?: unknown }).Audio = originalAudio;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('把文本、模型、音色、语速原样交给代理', async () => {
    let captured: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: unknown, init: { body?: string }) => {
      captured = JSON.parse(String(init.body));
      return new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });
    }) as unknown as typeof fetch;

    const tts = new CloudTts({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      voice: 'alex',
    });

    await tts.speak('你好呀', { lang: 'zh-CN', rate: 1.2 });

    const payload = captured as unknown as Record<string, unknown>;
    expect(payload.model).toBe('FunAudioLLM/CosyVoice2-0.5B');
    expect(payload.input).toBe('你好呀');
    expect(payload.voice).toBe('alex');
    expect(payload.speed).toBe(1.2);
    expect((payload.provider as { baseUrl: string }).baseUrl).toBe(
      'https://api.example.com/v1',
    );
  });

  it('调用时传了 voice 就覆盖配置里的默认音色', async () => {
    let captured: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: unknown, init: { body?: string }) => {
      captured = JSON.parse(String(init.body));
      return new Response(new Blob([new Uint8Array([1])]), { status: 200 });
    }) as unknown as typeof fetch;

    const tts = new CloudTts({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'm',
      voice: 'alex',
    });

    await tts.speak('嗨', { lang: 'zh-CN', voice: 'nova' });

    expect((captured as unknown as Record<string, unknown>).voice).toBe('nova');
  });

  it('空文本不浪费一次请求', async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return new Response(new Blob([new Uint8Array([1])]), { status: 200 });
    }) as unknown as typeof fetch;

    const tts = new CloudTts({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    await tts.speak('   ', speakOptions);

    expect(called).toBe(0);
  });

  it('上游报错时抛出带人话的异常', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: '余额不足' } }), {
        status: 402,
      })) as unknown as typeof fetch;

    const tts = new CloudTts({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });

    await expect(tts.speak('你好', speakOptions)).rejects.toThrow('余额不足');
  });

  it('没配地址或模型就认为自己不可用', async () => {
    expect(await new CloudTts({ baseUrl: '', apiKey: 'k', model: 'm' }).available()).toBe(
      false,
    );
    expect(await new CloudTts({ baseUrl: 'https://x/v1', apiKey: 'k', model: '' }).available()).toBe(
      false,
    );
    expect(
      await new CloudTts({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }).available(),
    ).toBe(true);
  });

  it('stop 之后不再算在说话', async () => {
    globalThis.fetch = (async () =>
      new Response(new Blob([new Uint8Array([1])]), { status: 200 })) as unknown as typeof fetch;

    const tts = new CloudTts({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    tts.stop();

    expect(tts.isSpeaking()).toBe(false);
  });
});
