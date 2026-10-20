/**
 * 渲染进程能碰到的桌面能力，只有下面这几个。
 *
 * 故意开得很窄：contextIsolation 开着，页面拿不到 Node，也拿不到完整的 ipcRenderer。
 * 想加新能力就在主进程加一个 handler，再来这里补一行 —— 别图省事把整个 ipcRenderer 暴露出去。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frameDesktop', {
  isDesktop: true,

  /** 截屏前把挡路的窗口藏起来；返回是否真的藏了（本来就在后台就不藏） */
  hideForCapture: () => ipcRenderer.invoke('frame:hide-for-capture'),

  /** 截完把窗口放回来 */
  showAfterCapture: () => ipcRenderer.invoke('frame:show-after-capture'),

  /** 显示/隐藏主窗口（全局快捷键走的是主进程，这里给界面留个手动入口） */
  toggleMain: () => ipcRenderer.invoke('frame:toggle-main'),

  /** 强制把主窗叫到前台（动作确认弹窗要用） */
  showMain: () => ipcRenderer.invoke('frame:show-main'),

  /** 在屏幕绝对坐标上闪一个高亮圈，动作前先让你看清点哪儿 */
  highlight: (x, y) => ipcRenderer.invoke('frame:highlight', { x, y }),

  /** 高亮窗订阅「要闪哪个点」 */
  onHighlightPoint: (cb) => {
    const listener = (_event, point) => cb(point);
    ipcRenderer.on('frame:highlight-point', listener);
    return () => ipcRenderer.removeListener('frame:highlight-point', listener);
  },

  /** 悬浮窗把内容高度报给主进程，窗口跟着收放 */
  resizeFloat: (height) => ipcRenderer.send('frame:resize-float', height),

  /** 关闭悬浮窗（暂时不用，留着给以后「只留主窗」的选项） */
  closeFloat: () => ipcRenderer.send('frame:close-float'),
});
