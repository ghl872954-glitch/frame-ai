'use client';

/**
 * 动作高亮层。
 *
 * 一个铺满主屏、全透明、点击穿透的窗口。动作执行前，主进程把「要点哪儿」
 * 发过来，这里在那个位置闪一个圈，让用户先看清，再真的点下去。
 *
 * 它没有按钮、不接鼠标，纯粹是给眼睛看的一个提示。
 */

import { useEffect, useState } from 'react';

interface HighlightPoint {
  x: number;
  y: number;
  seq: number;
}

export default function HighlightPage() {
  const [point, setPoint] = useState<HighlightPoint | null>(null);

  useEffect(() => {
    const bridge = window.frameDesktop;
    if (!bridge?.onHighlightPoint) return;
    return bridge.onHighlightPoint((next) => {
      // 每次递增 seq，让同一个点也能重新播一遍动画
      setPoint((prev) => ({ x: next.x, y: next.y, seq: (prev?.seq ?? 0) + 1 }));
    });
  }, []);

  return (
    <div className="highlight-root">
      {point ? (
        <div
          key={point.seq}
          className="highlight-ring"
          style={{ left: point.x, top: point.y }}
        />
      ) : null}
    </div>
  );
}
