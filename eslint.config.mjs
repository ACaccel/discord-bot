import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config (ESLint v9).
 *
 * Phase 0 scope: lints `src/core/**`, `scripts/**`, `test/**`.
 * Phase 2 expansion: also lints `src/persistence/**`, `src/infra/**`.
 * Legacy directories join as each later phase migrates them. Most rules
 * start as `warn` to avoid blocking the refactor; the critical ones
 * (no-restricted-syntax for raw process.env, import cycles, IoC
 * service-locator guard) are `error` from day one.
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
  // Service-locator guard (Phase 2): the IoC container is a composition
  // tool, not an ambient lookup. Only composition roots (`src/bot/**`)
  // and tests may import it. Application / domain / interface /
  // persistence / infra layers receive dependencies via constructor
  // parameters from their composition root. The legacy `src/events/**`
  // and `src/features/**` trees were removed during gap-remediation, so
  // their globs are no longer listed here.
  {
    files: [
      'src/application/**/*.ts',
      'src/domain/**/*.ts',
      'src/interface/**/*.ts',
      'src/persistence/**/*.ts',
      'src/infra/**/*.ts',
      'src/handlers/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/ioc', '**/core/ioc/*', '@core/ioc', '@core/ioc/*'],
              message:
                'IoC container imports are restricted to composition roots (src/bot/**) and tests. Receive dependencies via constructor parameters instead.',
            },
          ],
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
      'no-restricted-imports': 'off',
    },
  },
  prettier,
);
