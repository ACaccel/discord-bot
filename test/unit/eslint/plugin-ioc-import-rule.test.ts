import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

/**
 * R3 contract: the project ESLint config must block any `core/ioc`
 * import from inside `src/plugins/**` and must allow the equivalent
 * import from `core/plugin`. We exercise both sides via ESLint's
 * programmatic API against virtual files that live under the real
 * `src/plugins/` path (so the file-glob match fires) without writing
 * permanent violation fixtures into the source tree.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'src/plugins/__fixture__/r3-fixture.ts');
const RULE_ID = 'no-restricted-imports';
const BAD_SOURCE = `import { TOKENS } from '../../core/ioc';\nvoid TOKENS;\n`;
const GOOD_SOURCE = `import { TOKENS } from '../../core/plugin';\nvoid TOKENS;\n`;

const createLinter = (): ESLint =>
  new ESLint({
    cwd: PROJECT_ROOT,
    overrideConfigFile: path.join(PROJECT_ROOT, 'eslint.config.mjs'),
  });

describe('R3 — plugins-cannot-import-core-ioc ESLint rule', () => {
  it('flags a core/ioc import from inside src/plugins/**', async () => {
    const eslint = createLinter();
    const results = await eslint.lintText(BAD_SOURCE, { filePath: FIXTURE_PATH });
    const result = results[0];
    if (!result) throw new Error('ESLint returned no result for the bad fixture');

    const restrictedImportMessages = result.messages.filter((m) => m.ruleId === RULE_ID);
    expect(restrictedImportMessages.length).toBeGreaterThan(0);

    const message = restrictedImportMessages[0]?.message ?? '';
    expect(message).toMatch(/core\/plugin/);
    expect(message).toMatch(/core\/ioc/);
  });

  it('accepts the same TOKENS import when routed via core/plugin', async () => {
    const eslint = createLinter();
    const results = await eslint.lintText(GOOD_SOURCE, { filePath: FIXTURE_PATH });
    const result = results[0];
    if (!result) throw new Error('ESLint returned no result for the good fixture');

    const restrictedImportMessages = result.messages.filter((m) => m.ruleId === RULE_ID);
    expect(restrictedImportMessages).toHaveLength(0);
  });
});
