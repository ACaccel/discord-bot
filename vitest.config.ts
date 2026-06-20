import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Root Vitest config — coverage / shared settings only. The project
 * layout (unit / integration / contract / i18n / tools) lives in
 * `vitest.workspace.ts`. Yarn scripts pick a project via `--project`.
 *
 * Coverage thresholds:
 *   - `src/core/**` carries a high floor (90% line / func / statement,
 *     89% branch); core is pure infrastructure and is kept
 *     well-covered.
 *   - The overall floors (`lines`/`statements: 46`, `functions: 69`,
 *     `branches: 80`) are the enforced baseline across the whole tree;
 *     the heavier-to-cover handler and bot layers pull the line /
 *     statement floor down relative to core.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.generated.ts'],
      thresholds: {
        lines: 46,
        functions: 69,
        branches: 80,
        statements: 46,
        'src/core/**': {
          lines: 90,
          functions: 90,
          branches: 89,
          statements: 90,
        },
      },
    },
  },
  resolve: {
    // Mirror the `tsconfig.json` path aliases so handler-layer unit
    // tests can import the handler barrels (which carry `@bot` /
    // `@cmd` / `handlers` imports). `@core` keeps its leading entry
    // for the bulk of the suite that only needs the core alias.
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@bot': path.resolve(__dirname, 'src/bot/index'),
      '@cmd': path.resolve(__dirname, 'src/handlers/commands/index'),
      '@button': path.resolve(__dirname, 'src/handlers/buttons/index'),
      '@select-menu': path.resolve(__dirname, 'src/handlers/select-menus/index'),
      '@modal': path.resolve(__dirname, 'src/handlers/modals/index'),
      '@reaction': path.resolve(__dirname, 'src/handlers/reactions/index'),
      '@plugins': path.resolve(__dirname, 'src/plugins/index'),
      handlers: path.resolve(__dirname, 'src/handlers/index'),
    },
  },
});
