#!/usr/bin/env ts-node
/**
 * Codegen for handler registries.
 *
 * Phase 0 ships the script skeleton and CLI wiring only. Phase 1 implements
 * the actual scanning / generation once the handler folders are restructured
 * to the `<name>.command.ts` convention.
 *
 * Usage:
 *   yarn handlers:gen           # write registry.generated.ts files
 *   yarn handlers:gen:check     # CI mode: fail if generated content is stale
 *
 * Why codegen vs runtime fs scanning: explicit imports keep the build
 * tree-shakable, IDE-navigable, and refactor-safe; the codegen removes the
 * "two-place edit" friction by regenerating on file watch / pre-commit / CI.
 */
import * as path from 'path';

interface RegistryTarget {
  readonly dir: string;
  readonly suffix: string;
  readonly constructorType: string;
  readonly constructorTypeModule: string;
  readonly exportName: string;
}

// Phase 1 will populate this list with the real handler directories.
const TARGETS: readonly RegistryTarget[] = [];

interface CliOptions {
  readonly check: boolean;
}

const parseArgs = (argv: readonly string[]): CliOptions => ({ check: argv.includes('--check') });

const main = async (): Promise<void> => {
  const { check } = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');

  if (TARGETS.length === 0) {
    if (check) {
      console.log('[gen-registry] no targets configured yet (Phase 0); skipping.');
    }
    return;
  }

  // Phase 1 will implement scanning and writing; the structure is in place.
  void repoRoot;
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[gen-registry] ${message}\n`);
  process.exit(1);
});
