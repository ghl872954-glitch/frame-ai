'use client';

/**
 * 悬浮小窗。
 *
 * 一个独立的小窗口，置顶、无边框、透明、不抢焦点。只干一件事：
 * 把主窗里「当前这句话」和状态显示出来。逻辑一点不重复 —— 主窗通过
 * BroadcastChannel 把内容广播过来，这里只是订阅。
 *
 * 平时缩成一条（状态点 + frame + 状态词），有内容时展开成卡片，12 秒没新内容再收起。
 */

import { useEffect, useRef, useState } from 'react';

type SessionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

const STATUS: Record<SessionState, { zh: string; en: string }> = {
  idle: { zh: '待命', en: 'Ready' },
  listening: { zh: '在听', en: 'Listening' },
  thinking: { zh: '在想', en: 'Thinking' },
  speaking: { zh: '在说', en: 'Speaking' },
  error: { zh: '出错', en: 'Error' },
};

const COLLAPSE_AFTER_MS = 12_000;

export default function FloatPage() {
  const [text, setText] = useState('');
  const [session, setSession] = useState<SessionState>('idle');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const rootRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('frame-float');
    channel.onmessage = (event) => {
      const data = (event.data ?? {}) as { text?: string; session?: string; lang?: string };
      if (typeof data.text === 'string') setText(data.text);
      if (typeof data.session === 'string') setSession(data.session as SessionState);
      if (data.lang === 'en' || data.lang === 'zh') setLang(data.lang);

      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
      collapseTimer.current = window.setTimeout(() => setText(''), COLLAPSE_AFTER_MS);
    };
    return () => {
      channel.close();
      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    };
  }, []);

  // 内容高度变了就报给主进程，窗口跟着收放
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height) + 12;
      window.frameDesktop?.resizeFloat?.(height);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, session]);

  const line = text.trim();
  const expanded = Boolean(line);
  const status = STATUS[session] ?? STATUS.idle;
  const statusText = lang === 'en' ? status.en : status.zh;

  return (
    <div className="float-root" data-expanded={expanded} ref={rootRef}>
      <div className="float-head">
        <span className="float-dot" data-state={session} aria-hidden="true" />
        <span className="float-name">frame</span>
        <span className="float-status">{statusText}</span>
      </div>
      {line ? <div className="float-body">{line}</div> : null}
    </div>
  );
}
