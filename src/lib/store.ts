'use client';

/**
 * 全局状态。
 *
 * 所有会碰浏览器 API 的东西都收在这里，UI 组件只读状态和调动作。
 * 这样组件很薄，逻辑也集中在一处好排查。
 */

import { create } from 'zustand';

import { runAgentTurn, type ToolConfirmRequest, type ToolRunRecord } from '@/lib/agent';
import { streamChat, type ChatMessage } from '@/lib/chat';
import {
  defaultConfig,
  loadConfig,
  normalizeConfig,
  saveConfig,
  type AppConfig,
  type ThemePref,
} from '@/lib/config';
import {
  addFact,
  addSummary,
  clearMemory,
  createId,
  emptyMemory,
  exportMemory,
  loadMemory,
  removeFact,
  removeSummary,
  saveMemory,
  type MemoryState,
} from '@/lib/memory';
import type { ScreenRegion } from '@/lib/screen/types';
import { shrinkImage } from '@/lib/screen/shrink';
import { BrowserStt, BrowserTts } from '@/lib/voice/browser';
import { CloudStt } from '@/lib/voice/cloud-stt';

import { CloudTts, FallbackTts } from '@/lib/voice/cloud';
import { decideTier, type TierDecision } from '@/lib/voice/router';
import { VoiceSession, type SessionState } from '@/lib/voice/session';
import {
  browserSttSupported,
  browserTtsSupported,
  type VoiceCapabilities,
} from '@/lib/voice/types';
import type { GrantState } from '@/lib/tools/policy';
import { createTranslator, translate, type Translator } from '@/i18n';

export type TabId = 'chat' | 'voice' | 'persona' | 'memory' | 'provider' | 'safety' | 'appearance';

export interface UiToolRecord extends ToolRunRecord {
  id: string;
  at: number;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: number;
  pending?: boolean;
  tools?: UiToolRecord[];
}

export interface AuditEntry {
  id: string;
  at: number;
  name: string;
  status: ToolRunRecord['status'];
  detail: string;
}

interface PendingConfirm {
  request: ToolConfirmRequest;
  resolve: (approved: boolean) => void;
}

interface VoxState {
  hydrated: boolean;
  config: AppConfig;
  memory: MemoryState;
  messages: UiMessage[];
  session: SessionState;
  tier: TierDecision;
  caps: VoiceCapabilities;
  partial: string;
  error: string | null;
  /** 快到空闲上限了，界面提示一下「还在吗」 */
  idleWarning: boolean;
  panelOpen: boolean;
  activeTab: TabId;
  grants: Record<string, GrantState>;
  audit: AuditEntry[];
  pendingConfirm: PendingConfirm | null;

  /** 正在框选屏幕 */
  picking: boolean;
  /** 框好的区域（屏幕真实像素），null 表示还没框 */
  screenRegion: ScreenRegion | null;
  /** 框内最新一帧，用来显示预览、也用来喂给模型 */
  screenFrame: string | null;
  /** 看屏幕总开关，默认关 —— 不开的时候一次都不截 */
  watching: boolean;

  hydrate: () => void;
  patchConfig: (patch: DeepPartial<AppConfig>) => void;
  patchMemory: (patch: Partial<MemoryState>) => void;
  setPanelOpen: (open: boolean) => void;
  setActiveTab: (tab: TabId) => void;
  setGrant: (capabilityId: string, state: GrantState) => void;
  resetGrants: () => void;
  clearMessages: () => void;
  clearError: () => void;

  send: (text: string) => Promise<void>;
  startVoice: () => Promise<void>;
  stopVoice: () => Promise<void>;
  interrupt: () => void;
  repeatLast: () => Promise<void>;

  addMemoryFact: (text: string) => void;
  deleteMemoryFact: (id: string) => void;
  deleteMemorySummary: (id: string) => void;
  wipeMemory: () => void;
  exportMemoryJson: () => string;
  summarizeNow: () => Promise<void>;

  resolveConfirm: (approved: boolean) => void;

  openPicker: () => void;
  closePicker: () => void;
  confirmRegion: (region: ScreenRegion) => void;
  stopWatching: () => void;
  /** 抓一帧当前框内画面，返回 data URL */
  grabFrame: () => Promise<string | null>;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const GRANTS_STORAGE_KEY = 'frame.grants.v1';
const AUDIT_LIMIT = 200;

let session: VoiceSession | null = null;
let abortController: AbortController | null = null;

export const useVox = create<VoxState>((set, get) => ({
  hydrated: false,
  config: defaultConfig(),
  memory: emptyMemory(),
  messages: [],
  session: 'idle',
  tier: { tier: 'text', stt: 'none', tts: 'none', reason: 'no-stt' },
  caps: {
    nativeRealtime: false,
    cloudStt: false,
    cloudTts: false,
    browserStt: false,
    browserTts: false,
  },
  partial: '',
  error: null,
  idleWarning: false,
  panelOpen: false,
  activeTab: 'provider',
  grants: {},
  audit: [],
  pendingConfirm: null,
  picking: false,
  screenRegion: null,
  screenFrame: null,
  // 默认关：不开的时候一次都不截屏，这不是配置项，是行为
  watching: false,

  /* ------------------------------------------------------------------ */

  hydrate: () => {
    const config = loadConfig();
    const memory = loadMemory();
    const grants = loadGrants();
    const caps: VoiceCapabilities = {
      // 原生实时协议还没接，先留着位置
      nativeRealtime: false,
      cloudStt: Boolean(config.provider.sttModel && config.provider.apiKey),
      cloudTts: Boolean(config.provider.ttsModel && config.provider.apiKey),
      browserStt: browserSttSupported(),
      browserTts: browserTtsSupported(),
    };
    const tier = decideTier(
      caps,
      { stt: config.voice.sttEngine, tts: config.voice.ttsEngine },
      config.voice.enabled,
    );

    set({ hydrated: true, config, memory, grants, caps, tier });
  },

  patchConfig: (patch) => {
    const next = normalizeConfig(deepMerge(get().config, patch));
    saveConfig(next);
    const caps: VoiceCapabilities = {
      ...get().caps,
      cloudStt: Boolean(next.provider.sttModel && next.provider.apiKey),
      cloudTts: Boolean(next.provider.ttsModel && next.provider.apiKey),
    };
    const tier = decideTier(
      caps,
      { stt: next.voice.sttEngine, tts: next.voice.ttsEngine },
      next.voice.enabled,
    );
    set({ config: next, caps, tier });
  },

  patchMemory: (patch) => {
    const next = { ...get().memory, ...patch };
    saveMemory(next);
    set({ memory: next });
  },

  setPanelOpen: (open) => set({ panelOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  clearMessages: () => set({ messages: [] }),
  clearError: () => set({ error: null }),

  setGrant: (capabilityId, state) => {
    const grants = { ...get().grants, [capabilityId]: state };
    saveGrants(grants);
    set({ grants });
  },

  resetGrants: () => {
    saveGrants({});
    set({ grants: {} });
  },

  /* ------------------------------------------------------------------ */

  send: async (text) => {
    const clean = text.trim();
    if (!clean) return;

    // 语音会话开着的时候打字，也算「用户有回应」，别让空闲计时把它关掉
    session?.poke();
    set({ idleWarning: false });

    const config = get().config;
    if (!config.provider.baseUrl || !config.provider.chatModel) {
      set({ error: translate(config.ui.language, 'error.noKey') });
      return;
    }

    const userMessage: UiMessage = {
      id: createId(),
      role: 'user',
      text: clean,
      at: Date.now(),
    };
    const assistantId = createId();
    const assistantMessage: UiMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      at: Date.now(),
      pending: true,
      tools: [],
    };

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      error: null,
      session: 'thinking',
      partial: '',
    }));

    abortController = new AbortController();
    const language = config.ui.language;
    const t = createTranslator(language);

    try {
      const result = await runAgentTurn({
        config,
        memory: get().memory,
        history: buildHistory(get().messages, config.memory.historyTurns, assistantId),
        userText: clean,
        // 看屏幕的时候现抓一帧，让模型看到的是「你说这句话时」的画面
        image: await get().grabFrame(),
        grants: get().grants,
        signal: abortController.signal,
        onChunk: (chunk) => {
          set((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? { ...message, text: message.text + chunk }
                : message,
            ),
          }));
        },
        onTool: (record) => {
          const entry: UiToolRecord = { ...record, id: createId(), at: Date.now() };
          set((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? { ...message, tools: [...(message.tools ?? []), entry] }
                : message,
            ),
            audit: pushAudit(state.audit, entry),
          }));
        },
        confirm: (request) => waitForConfirm(set, request),
      });

      set((state) => ({
        memory: result.memory,
        session: 'idle',
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? { ...message, text: result.text || message.text, pending: false }
            : message,
        ),
      }));
      saveMemory(result.memory);
    } catch (error) {
      if (isAbort(error)) {
        set((state) => ({
          session: 'idle',
          messages: state.messages.map((message) =>
            message.id === assistantId ? { ...message, pending: false } : message,
          ),
        }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        session: 'error',
        error: t('error.generic', { message }),
        messages: state.messages.map((item) =>
          item.id === assistantId
            ? { ...item, pending: false, text: item.text || `（出错：${message}）` }
            : item,
        ),
      }));
    } finally {
      abortController = null;
    }
  },

  /* ------------------------------------------------------------------ */

  startVoice: async () => {
    const { config, tier } = get();
    if (!config.voice.enabled) return;

    if (tier.stt === 'none') {
      set({ error: translate(config.ui.language, 'error.micUnsupported') });
      return;
    }

    if (tier.stt !== 'browser' && tier.stt !== 'cloud') {
      set({ error: translate(config.ui.language, 'error.mic') });
      return;
    }

    // 云端识别走录音 + 上传：准确率高，代价是说完要多等一两秒。
    // 浏览器内置那档是实时出字，但准确率有天花板。
    const stt =
      tier.stt === 'cloud'
        ? new CloudStt({
            baseUrl: config.provider.baseUrl,
            apiKey: config.provider.apiKey,
            model: config.provider.sttModel,
            language: config.voice.lang,
            silenceMs: config.voice.silenceMs,
          })
        : new BrowserStt({
            lang: config.voice.lang,
            silenceMs: config.voice.silenceMs,
          });

    // 云端合成失败就退回浏览器内置 —— 音质差总比突然没声好
    const tts =
      tier.tts === 'cloud'
        ? new FallbackTts(
            new CloudTts({
              baseUrl: config.provider.baseUrl,
              apiKey: config.provider.apiKey,
              model: config.provider.ttsModel,
              voice: config.provider.ttsVoice,
            }),
            new BrowserTts(),
          )
        : new BrowserTts();

    session = new VoiceSession({
      stt,
      tts,
      lang: config.voice.lang,
      ttsRate: config.voice.ttsRate,
      bargeIn: config.voice.bargeIn,
      idleTimeoutMs: config.voice.idleTimeoutMs,
      onState: (state) => set({ session: state, ...(state !== 'listening' ? { idleWarning: false } : {}) }),
      onIdleWarning: () => set({ idleWarning: true }),
      onIdleTimeout: () => set({ idleWarning: false }),
      // 识别中的文字实时进界面。识别错了用户得当场看得见
      onPartialText: (text) => set({ partial: text }),
      onUserText: (text) => {
        set((state) => ({
          messages: [
            ...state.messages,
            { id: createId(), role: 'user', text, at: Date.now() },
          ],
          partial: '',
          idleWarning: false,
        }));
      },
      onError: (error) => set({ error: error.message, idleWarning: false, partial: '' }),
      ask: async (text, onChunk, signal) => {
        const current = get();
        const assistantId = createId();
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: assistantId,
              role: 'assistant',
              text: '',
              at: Date.now(),
              pending: true,
              tools: [],
            },
          ],
        }));

        const result = await runAgentTurn({
          config: current.config,
          memory: current.memory,
          history: buildHistory(
            get().messages,
            current.config.memory.historyTurns,
            assistantId,
          ),
          userText: text,
          image: await get().grabFrame(),
          grants: current.grants,
          signal,
          onChunk: (chunk) => {
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === assistantId
                  ? { ...message, text: message.text + chunk }
                  : message,
              ),
            }));
            onChunk(chunk);
          },
          onTool: (record) => {
            const entry: UiToolRecord = { ...record, id: createId(), at: Date.now() };
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === assistantId
                  ? { ...message, tools: [...(message.tools ?? []), entry] }
                  : message,
              ),
              audit: pushAudit(state.audit, entry),
            }));
          },
          confirm: (request) => waitForConfirm(set, request),
        });

        set((state) => ({
          memory: result.memory,
          messages: state.messages.map((message) =>
            message.id === assistantId
              ? { ...message, text: result.text || message.text, pending: false }
              : message,
          ),
        }));
        saveMemory(result.memory);
        return result.text;
      },
    });

    await session.start();
  },

  stopVoice: async () => {
    if (session) {
      await session.stop();
      session = null;
    }
    set({ session: 'idle', partial: '', idleWarning: false });
  },

  interrupt: () => {
    session?.interrupt();
  },

  repeatLast: async () => {
    const { messages } = get();
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) await get().send(lastUser.text);
  },

  /* ------------------------------------------------------------------ */

  addMemoryFact: (text) => {
    const next = addFact(get().memory, text, 'manual');
    saveMemory(next);
    set({ memory: next });
  },

  deleteMemoryFact: (id) => {
    const next = removeFact(get().memory, id);
    saveMemory(next);
    set({ memory: next });
  },

  deleteMemorySummary: (id) => {
    const next = removeSummary(get().memory, id);
    saveMemory(next);
    set({ memory: next });
  },

  wipeMemory: () => {
    const next = clearMemory();
    saveMemory(next);
    set({ memory: next });
  },

  exportMemoryJson: () => exportMemory(get().memory),

  summarizeNow: async () => {
    const { config, messages, memory } = get();
    if (!config.provider.baseUrl || !config.provider.chatModel) return;

    const recent = buildHistory(messages, 6);
    if (recent.length < 2) return;

    const language = config.ui.language;
    const transcript = recent
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
      .join('\n');

    const prompt =
      language === 'en'
        ? `Summarize what matters in this conversation in one sentence, from the perspective of what should be remembered about the user. Reply with the sentence only.\n\n${transcript}`
        : `用一句话总结这段对话里值得记住的东西，站在「关于这个用户」的角度。只回这一句话。\n\n${transcript}`;

    try {
      const result = await streamChat({
        config,
        messages: [{ role: 'user', content: prompt }],
        signal: AbortSignal.timeout(60_000),
      });
      const text = result.text.trim();
      if (!text) return;
      const next = addSummary(memory, text, recent.length);
      saveMemory(next);
      set({ memory: next });
    } catch {
      // 摘要失败不该打扰用户
    }
  },

  resolveConfirm: (approved) => {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: null });
    pending.resolve(approved);
  },

  /* ---------------------------------------------------------------------- */
  /* 看屏幕                                                                  */
  /* ---------------------------------------------------------------------- */

  openPicker: () => set({ picking: true }),

  closePicker: () => set({ picking: false }),

  confirmRegion: (region) => {
    set({
      picking: false,
      screenRegion: region,
      watching: true,
      screenFrame: null,
    });
    // 确认之后立刻抓一帧，让你看见它到底看到了什么
    void get().grabFrame();
  },

  stopWatching: () => {
    // 区域一起清掉 —— 留着会让你以为它还在看
    set({ watching: false, screenRegion: null, screenFrame: null });
  },

  grabFrame: async () => {
    const { screenRegion, watching } = get();
    if (!watching || !screenRegion) return null;

    try {
      const response = await fetch('/api/screen/grab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: screenRegion }),
      });
      const data = (await response.json()) as { image?: string; error?: string };
      if (!response.ok || !data.image) {
        set({ error: data.error ?? translate(get().config.ui.language, 'screen.grabFailed') });
        return null;
      }

      // 原图太大，缩到模型吃得下的尺寸再往下走
      const shrunk = await shrinkImage(data.image);
      set({ screenFrame: shrunk });
      return shrunk;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
}));

/* -------------------------------------------------------------------------- */
/* 辅助 */
/* -------------------------------------------------------------------------- */

export function useTranslator(): Translator {
  const lang = useVox((state) => state.config.ui.language);
  return createTranslator(lang);
}

function waitForConfirm(
  set: (partial: Partial<VoxState>) => void,
  request: ToolConfirmRequest,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    set({ pendingConfirm: { request, resolve } });
  });
}

function pushAudit(list: AuditEntry[], record: UiToolRecord): AuditEntry[] {
  const entry: AuditEntry = {
    id: record.id,
    at: record.at,
    name: record.name,
    status: record.status,
    detail: record.detail,
  };
  return [entry, ...list].slice(0, AUDIT_LIMIT);
}

/** 界面消息转成模型能吃的历史，顺带按配置裁掉太早的部分 */
function buildHistory(
  messages: UiMessage[],
  maxTurns: number,
  excludeId?: string,
): ChatMessage[] {
  const usable = messages.filter(
    (m) => m.id !== excludeId && m.text.trim() && !m.pending,
  );
  const limited = usable.slice(-Math.max(2, maxTurns * 2));
  return limited.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'));
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...(base as Record<string, unknown>) };
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
      out[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

function loadGrants(): Record<string, GrantState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(GRANTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GrantState>) : {};
  } catch {
    return {};
  }
}

function saveGrants(grants: Record<string, GrantState>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GRANTS_STORAGE_KEY, JSON.stringify(grants));
  } catch {
    // 忽略
  }
}

export type { ThemePref };
