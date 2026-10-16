import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const here = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: here });

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // 这个项目里「没用的参数」经常是刻意留的接口占位，允许下划线前缀绕过
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
