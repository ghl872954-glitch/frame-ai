'use client';

/**
 * 「看整个屏幕」的同意弹窗。
 *
 * 这是一个纯授权闸门：不点「允许」，一张都不会截。
 * 整屏观看会看到屏幕上的一切（包括正在编辑的内容），所以必须问清楚再开。
 */

import { useVox, useTranslator } from '@/lib/store';

export function FullWatchConsent() {
  const open = useVox((state) => state.watchFullPrompt);
  const allow = useVox((state) => state.confirmFullWatch);
  const cancel = useVox((state) => state.cancelFullWatch);
  const t = useTranslator();

  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <div className="dialog-title">{t('screen.consentTitle')}</div>
        <div className="dialog-detail">{t('screen.consentBody')}</div>
        <div className="field-hint">{t('screen.consentHint')}</div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-danger" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={allow}>
            {t('screen.consentAllow')}
          </button>
        </div>
      </div>
    </div>
  );
}
