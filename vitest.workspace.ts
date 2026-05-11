import { defineWorkspace } from 'vitest/config';
import path from 'path';

/**
 * Vitest workspace — defines four independent projects. Each project's
 * include glob is the ground truth for what files it picks up; the
 * corresponding yarn script (`test:unit`, `test:int`, `test:contract`,
 * `test:i18n`) selects via `--project <name>`.
 *
 * Empty-project guard:
 *   - Phase 0 integration + contract projects intentionally contain zero
 *     test files. `--passWithNoTests` keeps the script exit code clean.
 *   - CI compensates by running each phase-gated project with
 *     `--reporter=json`, parsing `numTotalTestSuites`, and failing if
 *     the count is zero past a phase threshold recorded in
 *     `.github/PHASE`.
 *
 * `globalSetup` for the integration project is wired now so Phase 2's
 * mongodb-memory-server lifecycle has a real entry point already loaded.
 */
const aliases = {
  '@core': path.resolve(__dirname, 'src/core'),
};

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['test/unit/**/*.test.ts'],
      environment: 'node',
    },
    resolve: { alias: aliases },
  },
  {
    test: {
      name: 'integration',
      include: ['test/integration/**/*.test.ts'],
      environment: 'node',
      globalSetup: ['./test/integration/setup.ts'],
    },
    resolve: { alias: aliases },
  },
  {
    test: {
      name: 'contract',
      include: ['test/contract/**/*.test.ts'],
      environment: 'node',
    },
    resolve: { alias: aliases },
  },
  {
    test: {
      name: 'i18n',
      include: ['test/i18n/**/*.test.ts'],
      environment: 'node',
    },
    resolve: { alias: aliases },
  },
]);
