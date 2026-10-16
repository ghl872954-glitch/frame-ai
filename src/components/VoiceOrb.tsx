'use client';

/**
 * 中间那个圆。
 *
 * 状态全靠它传达：呼吸（待命）、扩散圈（在听）、转圈（在想）、波形（在说）。
 * 用户不用看任何文字就知道现在该不该说话。
 */

import { useVox, useTranslator } from '@/lib/store';

export function VoiceOrb() {
  const session = useVox((state) => state.session);
  const voiceEnabled = useVox((state) => state.config.voice.enabled);
  const idleWarning = useVox((state) => state.idleWarning);
  const startVoice = useVox((state) => state.startVoice);
  const stopVoice = useVox((state) => state.stopVoice);
  const interrupt = useVox((state) => state.interrupt);
  const t = useTranslator();

  const active = session !== 'idle' && session !== 'error';
  // 快到空闲上限时先把话说明白，免得用户回来发现它自己关了还不知道为什么
  const label = idleWarning
    ? t('orb.idleWarning')
    : !voiceEnabled
      ? t('orb.idle')
      : session === 'listening'
        ? t('orb.listening')
        : session === 'thinking'
          ? t('orb.thinking')
          : session === 'speaking'
            ? t('orb.speaking')
            : session === 'error'
              ? t('orb.error')
              : t('orb.idle');

  const handleClick = () => {
    if (active) void stopVoice();
    else void startVoice();
  };

  return (
    <div className="orb-wrap">
      {session === 'listening' ? (
        <>
          <span className="ring ring-1 ring-pulse" />
          <span className="ring ring-2 ring-pulse delay" />
        </>
      ) : null}
      {session === 'thinking' ? <span className="ring ring-spin" /> : null}

      <button
        type="button"
        className="orb"
        data-state={session}
        data-warn={idleWarning}
        onClick={handleClick}
        aria-label={active ? t('orb.stop') : label}
      >
        {session === 'speaking' ? (
          <span className="bars">
            {[0, 1, 2, 3, 4].map((index) => (
              <span
                key={index}
                className="bar"
                style={{ animationDelay: `${index * 0.11}s` }}
              />
            ))}
          </span>
        ) : (
          <span className="orb-label">{label}</span>
        )}
      </button>

      {session === 'speaking' ? (
        <button type="button" className="btn" onClick={interrupt}>
          {t('orb.interrupt')}
        </button>
      ) : null}
    </div>
  );
}
