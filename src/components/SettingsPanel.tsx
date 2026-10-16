'use client';

/**
 * 设置面板。五个标签页：模型 / 语音 / 人格 / 记忆 / 安全。
 *
 * 一个原则：**每个字段都能改**。预设只是省事，不是绑定 ——
 * 各家的模型名和地址变得比文档快，锁死字段等于逼用户等我们更新。
 */

import { useState } from 'react';

import { streamChat } from '@/lib/chat';
import { exportConfig, maskKey, type Lang, type ThemePref } from '@/lib/config';
import { PERSONAS, findPersona } from '@/lib/personas';
import { PROVIDERS, findPreset, regionLabel } from '@/lib/providers';
import { CAPABILITIES, type GrantState } from '@/lib/tools/policy';
import { tierDescription } from '@/lib/voice/router';
import { useVox, useTranslator, type TabId } from '@/lib/store';
import type { MessageKey } from '@/i18n';
import { Chip, Field, Note, Section, Toggle } from '@/components/ui';

const TABS: { id: TabId; key: MessageKey }[] = [
  { id: 'provider', key: 'tab.provider' },
  { id: 'voice', key: 'tab.voice' },
  { id: 'persona', key: 'tab.persona' },
  { id: 'memory', key: 'tab.memory' },
  { id: 'safety', key: 'tab.safety' },
  { id: 'appearance', key: 'tab.appearance' },
];

export function SettingsPanel() {
  const open = useVox((state) => state.panelOpen);
  const activeTab = useVox((state) => state.activeTab);
  const setTab = useVox((state) => state.setActiveTab);
  const setOpen = useVox((state) => state.setPanelOpen);
  const t = useTranslator();

  if (!open) return null;

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="panel-title">{t('app.name')}</span>
        <button type="button" className="btn btn-icon" onClick={() => setOpen(false)} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tab"
            data-active={activeTab === tab.id}
            onClick={() => setTab(tab.id)}
          >
            {t(tab.key)}
          </button>
        ))}
      </nav>

      <div className="panel-body">
        {activeTab === 'provider' ? <ProviderTab /> : null}
        {activeTab === 'voice' ? <VoiceTab /> : null}
        {activeTab === 'persona' ? <PersonaTab /> : null}
        {activeTab === 'memory' ? <MemoryTab /> : null}
        {activeTab === 'safety' ? <SafetyTab /> : null}
        {activeTab === 'appearance' ? <AppearanceTab /> : null}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* 模型 */
/* -------------------------------------------------------------------------- */

function ProviderTab() {
  const config = useVox((state) => state.config);
  const patch = useVox((state) => state.patchConfig);
  const t = useTranslator();

  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'models' | 'test' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const preset = findPreset(config.provider.presetId);
  const lang = config.ui.language;

  const applyPreset = (id: string) => {
    const next = findPreset(id);
    if (!next) return;
    setModels([]);
    setMessage(null);
    patch({
      provider: {
        presetId: next.id,
        baseUrl: next.baseUrl || config.provider.baseUrl,
        chatModel: next.chatModel || config.provider.chatModel,
        sttModel: next.sttModel ?? '',
        ttsModel: next.ttsModel ?? '',
        ttsVoice: next.ttsVoice ?? '',
      },
    });
  };

  const fetchModels = async () => {
    setBusy('models');
    setMessage(null);
    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: config.provider.baseUrl,
          apiKey: config.provider.apiKey,
        }),
      });
      const data = (await response.json()) as { models?: string[]; error?: string };
      if (!response.ok || data.error) {
        setMessage({ tone: 'bad', text: t('provider.fetchFail', { error: data.error ?? response.status }) });
      } else {
        setModels(data.models ?? []);
        setMessage({ tone: 'ok', text: t('provider.fetchOk', { count: data.models?.length ?? 0 }) });
      }
    } catch (error) {
      setMessage({ tone: 'bad', text: t('provider.fetchFail', { error: String(error) }) });
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    setBusy('test');
    setMessage(null);
    try {
      const result = await streamChat({
        config,
        messages: [{ role: 'user', content: lang === 'en' ? 'Reply with: ok' : '回复两个字：正常' }],
        signal: AbortSignal.timeout(30_000),
      });
      setMessage({ tone: 'ok', text: t('provider.testOk', { reply: result.text.trim().slice(0, 30) }) });
    } catch (error) {
      setMessage({ tone: 'bad', text: t('provider.testFail', { error: String(error) }) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section title={t('provider.title')} sub={t('provider.subtitle')}>
        <Field label={t('provider.preset')}>
          <select
            className="select"
            value={config.provider.presetId}
            onChange={(event) => applyPreset(event.target.value)}
          >
            {PROVIDERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name[lang]} · {regionLabel(item.region, lang)}
              </option>
            ))}
          </select>
        </Field>

        {preset?.note ? <Note>{preset.note[lang]}</Note> : null}

        {preset?.console ? (
          <a className="btn" href={preset.console} target="_blank" rel="noreferrer">
            {t('provider.console')}
          </a>
        ) : null}
      </Section>

      <Section>
        <Field label={t('provider.baseUrl')} hint={t('provider.baseUrlHint')}>
          <input
            className="input input-mono"
            value={config.provider.baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) =>
              patch({ provider: { ...config.provider, baseUrl: event.target.value } })
            }
          />
        </Field>

        <Field
          label={t('provider.apiKey')}
          hint={`${t('provider.apiKeyHint')}${config.provider.apiKey ? `　当前：${maskKey(config.provider.apiKey)}` : ''}`}
        >
          <input
            className="input input-mono"
            type="password"
            value={config.provider.apiKey}
            placeholder="sk-..."
            onChange={(event) =>
              patch({ provider: { ...config.provider, apiKey: event.target.value } })
            }
          />
        </Field>

        <Field label={t('provider.model')}>
          <div className="row">
            <input
              className="input input-mono"
              list="frame-models"
              value={config.provider.chatModel}
              onChange={(event) =>
                patch({ provider: { ...config.provider, chatModel: event.target.value } })
              }
            />
            <datalist id="frame-models">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </div>
        </Field>

        <div className="row">
          <button type="button" className="btn" onClick={fetchModels} disabled={busy !== null}>
            {busy === 'models' ? t('provider.fetching') : t('provider.fetchModels')}
          </button>
          <button type="button" className="btn" onClick={testConnection} disabled={busy !== null}>
            {busy === 'test' ? t('provider.testing') : t('provider.test')}
          </button>
        </div>

        {message ? (
          <Note tone={message.tone === 'bad' ? 'warn' : 'accent'}>{message.text}</Note>
        ) : null}
      </Section>

      <Section title={t('provider.advanced')}>
        <Field label={t('provider.sttModel')} optional={t('provider.optional')}>
          <input
            className="input input-mono"
            value={config.provider.sttModel}
            onChange={(event) =>
              patch({ provider: { ...config.provider, sttModel: event.target.value } })
            }
          />
        </Field>
        <Field label={t('provider.ttsModel')} optional={t('provider.optional')}>
          <input
            className="input input-mono"
            value={config.provider.ttsModel}
            onChange={(event) =>
              patch({ provider: { ...config.provider, ttsModel: event.target.value } })
            }
          />
        </Field>
        <Field label={t('provider.ttsVoice')} optional={t('provider.optional')}>
          <input
            className="input input-mono"
            value={config.provider.ttsVoice}
            onChange={(event) =>
              patch({ provider: { ...config.provider, ttsVoice: event.target.value } })
            }
          />
        </Field>
        <Note>
          语音识别和合成的云端适配器还没接上，现在一律走浏览器内置那一档。
          这两项先填着，接上之后直接生效。
        </Note>
      </Section>

      <Section title="配置导出">
        <Note>导出时会自动抹掉 API key，可以放心贴给别人排查问题。</Note>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(exportConfig(config));
            }}
          >
            {t('common.export')}
          </button>
        </div>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 语音 */
/* -------------------------------------------------------------------------- */

function VoiceTab() {
  const config = useVox((state) => state.config);
  const tier = useVox((state) => state.tier);
  const caps = useVox((state) => state.caps);
  const patch = useVox((state) => state.patchConfig);
  const t = useTranslator();
  const lang = config.ui.language;

  return (
    <>
      <Section title={t('voice.title')}>
        <Toggle
          name={t('voice.enabled')}
          on={config.voice.enabled}
          onChange={(value) => patch({ voice: { ...config.voice, enabled: value } })}
        />
        <div className="row">
          <span className="chip" data-tone="accent">
            {t('voice.tier')}: {tier.tier}
          </span>
        </div>
        <Note>{tierDescription(tier, lang)}</Note>
        <Note>
          识别：{tier.stt === 'none' ? '无' : tier.stt}　·　合成：
          {tier.tts === 'none' ? '无' : tier.tts}
          <br />
          浏览器内置：识别 {caps.browserStt ? '支持' : '不支持'} · 合成{' '}
          {caps.browserTts ? '支持' : '不支持'}
        </Note>
      </Section>

      <Section>
        <div className="row">
          <Field label={t('voice.sttEngine')}>
            <select
              className="select"
              value={config.voice.sttEngine}
              onChange={(event) =>
                patch({
                  voice: { ...config.voice, sttEngine: event.target.value as typeof config.voice.sttEngine },
                })
              }
            >
              <option value="auto">{t('voice.engineAuto')}</option>
              <option value="cloud">{t('voice.engineCloud')}</option>
              <option value="browser">{t('voice.engineBrowser')}</option>
            </select>
          </Field>
          <Field label={t('voice.ttsEngine')}>
            <select
              className="select"
              value={config.voice.ttsEngine}
              onChange={(event) =>
                patch({
                  voice: { ...config.voice, ttsEngine: event.target.value as typeof config.voice.ttsEngine },
                })
              }
            >
              <option value="auto">{t('voice.engineAuto')}</option>
              <option value="cloud">{t('voice.engineCloud')}</option>
              <option value="browser">{t('voice.engineBrowser')}</option>
            </select>
          </Field>
        </div>

        <Field label={t('voice.lang')}>
          <select
            className="select"
            value={config.voice.lang}
            onChange={(event) => patch({ voice: { ...config.voice, lang: event.target.value } })}
          >
            <option value="zh-CN">中文（普通话）</option>
            <option value="zh-TW">中文（台灣）</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="ja-JP">日本語</option>
            <option value="ko-KR">한국어</option>
          </select>
        </Field>

        <Field label={`${t('voice.silence')}（${config.voice.silenceMs}ms）`} hint={t('voice.silenceUnit')}>
          <input
            className="input"
            type="range"
            min={400}
            max={2500}
            step={100}
            value={config.voice.silenceMs}
            onChange={(event) =>
              patch({ voice: { ...config.voice, silenceMs: Number(event.target.value) } })
            }
          />
        </Field>

        <Field label={`${t('voice.rate')}（${config.voice.ttsRate.toFixed(2)}）`}>
          <input
            className="input"
            type="range"
            min={0.6}
            max={1.8}
            step={0.05}
            value={config.voice.ttsRate}
            onChange={(event) =>
              patch({ voice: { ...config.voice, ttsRate: Number(event.target.value) } })
            }
          />
        </Field>

        <Toggle
          name={t('voice.bargeIn')}
          desc={t('voice.bargeInHint')}
          on={config.voice.bargeIn}
          onChange={(value) => patch({ voice: { ...config.voice, bargeIn: value } })}
        />

        <Field label={t('voice.idle')} hint={t('voice.idleHint')}>
          <select
            className="select"
            value={String(config.voice.idleTimeoutMs)}
            onChange={(event) =>
              patch({ voice: { ...config.voice, idleTimeoutMs: Number(event.target.value) } })
            }
          >
            <option value="0">{t('voice.idleOff')}</option>
            {[60_000, 180_000, 300_000, 600_000].map((ms) => (
              <option key={ms} value={String(ms)}>
                {t('voice.idleMinutes', { n: ms / 60_000 })}
              </option>
            ))}
          </select>
        </Field>

        <Note tone="warn">{t('voice.headphoneHint')}</Note>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 人格 */
/* -------------------------------------------------------------------------- */

function PersonaTab() {
  const config = useVox((state) => state.config);
  const patch = useVox((state) => state.patchConfig);
  const t = useTranslator();
  const lang = config.ui.language;

  const custom = config.persona.custom;
  const isCustom = config.persona.id === 'custom';

  return (
    <>
      <Section title={t('persona.title')}>
        <Toggle
          name={t('persona.enabled')}
          desc={t('persona.enabledHint')}
          on={config.persona.enabled}
          onChange={(value) => patch({ persona: { ...config.persona, enabled: value } })}
        />
      </Section>

      <Section title={t('persona.pick')}>
        <div className="grid-2">
          {PERSONAS.map((persona) => (
            <button
              key={persona.id}
              type="button"
              className="persona-card"
              data-active={config.persona.id === persona.id}
              onClick={() => patch({ persona: { ...config.persona, id: persona.id } })}
            >
              <span className="persona-name">{persona.name[lang]}</span>
              <span className="persona-tag">{persona.tagline[lang]}</span>
              {persona.voiceHint ? (
                <span className="persona-tag">
                  {t('persona.voiceHint', { voice: persona.voiceHint })}
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className="persona-card"
            data-active={isCustom}
            onClick={() => patch({ persona: { ...config.persona, id: 'custom' } })}
          >
            <span className="persona-name">{t('persona.custom')}</span>
            <span className="persona-tag">
              {custom.name || (lang === 'en' ? 'unnamed' : '还没起名')}
            </span>
          </button>
        </div>
      </Section>

      {isCustom ? (
        <Section title={t('persona.custom')}>
          <Field label={t('persona.customName')}>
            <input
              className="input"
              value={custom.name}
              onChange={(event) =>
                patch({ persona: { ...config.persona, custom: { ...custom, name: event.target.value } } })
              }
            />
          </Field>
          <Field label={t('persona.customPrompt')} hint={t('persona.customPromptHint')}>
            <textarea
              className="input"
              rows={6}
              value={custom.prompt}
              onChange={(event) =>
                patch({ persona: { ...config.persona, custom: { ...custom, prompt: event.target.value } } })
              }
            />
          </Field>
          <Field label={t('persona.greeting')}>
            <input
              className="input"
              value={custom.greeting}
              onChange={(event) =>
                patch({ persona: { ...config.persona, custom: { ...custom, greeting: event.target.value } } })
              }
            />
          </Field>
        </Section>
      ) : (
        <Section>
          <Note>
            {findPersona(config.persona.id)?.prompt || '这个人格没有额外提示词，走通用助手。'}
          </Note>
        </Section>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 记忆 */
/* -------------------------------------------------------------------------- */

function MemoryTab() {
  const memory = useVox((state) => state.memory);
  const config = useVox((state) => state.config);
  const patch = useVox((state) => state.patchConfig);
  const addFact = useVox((state) => state.addMemoryFact);
  const deleteFact = useVox((state) => state.deleteMemoryFact);
  const deleteSummary = useVox((state) => state.deleteMemorySummary);
  const wipe = useVox((state) => state.wipeMemory);
  const exportJson = useVox((state) => state.exportMemoryJson);
  const summarizeNow = useVox((state) => state.summarizeNow);
  const t = useTranslator();
  const lang = config.ui.language;

  const [draft, setDraft] = useState('');

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    addFact(text);
    setDraft('');
  };

  const clearAll = () => {
    if (window.confirm(t('memory.clearConfirm'))) wipe();
  };

  return (
    <>
      <Section title={t('memory.title')}>
        <Toggle
          name={t('memory.enabled')}
          desc={t('memory.enabledHint')}
          on={config.memory.enabled}
          onChange={(value) => patch({ memory: { ...config.memory, enabled: value } })}
        />
        <div className="row">
          <Chip>
            {t('memory.count', {
              facts: memory.facts.length,
              summaries: memory.summaries.length,
            })}
          </Chip>
        </div>
        <Note>记忆存在你自己的浏览器里。下面每一条你都能看、能删、能导出。</Note>
      </Section>

      <Section title={t('memory.facts')}>
        <div className="row">
          <input
            className="input"
            value={draft}
            placeholder={t('memory.addPlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <button type="button" className="btn btn-primary" onClick={add}>
            {t('memory.add')}
          </button>
        </div>

        {memory.facts.length === 0 ? (
          <div className="field-hint">{t('memory.empty')}</div>
        ) : (
          <div className="list">
            {memory.facts.map((fact) => (
              <div key={fact.id} className="list-item">
                <span className="grow">{fact.text}</span>
                <span className="when">
                  {fact.source === 'auto' ? t('memory.auto') : t('memory.manual')}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => deleteFact(fact.id)}
                  aria-label={t('common.delete')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('memory.summaries')}>
        <div className="row">
          <button type="button" className="btn" onClick={() => void summarizeNow()}>
            现在就总结一次
          </button>
        </div>
        {memory.summaries.length === 0 ? (
          <div className="field-hint">还没有摘要。</div>
        ) : (
          <div className="list">
            {memory.summaries.map((summary) => (
              <div key={summary.id} className="list-item">
                <span className="grow">{summary.text}</span>
                <span className="when">
                  {new Date(summary.createdAt).toLocaleDateString(
                    lang === 'en' ? 'en-US' : 'zh-CN',
                  )}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => deleteSummary(summary.id)}
                  aria-label={t('common.delete')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => void navigator.clipboard.writeText(exportJson())}
          >
            {t('common.export')}
          </button>
          <button type="button" className="btn btn-danger" onClick={clearAll}>
            {t('memory.clearAll')}
          </button>
        </div>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 界面 */
/* -------------------------------------------------------------------------- */

function AppearanceTab() {
  const config = useVox((state) => state.config);
  const patch = useVox((state) => state.patchConfig);
  const t = useTranslator();

  return (
    <Section title={t('ui.title')} sub={t('ui.subtitle')}>
      <Field label={t('ui.language')} hint={t('ui.languageHint')}>
        <select
          className="select"
          value={config.ui.language}
          onChange={(event) =>
            patch({ ui: { ...config.ui, language: event.target.value as Lang } })
          }
        >
          <option value="zh">{t('lang.zh')}</option>
          <option value="en">{t('lang.en')}</option>
        </select>
      </Field>

      <Field label={t('ui.theme')} hint={t('ui.themeHint')}>
        <select
          className="select"
          value={config.ui.theme}
          onChange={(event) =>
            patch({ ui: { ...config.ui, theme: event.target.value as ThemePref } })
          }
        >
          <option value="dark">{t('theme.dark')}</option>
          <option value="light">{t('theme.light')}</option>
          <option value="system">{t('theme.system')}</option>
        </select>
      </Field>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* 安全 */
/* -------------------------------------------------------------------------- */

function SafetyTab() {
  const grants = useVox((state) => state.grants);
  const setGrant = useVox((state) => state.setGrant);
  const resetGrants = useVox((state) => state.resetGrants);
  const audit = useVox((state) => state.audit);
  const t = useTranslator();

  const grouped = [0, 1, 2, 3, 4].map((level) => ({
    level,
    items: CAPABILITIES.filter((capability) => capability.level === level),
  }));

  const label = (level: number) => t(`safety.level${level}` as MessageKey);

  return (
    <>
      <Section title={t('safety.title')} sub={t('safety.subtitle')}>
        <Note tone="accent">
          {t('safety.redline')}
          <br />
          {t('safety.redlineHint')}
        </Note>
      </Section>

      {grouped.map((group) => (
        <Section key={group.level} title={label(group.level)}>
          <div className="list">
            {group.items.map((capability) => {
              // 没单独设过的时候，显示的是「实际会怎么走」，不是一律 ask ——
              // 否则 L0/L1 明明是默认放行的，界面上却写着「每次问我」，前后对不上
              const state: GrantState =
                grants[capability.id] ?? (capability.defaultAllow ? 'granted' : 'ask');
              return (
                <div key={capability.id} className="list-item">
                  <span className="grow">
                    {capability.label}
                    <br />
                    <code style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      {capability.id}
                    </code>
                  </span>
                  <select
                    className="select"
                    style={{ width: 'auto' }}
                    value={state}
                    onChange={(event) =>
                      setGrant(capability.id, event.target.value as GrantState)
                    }
                  >
                    <option value="ask">{t('safety.ask')}</option>
                    <option value="granted">{t('safety.granted')}</option>
                    <option value="denied">{t('safety.denied')}</option>
                  </select>
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      <Section>
        <button type="button" className="btn" onClick={resetGrants}>
          {t('safety.resetGrants')}
        </button>
      </Section>

      <Section title={t('safety.audit')}>
        {audit.length === 0 ? (
          <div className="field-hint">{t('safety.auditEmpty')}</div>
        ) : (
          <div className="list">
            {audit.slice(0, 40).map((entry) => (
              <div key={entry.id} className="list-item">
                <span className="grow">
                  <code>{entry.name}</code> — {entry.detail}
                </span>
                <span className="when" data-status={entry.status}>
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
