import { describe, expect, it } from 'vitest';

import { decideTier, tierDescription } from '@/lib/voice/router';
import type { TierDecision, VoiceCapabilities } from '@/lib/voice/types';

const NONE: VoiceCapabilities = {
  nativeRealtime: false,
  cloudStt: false,
  cloudTts: false,
  browserStt: false,
  browserTts: false,
};

function caps(patch: Partial<VoiceCapabilities>): VoiceCapabilities {
  return { ...NONE, ...patch };
}

const AUTO = { stt: 'auto', tts: 'auto' } as const;

describe('decideTier 降级阶梯', () => {
  it('语音关掉时直接回纯文字，不看能力', () => {
    const decision = decideTier(caps({ cloudStt: true, cloudTts: true }), AUTO, false);
    expect(decision.tier).toBe('text');
    expect(decision.reason).toBe('voice-disabled');
  });

  it('端点原生支持实时协议时走 native，延迟最低', () => {
    const decision = decideTier(
      caps({ nativeRealtime: true, cloudStt: true, cloudTts: true }),
      AUTO,
    );
    expect(decision.tier).toBe('native');
    expect(decision.reason).toBe('native-realtime');
  });

  it('用户手动指定了引擎时就不走 native —— 尊重用户的选择', () => {
    const decision = decideTier(
      caps({ nativeRealtime: true, cloudStt: true, cloudTts: true, browserStt: true }),
      { stt: 'browser', tts: 'auto' },
    );
    expect(decision.tier).not.toBe('native');
    expect(decision.stt).toBe('browser');
  });

  it('云端识别 + 云端合成 = cascade，效果最好的一档', () => {
    const decision = decideTier(caps({ cloudStt: true, cloudTts: true }), AUTO);
    expect(decision).toEqual({
      tier: 'cascade',
      stt: 'cloud',
      tts: 'cloud',
      reason: 'cascade-cloud',
    });
  });

  it('两个都只有浏览器内置时，仍然能用，只是标成 browser', () => {
    const decision = decideTier(caps({ browserStt: true, browserTts: true }), AUTO);
    expect(decision).toEqual({
      tier: 'browser',
      stt: 'browser',
      tts: 'browser',
      reason: 'browser-only',
    });
  });

  it('一边云端一边浏览器，标成 mixed', () => {
    const decision = decideTier(
      caps({ cloudStt: true, browserTts: true }),
      AUTO,
    );
    expect(decision.tier).toBe('browser');
    expect(decision.reason).toBe('mixed');
    expect(decision.stt).toBe('cloud');
    expect(decision.tts).toBe('browser');
  });

  it('没有任何识别能力时退回纯文字', () => {
    const decision = decideTier(caps({ browserTts: true }), AUTO);
    expect(decision.tier).toBe('text');
    expect(decision.reason).toBe('no-stt');
  });

  it('能听不能说：退回纯文字看字幕，而不是直接罢工', () => {
    const decision = decideTier(caps({ cloudStt: true }), AUTO);
    expect(decision.tier).toBe('text');
    expect(decision.reason).toBe('no-tts');
    expect(decision.stt).toBe('cloud');
  });

  it('用户点名要云端但云端没有，退回浏览器而不是报错', () => {
    const decision = decideTier(
      caps({ browserStt: true, browserTts: true }),
      { stt: 'cloud', tts: 'cloud' },
    );
    expect(decision.stt).toBe('browser');
    expect(decision.tts).toBe('browser');
  });

  it('用户点名要浏览器但浏览器没有，退回云端', () => {
    const decision = decideTier(
      caps({ cloudStt: true, cloudTts: true }),
      { stt: 'browser', tts: 'browser' },
    );
    expect(decision.tier).toBe('cascade');
    expect(decision.stt).toBe('cloud');
  });

  it('点名要一个、另一个没有：各自独立降级', () => {
    const decision = decideTier(
      caps({ cloudStt: true, browserTts: true }),
      { stt: 'browser', tts: 'cloud' },
    );
    expect(decision.stt).toBe('cloud');
    expect(decision.tts).toBe('browser');
  });

  it('自动模式下云端优先，因为音质和准确率更好', () => {
    const decision = decideTier(
      caps({ cloudStt: true, browserStt: true, cloudTts: true, browserTts: true }),
      AUTO,
    );
    expect(decision.stt).toBe('cloud');
    expect(decision.tts).toBe('cloud');
  });
});

describe('tierDescription', () => {
  const reasons: TierDecision['reason'][] = [
    'voice-disabled',
    'native-realtime',
    'cascade-cloud',
    'mixed',
    'browser-only',
    'no-stt',
    'no-tts',
  ];

  it('每个原因码中英都有话说，没有漏翻的', () => {
    for (const reason of reasons) {
      const decision: TierDecision = { tier: 'text', stt: 'none', tts: 'none', reason };
      const zh = tierDescription(decision, 'zh');
      const en = tierDescription(decision, 'en');
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(zh).not.toBe(en);
    }
  });
});
