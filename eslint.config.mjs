// Shared flat ESLint config for every workspace package.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Synthetic ground-truth labels must never be reachable from application code,
 * otherwise matching could "succeed" by reading the answers.
 */
const groundTruthIsolation = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/ground-truth/**', '**/data/synthetic/**'],
          message: 'Application code must not read synthetic dataset files or ground-truth labels.',
        },
        {
          group: ['@fis/evaluation', '@fis/evaluation/*'],
          message: 'The evaluation package is a dev-only tool and must not be imported by apps.',
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/src/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // NestJS relies on runtime class references for dependency injection, so
    // type-only imports would break DI metadata.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      ...groundTruthIsolation,
    },
  },
  {
    // The production pipeline must stay blind to synthetic labels too.
    files: ['packages/triage-core/**/*.ts'],
    rules: groundTruthIsolation,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...groundTruthIsolation,
    },
  },
  prettier,
);
