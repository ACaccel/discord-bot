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
      // R6.5: all `import` statements must form a single contiguous
      // block at the top of the file. Prevents the pre-R1 pattern in
      // `src/bot/index.ts` where module-level helpers were wedged
      // between two import groups.
      'import/first': 'error',
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
      'src/i18n/**/*.ts',
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
  // R3: plugin layer must reach the IoC surface only through the
  // `core/plugin` barrel (which re-exports TOKENS / ServiceToken /
  // Resolver). Direct imports from `core/ioc` are blocked so the
  // container's write-side surface stays a composition-root privilege.
  // Kept as a separate block (rather than merged with the layered
  // service-locator guard above) so the error message can point
  // plugin authors at the correct alternative path.
  {
    files: ['src/plugins/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/ioc', '**/core/ioc/*', '@core/ioc', '@core/ioc/*'],
              message: 'Plugins must import TOKENS / ServiceToken from core/plugin, not core/ioc.',
            },
          ],
        },
      ],
    },
  },
  // R4: Handler index files must stay readable. Cap any file under
  // src/handlers/**/*.ts at 150 visible lines (imports + JSDoc + blanks
  // included) to enforce the rule that pure helpers be split into
  // sibling kebab-case files. Discord I/O, permission checks, Translator
  // calls, and reply assembly stay in index.ts; everything else moves out.
  {
    files: ['src/handlers/**/*.ts'],
    ignores: [
      // Codegen artifact — one import per handler, naturally long.
      'src/handlers/**/registry.generated.ts',
      // Handler-framework base class + localizer (single function file).
      // Tracked as R4 PR follow-up: revisit only when functional changes land.
      'src/handlers/commands/command.ts',
      // Shared Discord helpers used by many handlers. Follow-up: keep
      // until a refactor extracts cohesive sub-modules.
      'src/handlers/commands/discord-helpers.ts',
      // Cross-handler error -> reply mapping table. Follow-up: consider
      // splitting the map into error-reply-map.ts.
      'src/handlers/reply-for-error.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: false, skipComments: false }],
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
