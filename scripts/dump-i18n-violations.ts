/**
 * One-shot diagnostic: dump every CJK-literal violation the
 * `no-literal-cjk` scanner would report. Used during PR 6-3 to
 * plan the long-tail migration. Deleted alongside the other one-
 * shot scripts when strict mode lands.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCOPED_DIRECTORIES = ['src/handlers', 'src/plugins', 'src/events'];
const CJK_REGEX = /[぀-ゟ゠-ヿ一-鿿가-힯]/;
const IGNORE_LINE_PATTERN = /\/\/\s*i18n-ignore:\s*\S/;

const walk = (dir: string): string[] => {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

const isCommentLine = (line: string, inBlock: boolean): boolean => {
  const t = line.trim();
  if (inBlock) return true;
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

const scan = (file: string): Array<{ line: number; text: string }> => {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  for (let i = 0; i < src.length; i += 1) {
    const line = src[i] as string;
    const opens = /\/\*/.test(line) && !/\*\//.test(line);
    const closes = /\*\//.test(line);
    const was = inBlock;
    if (opens) inBlock = true;
    if (closes) inBlock = false;
    if (!CJK_REGEX.test(line)) continue;
    if (IGNORE_LINE_PATTERN.test(line)) continue;
    if (isCommentLine(line, was)) continue;
    const prev = i > 0 ? (src[i - 1] as string) : '';
    if (IGNORE_LINE_PATTERN.test(prev)) continue;
    out.push({ line: i + 1, text: line });
  }
  return out;
};

const byFile = new Map<string, Array<{ line: number; text: string }>>();
for (const dir of SCOPED_DIRECTORIES) {
  for (const f of walk(path.join(ROOT, dir))) {
    const v = scan(f);
    if (v.length > 0) byFile.set(path.relative(ROOT, f), v);
  }
}

let total = 0;
for (const [file, vs] of byFile) {
  total += vs.length;
  console.log(`\n=== ${file} (${vs.length}) ===`);
  for (const v of vs) console.log(`  ${v.line}: ${v.text.trim()}`);
}
console.log(`\nTotal: ${total} across ${byFile.size} files`);
