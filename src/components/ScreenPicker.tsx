'use client';

/**
 * 框选屏幕。
 *
 * 顺序和浏览器那套相反：先把全屏截下来铺满，你在图上拖框，拖完再问要不要让它看。
 * 浏览器的 getDisplayMedia 做不到这个顺序 —— 它必须先共享才有画面。
 *
 * 坐标分两套，别混：
 *   显示坐标（box）  相对整个覆盖层，直接拿来定位那个框
 *   图片坐标（提交时）相对截图原始像素，后端按这个裁剪
 * 换算放在提交那一步做，渲染期间不碰 ref —— 否则违反 React 的渲染规则。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useVox, useTranslator } from '@/lib/store';

interface Shot {
  image: string;
  width: number;
  height: number;
}

/** 相对覆盖层的坐标 */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ScreenPicker() {
  const closePicker = useVox((state) => state.closePicker);
  const confirmRegion = useVox((state) => state.confirmRegion);
  const t = useTranslator();

  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // 挂载即截屏。父组件只在 picking 为真时才渲染这个组件，
  // 所以每次打开都是全新实例，不需要在 effect 里手动清状态。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const desktop = typeof window !== 'undefined' ? window.frameDesktop : undefined;
      let hid = false;
      try {
        // 先把挡路的窗口藏起来，否则截到的全是 frame 自己
        hid = (await desktop?.hideForCapture?.()) ?? false;
        if (hid) await new Promise((resolve) => setTimeout(resolve, 220));

        const response = await fetch('/api/screen/grab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const data = (await response.json()) as Shot & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error ?? '截屏失败');
        setShot(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        // 不管成功失败，都得把窗口放回来
        if (hid) await desktop?.showAfterCapture?.();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* Esc 退出 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePicker]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!shot) return;
    // 覆盖层是 fixed inset:0，所以 clientX/Y 就是相对覆盖层的坐标
    startRef.current = { x: event.clientX, y: event.clientY };
    setBox({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
    try {
      // 抓住指针，拖到覆盖层外面也不会丢事件
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件（比如测试里造的）拿不到真实 pointerId，忽略即可
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // 只看 ref，不看 state —— setState 是异步的，
    // 拖得快的时候 move 事件会在重新渲染之前就到，读 state 会读到旧值。
    const start = startRef.current;
    if (!start) return;
    setBox({
      left: Math.min(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    });
  };

  const onPointerUp = () => {
    startRef.current = null;
    // 太小的框当误触，清掉重来
    setBox((current) => (current && current.width >= 12 && current.height >= 12 ? current : null));
  };

  /**
   * 显示坐标 → 截图原始像素。
   * 图片是 object-fit: contain 铺的，两侧或上下会有留白，得先把留白减掉。
   */
  const submit = useCallback(() => {
    const img = imgRef.current;
    if (!img || !shot || !box) return;

    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / shot.width, rect.height / shot.height);
    const offsetX = rect.left + (rect.width - shot.width * scale) / 2;
    const offsetY = rect.top + (rect.height - shot.height * scale) / 2;

    const x = Math.max(0, (box.left - offsetX) / scale);
    const y = Math.max(0, (box.top - offsetY) / scale);
    const width = Math.min(shot.width - x, box.width / scale);
    const height = Math.min(shot.height - y, box.height / scale);

    if (width < 8 || height < 8) return;
    confirmRegion({ x, y, width, height });
  }, [box, shot, confirmRegion]);

  return (
    <div
      className="picker"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="presentation"
    >
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={imgRef} className="picker-shot" src={shot.image} alt="" draggable={false} />
      ) : null}

      {box ? (
        <div
          className="picker-box"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          <span className="picker-size">
            {Math.round(box.width)} × {Math.round(box.height)}
          </span>
        </div>
      ) : null}

      <div className="picker-bar">
        {error ? (
          <span className="picker-error">{error}</span>
        ) : !shot ? (
          <span className="picker-hint">{t('screen.grabbing')}</span>
        ) : box ? (
          <>
            <span className="picker-hint">{t('screen.confirmHint')}</span>
            <button
              type="button"
              className="btn btn-primary"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={submit}
            >
              {t('screen.watchThis')}
            </button>
            <button
              type="button"
              className="btn"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setBox(null)}
            >
              {t('screen.redo')}
            </button>
          </>
        ) : (
          <span className="picker-hint">{t('screen.dragHint')}</span>
        )}

        <button
          type="button"
          className="btn btn-ghost"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closePicker}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
