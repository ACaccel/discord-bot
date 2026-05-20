import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Root Vitest config — coverage / shared settings only. The project
 * layout (unit / integration / contract / i18n) lives in
 * `vitest.workspace.ts`. Yarn scripts pick a project via `--project`.
 *
 * Coverage thresholds enforce the plan §5.1 floors WHERE the layer
 * actually exists today:
 *   - `src/core/**` is at 100% line / branch / func; the 90% floor
 *     locks in the audit baseline.
 *   - Overall lines floor (`lines: 46`) is the post-PR-G5 baseline.
 *     `src/core/**` and the persistence repos are well-covered (90% /
 *     integration tests via mongodb-memory-server); the remaining gap
 *     to the plan's ≥ 75% target is in `src/handlers/**`, `src/bot/**`,
 *     `src/utils/**`, and `src/events/**` — handler-side fixtures
 *     ship in PR-G5 (audit C-12) and the targeted unit tests for the
 *     pure helpers in `core/plugin/host/topology.ts` +
 *     `core/plugin/host/contributes-merger.ts` land alongside. The
 *     remaining raise to ≥ 75% is a multi-day effort on the legacy
 *     layers and is deferred to a follow-up after the final
 *     `refactor/architecture-overhaul → main` merge.
 *   - `domain/` + `application/` layers are intentionally absent (see
 *     audit 1.4); no thresholds defined for them.
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
    // `@utils` / `handlers` imports). `@core` keeps its leading entry
    // for the bulk of the suite that only needs the core alias.
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@bot': path.resolve(__dirname, 'src/bot/index'),
      '@cmd': path.resolve(__dirname, 'src/handlers/commands/index'),
      '@button': path.resolve(__dirname, 'src/handlers/buttons/index'),
      '@select-menu': path.resolve(__dirname, 'src/handlers/select-menus/index'),
      '@modal': path.resolve(__dirname, 'src/handlers/modals/index'),
      '@reaction': path.resolve(__dirname, 'src/handlers/reactions/index'),
      '@utils': path.resolve(__dirname, 'src/utils/index'),
      '@plugins': path.resolve(__dirname, 'src/plugins/index'),
      handlers: path.resolve(__dirname, 'src/handlers/index'),
    },
  },
});
