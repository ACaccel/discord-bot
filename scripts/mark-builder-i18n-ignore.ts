/**
 * One-shot script: annotate command-builder metadata lines with
 * `// i18n-ignore: command-builder metadata; localised in PR 6-3 ...`.
 *
 * Target shape (matches the existing `setConfig({...})` convention):
 *
 *     description: '<CJK literal>',
 *     description: "<CJK literal>",
 *     name: '<CJK literal>',
 *     name: "<CJK literal>",
 *
 * Heuristic: a line whose trimmed text starts with one of those keys
 * followed by `:` and contains a CJK character is treated as a
 * command-builder field. False-positive risk is near zero because
 * those keys are reserved for the discord.js builder options inside
 * `setConfig({...})` — runtime replies use `content:` instead.
 *
 * Idempotent: if the line above is already an `i18n-ignore` comment,
 * skip. Re-running the script on already-annotated files is a no-op.
 *
 * One-shot: this script ships in PR 6-2b and gets deleted in PR 6-3
 * once the builder metadata is replaced wholesale by Discord
 * `name_localizations` / `description_localizations`. There is no
 * unit-test coverage because the script is a migration aid, not a
 * production code path; the i18n-scanner test below covers the
 * outcome.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCOPED_DIRECTORIES = ['src/handlers', 'src/plugins', 'src/events'];

const CJK_REGEX = /[぀-ゟ゠-ヿ一-鿿가-힯]/;
// Match `name:` / `description:` either at the line start (the
// canonical setConfig({...}) form) OR right after `{ ` / `, `
// (the inline choice form like `{ name: '釘選', value: 'pin' }`).
// Capture leading indent so the inserted `// i18n-ignore` line
// aligns with the violation.
const BUILDER_FIELD_PATTERN = /^(\s*).*\b(name|description)\s*:\s*["'].*$/;
const IGNORE_LINE_PATTERN = /\/\/\s*i18n-ignore:\s*\S/;
const MARKER =
  '// i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.';

const walk = (dir: string): string[] => {
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
 * Annotate `name:` / `description:` lines INSIDE a `this.setConfig({...})`
 * block.
 *
 * The setConfig-only gate is mandatory: an earlier, looser version of
 * this script (PR 6-2b first commit) over-matched and tagged an embed
 * `addFields({ name: '頭像連結', ... })` line as command-builder
 * metadata. The line is runtime UI and needs a translator call, not
 * an i18n-ignore. Codex stop-time review caught the regression; this
 * gate is the structural fix.
 *
 * Depth tracking is a simple brace counter starting from
 * `this.setConfig(` and closing when the parenthesis depth returns
 * to zero. Brace-in-string false-positives (a `{` inside a CJK
 * literal) are theoretically possible but the setConfig body never
 * contains such literals in this codebase.
 */
const annotateFile = (filePath: string): number => {
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split('\n');
  const out: string[] = [];
  let annotations = 0;
  let parenDepth = 0;
  let inSetConfig = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    // Detect `this.setConfig(` opener on this line; consume the
    // opening paren in the depth counter below so the closing `)`
    // on a later line balances out.
    if (!inSetConfig && /this\.setConfig\s*\(/.test(line)) {
      inSetConfig = true;
      parenDepth = 0;
    }
    if (inSetConfig) {
      // Track paren depth across the whole line. The setConfig body
      // closes when depth returns to zero AFTER the opener line.
      for (let j = 0; j < line.length; j += 1) {
        const c = line.charAt(j);
        if (c === '(') parenDepth += 1;
        if (c === ')') parenDepth -= 1;
      }
    }

    const match = BUILDER_FIELD_PATTERN.exec(line);
    if (inSetConfig && match !== null && CJK_REGEX.test(line)) {
      const prev = out[out.length - 1] ?? '';
      if (!IGNORE_LINE_PATTERN.test(prev)) {
        const indent = match[1] ?? '';
        out.push(`${indent}${MARKER}`);
        annotations += 1;
      }
    }
    out.push(line);

    if (inSetConfig && parenDepth <= 0) {
      inSetConfig = false;
    }
  }
  if (annotations > 0) {
    fs.writeFileSync(filePath, out.join('\n'));
  }
  return annotations;
};

const main = (): void => {
  let total = 0;
  let touched = 0;
  for (const dir of SCOPED_DIRECTORIES) {
    for (const file of walk(path.join(ROOT, dir))) {
      const n = annotateFile(file);
      if (n > 0) {
        touched += 1;
        total += n;
        console.log(`  annotated ${path.relative(ROOT, file)}: +${n}`);
      }
    }
  }
  console.log(`Annotated ${total} command-builder line(s) across ${touched} file(s).`);
};

main();
