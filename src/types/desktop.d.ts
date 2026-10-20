/**
 * Electron 桌面外壳注入到页面上的桥。
 *
 * 只有用 Electron 跑的时候才存在；在普通浏览器里 `window.frameDesktop` 是 undefined，
 * 所以调用处一律用可选链，浏览器版照样能跑。
 */

export {};

declare global {
  interface FrameDesktopBridge {
    isDesktop: boolean;
    /** 截屏前藏起挡路的窗口，返回是否真的藏了 */
    hideForCapture: () => Promise<boolean>;
    /** 截完放回来 */
    showAfterCapture: () => Promise<boolean>;
    /** 显示/隐藏主窗 */
    toggleMain: () => Promise<boolean>;
    /** 强制把主窗叫到前台 */
    showMain: () => Promise<boolean>;
    /** 在屏幕绝对坐标上闪一个高亮圈 */
    highlight: (x: number, y: number) => Promise<boolean>;
    /** 高亮窗订阅要闪的点，返回取消订阅函数 */
    onHighlightPoint: (cb: (point: { x: number; y: number }) => void) => () => void;
    /** 悬浮窗把内容高度报给主进程 */
    resizeFloat: (height: number) => void;
    closeFloat: () => void;
  }

  interface Window {
    frameDesktop?: FrameDesktopBridge;
  }
}
