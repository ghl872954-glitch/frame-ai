/**
 * 全局 CSS 的副作用导入声明。
 *
 * Next 自带的类型只覆盖 CSS Modules（`*.module.css`），
 * 而 `import './globals.css'` 这种副作用导入没有声明 ——
 * TypeScript 6 起这类导入必须能找到模块声明，否则报 TS2882。
 *
 * 放这里而不是改 next-env.d.ts：那个文件是 Next 自动生成的，
 * 而且被 gitignore 了（CI 里根本不存在），写进去会被覆盖。
 */
declare module '*.css';
