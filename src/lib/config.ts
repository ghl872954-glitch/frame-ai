/**
 * 配置模型与本地持久化。
 *
 * 存 localStorage。之所以不上服务端：本地运行时它就在你自己机器上，
 * 部署成网站时服务端又没有可写磁盘。放浏览器里两边都能跑，代码只有一套。
 *
 * 安全提醒：key 存在浏览器 localStorage，同源的脚本能读到。
 * 别在公用电脑上用，别把带 key 的浏览器 profile 同步到云。
 * 后续会补一个「本地加密存储」的选项。
 */

import { findPreset, PROVIDERS } from './providers';
import { DEFAULT_PERSONA_ID } from './personas';

export const CONFIG_VERSION = 1;
export const CONFIG_STORAGE_KEY = 'frame.config.v1';

export type Lang = 'zh' | 'en';
export type EnginePref = 'auto' | 'cloud' | 'browser';
export type ThemePref = 'dark' | 'light' | 'system';

export interface ProviderConfig {
  /** 选中的预设 id，仅用于界面回显；实际生效的是下面这些字段 */
  presetId: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
}

export interface VoiceConfig {
  enabled: boolean;
  sttEngine: EnginePref;
  ttsEngine: EnginePref;
  /** 识别用的语言，BCP-47，如 zh-CN / en-US */
  lang: string;
  /** 静音多久算「说完了」，毫秒 */
  silenceMs: number;
  /** 允许在 AI 说话时打断它 */
  bargeIn: boolean;
  /** 合成语速 */
  ttsRate: number;
  /** 用户多久没开口就自动结束对话，毫秒。0 = 不自动结束 */
  idleTimeoutMs: number;
}

export interface PersonaConfig {
  enabled: boolean;
  id: string;
  /** 用户自己写的人格 */
  custom: {
    name: string;
    prompt: string;
    greeting: string;
  };
}

export interface MemoryConfig {
  enabled: boolean;
  /** 短期对话保留轮数 */
  historyTurns: number;
}

export interface UiConfig {
  language: Lang;
  theme: ThemePref;
}

export interface AppConfig {
  version: number;
  provider: ProviderConfig;
  voice: VoiceConfig;
  persona: PersonaConfig;
  memory: MemoryConfig;
  ui: UiConfig;
}

export function defaultConfig(): AppConfig {
  const preset = findPreset('siliconflow') ?? PROVIDERS[0];
  return {
    version: CONFIG_VERSION,
    provider: {
      presetId: preset.id,
      baseUrl: preset.baseUrl,
      apiKey: '',
      chatModel: preset.chatModel,
      sttModel: preset.sttModel ?? '',
      ttsModel: preset.ttsModel ?? '',
      ttsVoice: preset.ttsVoice ?? '',
    },
    voice: {
      enabled: true,
      sttEngine: 'auto',
      ttsEngine: 'auto',
      lang: 'zh-CN',
      silenceMs: 900,
      bargeIn: true,
      ttsRate: 1,
      idleTimeoutMs: 180_000,
    },
    persona: {
      enabled: false,
      id: DEFAULT_PERSONA_ID,
      custom: { name: '', prompt: '', greeting: '' },
    },
    memory: {
      enabled: true,
      historyTurns: 20,
    },
    ui: {
      language: 'zh',
      theme: 'dark',
    },
  };
}

/** 深度合并，保证旧版本配置缺字段时也能用 */
function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    if (
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = merge(current, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

const THEMES: ThemePref[] = ['dark', 'light', 'system'];
const LANGS: Lang[] = ['zh', 'en'];
const ENGINES: EnginePref[] = ['auto', 'cloud', 'browser'];

/**
 * 把配置里每个字段修回合法值。
 *
 * 为什么需要这一步：配置存在 localStorage 里，用户能直接改，插件、同步、手抖
 * 都可能写进去一个非法值。而 ui.theme 一旦不是 'dark'/'light'/'system'，
 * data-theme 就匹配不上任何一组设计变量，**整个界面会变成没有样式的白板**。
 * 这种崩溃不该由用户承担，所以进内存之前统一过一遍。
 */
function sanitize(config: AppConfig): AppConfig {  const base = defaultConfig();
  const provider = config.provider ?? base.provider;
  const voice = config.voice ?? base.voice;
  const persona = config.persona ?? base.persona;
  const memory = config.memory ?? base.memory;
  const ui = config.ui ?? base.ui;

  return {
    version: CONFIG_VERSION,
    provider: {
      presetId: text(provider.presetId, base.provider.presetId),
      baseUrl: text(provider.baseUrl, base.provider.baseUrl),
      apiKey: text(provider.apiKey, ''),
      chatModel: text(provider.chatModel, base.provider.chatModel),
      sttModel: text(provider.sttModel, ''),
      ttsModel: text(provider.ttsModel, ''),
      ttsVoice: text(provider.ttsVoice, ''),
    },
    voice: {
      enabled: bool(voice.enabled, base.voice.enabled),
      sttEngine: pick(voice.sttEngine, ENGINES, base.voice.sttEngine),
      ttsEngine: pick(voice.ttsEngine, ENGINES, base.voice.ttsEngine),
      lang: text(voice.lang, base.voice.lang),
      silenceMs: clamp(voice.silenceMs, 400, 2500, base.voice.silenceMs),
      bargeIn: bool(voice.bargeIn, base.voice.bargeIn),
      ttsRate: clamp(voice.ttsRate, 0.6, 1.8, base.voice.ttsRate),
      // 0 是合法值（表示不自动退出），所以下限是 0 而不是某个正数
      idleTimeoutMs: clamp(voice.idleTimeoutMs, 0, 3_600_000, base.voice.idleTimeoutMs),
    },
    persona: {
      enabled: bool(persona.enabled, base.persona.enabled),
      id: text(persona.id, base.persona.id),
      custom: {
        name: text(persona.custom?.name, ''),
        prompt: text(persona.custom?.prompt, ''),
        greeting: text(persona.custom?.greeting, ''),
      },
    },
    memory: {
      enabled: bool(memory.enabled, base.memory.enabled),
      historyTurns: clamp(memory.historyTurns, 2, 60, base.memory.historyTurns),
    },
    ui: {
      language: pick(ui.language, LANGS, base.ui.language),
      theme: pick(ui.theme, THEMES, base.ui.theme),
    },
  };
}

/** 对外暴露一份：改完配置要立刻过一遍，别等下次读盘才发现写进去一个非法值 */
export function normalizeConfig(config: AppConfig): AppConfig {
  return sanitize(config);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadConfig(): AppConfig {
  const base = defaultConfig();
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return sanitize(merge(base, parsed));
  } catch {
    // 配置坏了不该让整个应用打不开，退回默认值
    return base;
  }
}

export function saveConfig(config: AppConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 隐私模式下 localStorage 可能写不进去，静默忽略
  }
}

export function isConfigured(config: AppConfig): boolean {
  return Boolean(config.provider.baseUrl && config.provider.chatModel);
}

/** 给界面用的脱敏显示 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** 导出配置时抹掉 key，避免用户随手分享出去泄露 */
export function exportConfig(config: AppConfig): string {
  const copy: AppConfig = JSON.parse(JSON.stringify(config));
  copy.provider.apiKey = '';
  return JSON.stringify(copy, null, 2);
}
