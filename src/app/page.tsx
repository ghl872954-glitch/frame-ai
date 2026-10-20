'use client';

/**
 * 主界面。两种模式：
 *
 *   极简（默认）：一个圆 + 当前这句 + 输入框。像打电话。
 *   展开：完整对话历史 + 设置面板。
 *
 * 默认极简是刻意的 —— 陪伴感来自「界面安静」，不是来自信息密度。
 * 但记忆、人格、key 这些又必须能管，所以给了展开。
 */

import { useEffect, useRef, useState } from 'react';

import { Composer } from '@/components/Composer';
import { FullWatchConsent } from '@/components/FullWatchConsent';
import { ScreenPicker } from '@/components/ScreenPicker';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ToolConfirmDialog } from '@/components/ToolConfirmDialog';
import { Transcript } from '@/components/Transcript';
import { VoiceOrb } from '@/components/VoiceOrb';
import { useVox, useTranslator } from '@/lib/store';
import type { ThemePref } from '@/lib/config';

export default function Home() {
  const hydrated = useVox((state) => state.hydrated);
  const hydrate = useVox((state) => state.hydrate);
  const session = useVox((state) => state.session);
  const tier = useVox((state) => state.tier);
  const error = useVox((state) => state.error);
  const clearError = useVox((state) => state.clearError);
  const idleWarning = useVox((state) => state.idleWarning);
  const partial = useVox((state) => state.partial);
  const watching = useVox((state) => state.watching);
  const screenRegion = useVox((state) => state.screenRegion);
  const picking = useVox((state) => state.picking);
  const openPicker = useVox((state) => state.openPicker);
  const requestFullWatch = useVox((state) => state.requestFullWatch);
  const stopWatching = useVox((state) => state.stopWatching);
  const panelOpen = useVox((state) => state.panelOpen);
  const setPanelOpen = useVox((state) => state.setPanelOpen);
  const config = useVox((state) => state.config);
  const messages = useVox((state) => state.messages);
  const t = useTranslator();

  const [expanded, setExpanded] = useState(false);
  const floatChannel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // 悬浮窗订阅「当前这句」和状态。同一个源的两个窗口，BroadcastChannel 直接通
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    floatChannel.current = new BroadcastChannel('frame-float');
    return () => {
      floatChannel.current?.close();
      floatChannel.current = null;
    };
  }, []);

  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    floatChannel.current?.postMessage({
      text: last?.text ?? '',
      session,
      lang: config.ui.language,
    });
  }, [messages, session, config.ui.language]);

  // 主题跟着配置走
  useEffect(() => {
    if (!hydrated) return;
    applyTheme(config.ui.theme);
  }, [hydrated, config.ui.theme]);

  useEffect(() => {
    if (hydrated && !panelOpen && !config.provider.baseUrl) setPanelOpen(true);
  }, [hydrated, panelOpen, config.provider.baseUrl, setPanelOpen]);

  if (!hydrated) {
    return (
      <main className="shell">
        <div className="stage">
          <div className="empty-hint">{t('common.loading')}</div>
        </div>
      </main>
    );
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  // 正在识别时显示识别中的文字，说完之后显示落定的那句
  const userLine = partial || lastUser?.text || '';

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{t('app.name')}</span>
          <span className="brand-tag">{t('app.tagline')}</span>
        </div>

        <span className="status-chip">
          <span className="dot" data-state={session} />
          {config.voice.enabled ? tier.tier : 'text'}
        </span>

        {watching ? (
          <button
            type="button"
            className="btn btn-screen"
            data-on
            onClick={stopWatching}
            title={t('screen.stopHint')}
          >
            <span className="btn-screen-dot" aria-hidden="true" />
            {screenRegion ? t('screen.watching') : t('screen.watchingAll')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-screen"
              onClick={openPicker}
              title={t('screen.dragHint')}
            >
              <span className="btn-screen-dot" aria-hidden="true" />
              {t('screen.open')}
            </button>
            <button
              type="button"
              className="btn btn-screen"
              onClick={requestFullWatch}
              title={t('screen.watchAllHint')}
            >
              <span className="btn-screen-dot" aria-hidden="true" />
              {t('screen.watchAll')}
            </button>
          </>
        )}

        <button
          type="button"
          className="btn"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? t('expand.close') : t('expand.open')}
        </button>

        <button
          type="button"
          className="btn btn-icon"
          onClick={() => setPanelOpen(true)}
          aria-label={t('app.name')}
        >
          <GearIcon />
        </button>
      </header>

      <section className="stage">
        <VoiceOrb />

        {error ? (
          <div className="error-bar">
            <span className="grow">{error}</span>
            <button type="button" className="icon-btn" onClick={clearError} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
        ) : null}

        {expanded ? (
          <Transcript />
        ) : (
          <div className="transcript transcript-solo">
            {/* 你说的话也要显示。不显示的话，识别错了用户根本没法发现 */}
            {userLine ? (
              <div className="turn" data-role="user" data-live={partial ? 'true' : undefined}>
                <span className="turn-who">
                  {t('transcript.you')}
                  {partial ? <span className="turn-live">{t('transcript.listening')}</span> : null}
                </span>
                <div className="turn-body">
                  {userLine}
                  {partial ? <span className="caret" /> : null}
                </div>
              </div>
            ) : null}

            {lastAssistant ? (
              <div className="turn" data-role="assistant">
                <span className="turn-who">{t('transcript.assistant')}</span>
                <div className="turn-body">
                  {lastAssistant.text}
                  {lastAssistant.pending ? <span className="caret" /> : null}
                </div>
              </div>
            ) : !userLine ? (
              <div className="empty-hint">{t('transcript.empty')}</div>
            ) : null}
          </div>
        )}
      </section>

      <footer className="dock">
        <Composer />
        <div className="hint-line" data-warn={idleWarning}>
          {idleWarning
            ? t('orb.idleWarningHint')
            : config.voice.enabled && config.voice.bargeIn
              ? t('orb.hintBargeIn')
              : t('composer.hint')}
        </div>
      </footer>

      <SettingsPanel />
      <ToolConfirmDialog />
      <FullWatchConsent />
      {picking ? <ScreenPicker /> : null}
    </main>
  );
}

function applyTheme(theme: ThemePref): void {
  if (typeof document === 'undefined') return;
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  // 兜底成 dark：data-theme 只要不是这两者之一，整套设计变量就全部失效，
  // 界面会变成一张没有样式的白板。宁可回深色，也不能变白板。
  document.documentElement.dataset.theme = resolved === 'light' ? 'light' : 'dark';
}

/** 用 SVG 而不是 ⚙ 字符 —— 字符在不同系统上字重和大小差很多，摆不齐 */
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.2" />
    </svg>
  );
}
