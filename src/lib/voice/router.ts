/**
 * 降级阶梯的决策逻辑。
 *
 * 纯函数，没有任何浏览器 API 依赖 —— 因为它是最容易出错、也最该被测试的一块。
 *
 *   ① native  端点原生支持实时语音协议
 *   ② cascade 云端识别 + 云端合成（最通用）
 *   ③ browser 浏览器内置识别与合成（零配置）
 *   ④ text    纯文字
 */

import type {
  EngineKind,
  EnginePreference,
  TierDecision,
  VoiceCapabilities,
  VoiceTier,
} from './types';

// 调用方（store）只认这个模块，顺手把决策类型透出去，省得到处 import 两个文件
export type { TierDecision, VoiceCapabilities, VoiceTier, EngineKind, EnginePreference };

export function decideTier(
  caps: VoiceCapabilities,
  pref: EnginePreference,
  voiceEnabled = true,
): TierDecision {
  if (!voiceEnabled) {
    return { tier: 'text', stt: 'none', tts: 'none', reason: 'voice-disabled' };
  }

  // ① 原生实时协议：延迟最低，优先用
  if (caps.nativeRealtime && pref.stt === 'auto' && pref.tts === 'auto') {
    return { tier: 'native', stt: 'cloud', tts: 'cloud', reason: 'native-realtime' };
  }

  const stt = pickEngine(pref.stt, caps.cloudStt, caps.browserStt);
  const tts = pickEngine(pref.tts, caps.cloudTts, caps.browserTts);

  if (stt === 'none') {
    return { tier: 'text', stt, tts, reason: 'no-stt' };
  }
  if (tts === 'none') {
    // 能听不能说：还是能用的，退回纯文字让用户看字幕
    return { tier: 'text', stt, tts, reason: 'no-tts' };
  }

  const tier: VoiceTier = stt === 'cloud' && tts === 'cloud' ? 'cascade' : 'browser';
  const reason =
    tier === 'cascade'
      ? 'cascade-cloud'
      : stt === 'browser' && tts === 'browser'
        ? 'browser-only'
        : 'mixed';

  return { tier, stt, tts, reason };
}

function pickEngine(
  preference: EnginePreference['stt'],
  cloudAvailable: boolean,
  browserAvailable: boolean,
): EngineKind {
  if (preference === 'cloud') {
    if (cloudAvailable) return 'cloud';
    // 用户明确要云端但没有，退回浏览器而不是直接罢工
    return browserAvailable ? 'browser' : 'none';
  }
  if (preference === 'browser') {
    if (browserAvailable) return 'browser';
    return cloudAvailable ? 'cloud' : 'none';
  }
  // auto：云端优先（音质和准确率更好），没有再退浏览器
  if (cloudAvailable) return 'cloud';
  if (browserAvailable) return 'browser';
  return 'none';
}

/** 给界面用的一句话解释，中英各一份 */
export function tierDescription(decision: TierDecision, lang: 'zh' | 'en'): string {
  const table: Record<TierDecision['reason'], { zh: string; en: string }> = {
    'voice-disabled': { zh: '语音已关闭，打字聊', en: 'Voice is off, typing mode' },
    'native-realtime': {
      zh: '端点原生支持实时语音，延迟最低',
      en: 'Endpoint supports native realtime voice',
    },
    'cascade-cloud': {
      zh: '云端识别 + 云端合成，效果最好的一档',
      en: 'Cloud STT + cloud TTS, best quality tier',
    },
    mixed: {
      zh: '云端与浏览器内置混用',
      en: 'Mixing cloud and built-in engines',
    },
    'browser-only': {
      zh: '浏览器内置识别与合成，零配置但依赖浏览器',
      en: 'Browser built-in engines, zero setup',
    },
    'no-stt': {
      zh: '没有可用的语音识别，只能打字',
      en: 'No speech recognition available, typing only',
    },
    'no-tts': {
      zh: '没有可用的语音合成，回答只显示文字',
      en: 'No speech synthesis available, text only',
    },
  };
  return table[decision.reason][lang];
}
