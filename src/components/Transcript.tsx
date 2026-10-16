'use client';

/** 字幕。极简模式下也能展开看历史，所以这个组件两个模式共用。 */

import { useEffect, useRef } from 'react';

import { useVox, useTranslator } from '@/lib/store';

export function Transcript() {
  const messages = useVox((state) => state.messages);
  const partial = useVox((state) => state.partial);
  const t = useTranslator();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, partial]);

  return (
    <div className="transcript">
      {messages.length === 0 ? (
        <div className="empty-hint">{t('transcript.empty')}</div>
      ) : (
        messages.map((message) => (
          <div key={message.id} className="turn" data-role={message.role}>
            <span className="turn-who">
              {message.role === 'user' ? t('transcript.you') : t('transcript.assistant')}
            </span>
            <div className="turn-body">
              {message.text}
              {message.pending ? <span className="caret" /> : null}
            </div>
            {message.tools && message.tools.length > 0 ? (
              <div className="tool-list">
                {message.tools.map((tool) => (
                  <div key={tool.id} className="tool-row">
                    <span>{t('transcript.toolCall')}</span>
                    <code>{tool.name}</code>
                    <span className="tool-status" data-status={tool.status}>
                      {tool.detail}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))
      )}

      {/* 识别中的那句话。必须显示出来 —— 识别错了用户得当场能发现 */}
      {partial ? (
        <div className="turn" data-role="user" data-live="true">
          <span className="turn-who">
            {t('transcript.you')}
            <span className="turn-live">{t('transcript.listening')}</span>
          </span>
          <div className="turn-body">
            {partial}
            <span className="caret" />
          </div>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
