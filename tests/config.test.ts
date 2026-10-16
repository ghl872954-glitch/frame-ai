import { describe, expect, it } from 'vitest';

import {
  defaultConfig,
  exportConfig,
  isConfigured,
  maskKey,
  normalizeConfig,
  type AppConfig,
} from '@/lib/config';

/** 模拟「localStorage 里被人写坏了」的配置：字段还在，但值是垃圾 */
function corrupt(patch: Record<string, unknown>): AppConfig {
  const base = defaultConfig();
  return { ...base, ...(patch as Partial<AppConfig>) } as AppConfig;
}

describe('normalizeConfig 兜住坏配置', () => {
  it('theme 是非法值时回退到深色 —— 否则整套设计变量失效，界面变白板', () => {
    const config = normalizeConfig(
      corrupt({ ui: { theme: {} as never, language: 'zh' } }),
    );
    expect(config.ui.theme).toBe('dark');
  });

  it('language 是非法值时回退到中文', () => {
    const config = normalizeConfig(
      corrupt({ ui: { theme: 'dark', language: 42 as never } }),
    );
    expect(config.ui.language).toBe('zh');
  });

  it('合法的值原样保留', () => {
    const config = normalizeConfig(
      corrupt({ ui: { theme: 'light', language: 'en' } }),
    );
    expect(config.ui.theme).toBe('light');
    expect(config.ui.language).toBe('en');
  });

  it('三个主题值都认', () => {
    for (const theme of ['dark', 'light', 'system'] as const) {
      expect(normalizeConfig(corrupt({ ui: { theme, language: 'zh' } })).ui.theme).toBe(theme);
    }
  });

  it('语音引擎只认 auto / cloud / browser', () => {
    const config = normalizeConfig(
      corrupt({
        voice: { ...defaultConfig().voice, sttEngine: 'telepathy' as never, ttsEngine: 'cloud' },
      }),
    );
    expect(config.voice.sttEngine).toBe('auto');
    expect(config.voice.ttsEngine).toBe('cloud');
  });

  it('数值越界会被夹回范围里', () => {
    const config = normalizeConfig(
      corrupt({
        voice: {
          ...defaultConfig().voice,
          silenceMs: 999999,
          ttsRate: -3,
        },
      }),
    );
    expect(config.voice.silenceMs).toBe(2500);
    expect(config.voice.ttsRate).toBe(0.6);
  });

  it('数值是 NaN 或字符串时用默认值', () => {
    const config = normalizeConfig(
      corrupt({
        voice: { ...defaultConfig().voice, silenceMs: Number.NaN, ttsRate: '1.2' as never },
      }),
    );
    expect(config.voice.silenceMs).toBe(defaultConfig().voice.silenceMs);
    expect(config.voice.ttsRate).toBe(defaultConfig().voice.ttsRate);
  });

  it('空闲自动退出默认 3 分钟', () => {
    expect(defaultConfig().voice.idleTimeoutMs).toBe(180_000);
  });

  it('空闲自动退出设成 0 是合法的 —— 表示不自动退出，不能被夹成别的值', () => {
    const config = normalizeConfig(
      corrupt({ voice: { ...defaultConfig().voice, idleTimeoutMs: 0 } }),
    );
    expect(config.voice.idleTimeoutMs).toBe(0);
  });

  it('空闲超时给个离谱的大数会被夹回上限', () => {
    const config = normalizeConfig(
      corrupt({ voice: { ...defaultConfig().voice, idleTimeoutMs: 99_999_999 } }),
    );
    expect(config.voice.idleTimeoutMs).toBe(3_600_000);
  });

  it('负数当成「不自动退出」—— 宁可让它一直开着，也别突然把用户的对话掐了', () => {
    const config = normalizeConfig(
      corrupt({ voice: { ...defaultConfig().voice, idleTimeoutMs: -1 } }),
    );
    expect(config.voice.idleTimeoutMs).toBe(0);
  });

  it('空闲超时是垃圾值时用默认值', () => {
    for (const bad of ['3分钟' as never, {} as never, Number.NaN, undefined]) {
      const config = normalizeConfig(
        corrupt({ voice: { ...defaultConfig().voice, idleTimeoutMs: bad } }),
      );
      expect(config.voice.idleTimeoutMs).toBe(180_000);
    }
  });

  it('布尔字段收到非布尔值时用默认值', () => {
    const config = normalizeConfig(
      corrupt({ voice: { ...defaultConfig().voice, enabled: 'yes' as never } }),
    );
    expect(typeof config.voice.enabled).toBe('boolean');
  });

  it('字符串字段收到对象时用默认值，不会把 [object Object] 当成接口地址', () => {
    const config = normalizeConfig(
      corrupt({ provider: { ...defaultConfig().provider, baseUrl: {} as never } }),
    );
    expect(config.provider.baseUrl).toBe(defaultConfig().provider.baseUrl);
  });

  it('整个 provider 段丢了也能补回来', () => {
    const config = normalizeConfig({ version: 1 } as AppConfig);
    expect(config.provider.baseUrl).toBe(defaultConfig().provider.baseUrl);
    expect(config.ui.theme).toBe('dark');
  });

  it('人格的自定义字段缺了不会崩', () => {
    const config = normalizeConfig(
      corrupt({ persona: { enabled: true, id: 'custom' } as never }),
    );
    expect(config.persona.custom).toEqual({ name: '', prompt: '', greeting: '' });
  });

  it('修完的配置本身是合法的，再修一次不变', () => {
    const once = normalizeConfig(corrupt({ ui: { theme: 1 as never, language: 'xx' as never } }));
    expect(normalizeConfig(once)).toEqual(once);
  });
});

describe('key 脱敏与导出', () => {
  it('短 key 全部打码，不泄露长度', () => {
    expect(maskKey('abc')).toBe('••••');
    expect(maskKey('')).toBe('');
  });

  it('长 key 只露头尾', () => {
    const masked = maskKey('sk-1234567890abcdef');
    expect(masked).toBe('sk-1••••cdef');
    expect(masked).not.toContain('234567890');
  });

  it('导出配置会抹掉 key —— 用户贴给别人排查问题时不至于泄露', () => {
    const config = defaultConfig();
    config.provider.apiKey = 'sk-super-secret-value';
    const exported = exportConfig(config);
    expect(exported).not.toContain('sk-super-secret-value');
    expect(JSON.parse(exported).provider.apiKey).toBe('');
  });

  it('导出不会改到原对象', () => {
    const config = defaultConfig();
    config.provider.apiKey = 'sk-keep-me';
    exportConfig(config);
    expect(config.provider.apiKey).toBe('sk-keep-me');
  });

  it('地址和模型都填了才算配置好了', () => {
    const config = defaultConfig();
    config.provider.apiKey = 'sk-x';
    expect(isConfigured(config)).toBe(true);

    config.provider.baseUrl = '';
    expect(isConfigured(config)).toBe(false);
  });
});
