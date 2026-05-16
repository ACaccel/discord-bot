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
 *   - Overall lines floor (`lines: 45`) is the post-PR-F1 baseline; it
 *     stops accidental regressions without demanding fixes the
 *     pending PR-G coverage-raise hasn't shipped yet. Raise this to
 *     the plan's ≥ 75% target inside PR-G once `core/plugin/host`,
 *     `core/ioc/container`, and the persistence repos all have
 *     dedicated unit tests (audit 3.13 / C-13).
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
        lines: 45,
        functions: 69,
        branches: 80,
        statements: 45,
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
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
    },
  },
});
