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
/**
 * Path aliases mirrored from `tsconfig.json` so handler-layer unit
 * tests can import the handler barrels (which carry `@bot` / `@cmd` /
 * `handlers` imports).
 */
const aliases = {
  '@core': path.resolve(__dirname, 'src/core'),
  '@bot': path.resolve(__dirname, 'src/bot/index'),
  '@cmd': path.resolve(__dirname, 'src/handlers/commands/index'),
  '@button': path.resolve(__dirname, 'src/handlers/buttons/index'),
  '@select-menu': path.resolve(__dirname, 'src/handlers/select-menus/index'),
  '@modal': path.resolve(__dirname, 'src/handlers/modals/index'),
  '@reaction': path.resolve(__dirname, 'src/handlers/reactions/index'),
  '@plugins': path.resolve(__dirname, 'src/plugins/index'),
  handlers: path.resolve(__dirname, 'src/handlers/index'),
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
      // The integration project shares one mongodb-memory-server
      // (started by globalSetup). Parallel test files race on the
      // same database — `dropDatabase` collides with concurrent
      // index builds on adjacent files. Single-fork keeps the suite
      // under a few seconds while serialising file execution.
      // **Contract**: every integration `it()` must wrap its body in
      // `withFreshConnection` from `test/integration/helpers/mongo.ts`
      // — that helper is what provides per-test isolation. State
      // leaks silently between cases if you skip it.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
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
