'use client';

/**
 * 工具确认弹窗。
 *
 * 这是执行链路上最后一道人工闸门，所以信息给足：要做什么、完整内容是什么、属于哪一级。
 * 看不到全貌就不该点确认。
 *
 * 命中红线的动作**不会**走到这里 —— 它们在策略层就被拒了，连问都不问。
 */

import { useVox, useTranslator } from '@/lib/store';

export function ToolConfirmDialog() {
  const pending = useVox((state) => state.pendingConfirm);
  const resolve = useVox((state) => state.resolveConfirm);
  const setGrant = useVox((state) => state.setGrant);
  const t = useTranslator();

  if (!pending) return null;

  const { request } = pending;

  const allowAlways = () => {
    setGrant(request.capabilityId, 'granted');
    resolve(true);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <div className="dialog-title">{t('tool.confirmTitle')}</div>
        <div className="row">
          <span className="chip" data-tone="warn">
            L{request.level} · {request.label}
          </span>
        </div>
        <div className="dialog-detail">{request.detail}</div>
        <div className="field-hint">{t('tool.confirmHint')}</div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-danger" onClick={() => resolve(false)}>
            {t('tool.reject')}
          </button>
          <button type="button" className="btn" onClick={() => resolve(true)}>
            {t('tool.approveOnce')}
          </button>
          <button type="button" className="btn btn-primary" onClick={allowAlways}>
            {t('tool.approveAlways')}
          </button>
        </div>
      </div>
    </div>
  );
}
