import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.mjs',
      '!packages/backend/scripts/*.mjs',
    ],
  },
  {
    // Dev-only Node scripts (ESM, plain JavaScript): core rules only.
    files: ['packages/backend/scripts/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      'packages/shared/src/**/*.ts',
      'packages/backend/src/**/*.ts',
      'packages/backend/test/**/*.ts',
      'packages/frontend/src/**/*.ts',
      'packages/frontend/src/**/*.tsx',
      'packages/cli/src/**/*.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  prettierConfig,
];
