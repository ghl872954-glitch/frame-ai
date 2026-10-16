// Next 16 的 eslint-config-next 直接导出 flat config 数组，
// 不用再套 @eslint/eslintrc 那层兼容 —— 套了反而会因为循环引用崩掉。
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // 这个项目里「没用的参数」经常是刻意留的接口占位，允许下划线前缀绕过。
      // 覆盖 eslint-config-next 默认的 warn，这里要当错误拦下来。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
