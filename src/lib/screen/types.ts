/**
 * 看屏幕的公共类型。
 *
 * 单独放一个文件，是因为 `grab.ts` 用了 node:child_process，
 * 而 store 和组件是客户端代码 —— 从 grab.ts 引类型会把 node 模块拖进浏览器包。
 */

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
