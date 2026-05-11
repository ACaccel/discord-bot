import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config (ESLint v9).
 *
 * Phase 0 scope: lints only new code paths (`src/core/**`, `scripts/**`,
 * `test/**`). Legacy directories will join as each later phase migrates
 * them. Most rules start as `warn` to avoid blocking the refactor; the
 * critical ones (no-restricted-syntax for raw process.env, import cycles)
 * are `error` from day one.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/*.generated.ts',
      'src/bot/**/config.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'import/no-cycle': 'error',
      'import/no-self-import': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  // Hard rule: only src/core/config may read process.env directly.
  // Everywhere else must import the typed Env from `core/config`.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    ignores: ['src/core/config/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'Direct process.env access is banned. Import the typed Env from "@core/config" / "src/core/config" instead.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Direct process.env access is banned. Import the typed Env from "@core/config" / "src/core/config" instead.',
        },
      ],
    },
  },
  // Test files: relax some rules.
  {
    files: ['test/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  prettier,
);
