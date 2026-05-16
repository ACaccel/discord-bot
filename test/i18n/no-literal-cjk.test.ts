/**
 * CJK-literal scanner — enforces that every user-facing string in the
 * interface / handler / plugin / event layers flows through the
 * translator (`Translator.t`) rather than living as an inline literal.
 *
 * Phase 6 lands this in **warn mode**: the test reports every
 * violation but does not fail. The output is consumed by PR 6-2's
 * migration sweep and the rule is promoted to **error mode** in PR
 * 6-3 once the catalog is complete (see `STRICT_MODE_PHASE`).
 *
 * Whitelist mechanism: prefix the offending line with
 * `// i18n-ignore: <reason>` to silence the scanner. The reason is
 * required so future readers see WHY a literal stayed inline
 * (e.g. command-builder default that Discord ignores anyway, raw
 * SQL fragment that happens to contain CJK).
 *
 * Scope rationale:
 *   - `src/handlers/**` (commands / buttons / modals / SSMs / reactions)
 *     and `src/plugins/**` reach Discord users directly.
 *   - `src/events/**` is on the way out (Phase 4b stripped most of it)
 *     but the remaining `detectGuildCreate` still emits user-visible
 *     guild-create chatter — covered for that reason.
 *   - `src/bot/**` (composition roots + bot subclasses) is scanned
 *     in strict mode after audit 3.4. Composition roots used to seed
 *     help_msg / presence as inline CJK; they now must route through
 *     the translator (e.g. Nijika's `helpMessageKey`, Konata's
 *     `replies:konata.presence_text`). `src/bot/index.ts` BaseBot only
 *     emits ops-log lines that are deliberately English; if a future
 *     change reintroduces CJK there, the scanner catches it.
 *   - `src/utils/` and `src/features/` carry domain code that is not
 *     yet a user-facing boundary; left alone for now.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const STRICT_MODE_PHASE = 6; // PR 6-3b: scanner now strict at PHASE >= 6.

/**
 * Directories the scanner walks. Each entry is a path relative to
 * the repo root. Adding a directory here without a corresponding
 * catalog sweep WILL fail in strict mode — coordinate with the
 * migration PR.
 */
const SCOPED_DIRECTORIES: readonly string[] = ['src/handlers', 'src/plugins', 'src/events', 'src/bot'];

/**
 * Per-file allowlist. Use sparingly — every entry should carry a
 * comment explaining why the file genuinely cannot reach a translator
 * (e.g. data fixtures, command-builder defaults Discord overrides
 * with `name_localizations`, etc.). PR 6-2's migration sweep will
 * empty this set; PR 6-3 keeps the field for future exceptional cases.
 */
const FILE_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

const CJK_REGEX = /[぀-ゟ゠-ヿ一-鿿가-힯]/;
// Require a non-empty reason after the colon so reviewers see WHY a
// literal stayed inline. The reason-less form `// i18n-ignore` is
// rejected on purpose — it defeats the audit trail this whitelist
// exists to preserve.
const IGNORE_LINE_PATTERN = /\/\/\s*i18n-ignore:\s*\S/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const walk = (dir: string): readonly string[] => {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Skip lines that are pure comments. The scanner targets user-facing
 * string literals; CJK inside JSDoc / line comments is documentation
 * (e.g. an inline example of the legacy reply text) and is not part
 * of the translation contract. Tracking is line-based with a small
 * block-comment cursor so unbalanced `/* … *\/` does not leak.
 */
const isCommentLine = (line: string, inBlockComment: boolean): boolean => {
  const trimmed = line.trim();
  if (inBlockComment) return true; // already inside /* ... */
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
};

const scanFile = (filePath: string): readonly Violation[] => {
  const rel = path.relative(ROOT, filePath);
  if (FILE_ALLOWLIST.has(rel)) return [];
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split('\n');
  const violations: Violation[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    // Track block-comment state. A line that contains `/*` opens
    // (unless it also closes with `*/` on the same line); a line that
    // contains `*/` closes. This is heuristic — strings containing
    // `/*` would confuse it — but real-world callsites do not embed
    // those tokens in user-facing strings, and the cost of a false
    // skip is one extra `// i18n-ignore` annotation.
    const opensBlock = /\/\*/.test(line) && !/\*\//.test(line);
    const closesBlock = /\*\//.test(line);
    const wasInBlockComment = inBlockComment;
    if (opensBlock) inBlockComment = true;
    if (closesBlock) inBlockComment = false;

    if (!CJK_REGEX.test(line)) continue;
    if (IGNORE_LINE_PATTERN.test(line)) continue;
    if (isCommentLine(line, wasInBlockComment)) continue;
    // The previous-line ignore form: `// i18n-ignore: ...\n<violation>`.
    const prev = i > 0 ? (lines[i - 1] as string) : '';
    if (IGNORE_LINE_PATTERN.test(prev)) continue;
    violations.push({ file: rel, line: i + 1, text: line.trim() });
  }
  return violations;
};

const collectAllViolations = (): readonly Violation[] => {
  const out: Violation[] = [];
  for (const dir of SCOPED_DIRECTORIES) {
    for (const file of walk(path.join(ROOT, dir))) {
      out.push(...scanFile(file));
    }
  }
  return out;
};

const phase = (): number => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.github', 'PHASE'), 'utf8').trim();
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
};

/**
 * Monotonic-decrease ratchet: the warn-mode count is allowed to drop
 * but never to grow. PR 6-2 migrates handlers in waves; each wave
 * updates `.baseline` downward, and the ratchet here catches the
 * regression case "PR introduces new literals while migrating old
 * ones". When PR 6-3 flips `STRICT_MODE_PHASE` to 6, the strict
 * assertion below subsumes the ratchet and the baseline can drop to 0.
 */
const readBaseline = (): number => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.baseline'), 'utf8').trim();
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

describe('CJK-literal scanner', () => {
  const violations = collectAllViolations();

  it('reports the current violation count and a preview for the migration sweep', () => {
    if (violations.length > 0) {
      console.log(
        `[i18n-scanner] ${violations.length} CJK literal(s) flagged across ${SCOPED_DIRECTORIES.length} scoped directories.`,
      );
      // Print a compact preview so CI logs are useful without flooding.
      for (const v of violations.slice(0, 20)) {
        console.log(`  ${v.file}:${v.line}  ${v.text.slice(0, 120)}`);
      }
      if (violations.length > 20) {
        console.log(`  ... and ${violations.length - 20} more.`);
      }
    }
    expect(true).toBe(true);
  });

  it('never regresses: violation count must not exceed the committed baseline', () => {
    const baseline = readBaseline();
    expect(
      violations.length,
      `i18n violation count (${violations.length}) exceeds baseline (${baseline}). ` +
        'A new CJK literal was introduced. Either migrate it to a translator key in ' +
        'src/interface/locales/zh-TW/ or annotate it with "// i18n-ignore: <reason>". ' +
        'After a migration wave drops the count, lower test/i18n/.baseline to match.',
    ).toBeLessThanOrEqual(baseline);
  });

  it(`is strict (zero violations) once PHASE >= ${STRICT_MODE_PHASE}; warn-only before`, () => {
    if (phase() >= STRICT_MODE_PHASE) {
      expect(
        violations,
        `Expected zero CJK literals in ${SCOPED_DIRECTORIES.join(', ')} once PHASE >= ${STRICT_MODE_PHASE}. ` +
          `Migrate each to a translator key in src/interface/locales/zh-TW/ or annotate with "// i18n-ignore: <reason>".`,
      ).toEqual([]);
    } else {
      // Below the strict threshold: the report-only assertion above
      // is the only signal. Pin the threshold here so the check
      // cannot be silently disabled by deleting one line.
      expect(STRICT_MODE_PHASE).toBeGreaterThanOrEqual(6);
    }
  });
});
