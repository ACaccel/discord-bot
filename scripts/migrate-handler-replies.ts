/**
 * One-shot script: mass-substitute duplicated literal replies in
 * handler files with translator calls.
 *
 * Substitution shape:
 *   `content: '<known literal>'` → `content: bot.translator?.t('<key>') ?? ''`
 *   `content: "<known literal>"` → `content: bot.translator?.t('<key>') ?? ''`
 *
 * `?? ''` covers the pre-`run()` window where `bot.translator` is
 * `undefined`; in any handler context `run()` has already populated
 * the field so the fallback is unreachable in production.
 *
 * Scope: `src/handlers/**`. Plugins are excluded because they already
 * use `ctx.translator.t(...)` (not optional) and the substitution
 * shape would be different.
 *
 * One-shot: ships in PR 6-2b, deleted in PR 6-3 once strict mode
 * lands and the long-tail migration is done by hand.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SCOPED_DIRECTORIES = ['src/handlers'];

/**
 * Literal → catalog key. Keep entries here in lockstep with the
 * keys actually present in `src/interface/locales/zh-TW/{errors,replies}.json`.
 */
const SUBSTITUTIONS: Readonly<Record<string, string>> = {
  '此指令只能在伺服器中使用。': 'errors:command.guild_only',
  找不到伺服器: 'errors:command.guild_not_found',
  找不到伺服器資訊: 'errors:command.guild_info_not_found',
  找不到頻道: 'errors:command.channel_not_found',
  頻道不存在或無法傳送訊息: 'errors:command.channel_not_sendable',
  找不到使用者: 'errors:command.user_not_found',
  找不到機器人: 'errors:command.bot_not_found',
  '資料庫連線異常，請稍後再試。': 'errors:db.connection_failed',
  '資料庫操作失敗，請稍後再試。': 'errors:db.operation_failed',
  找不到資料庫: 'errors:db.not_found',
  請先設定資料庫: 'errors:db.not_configured',
  '只有管理員可以執行此指令。': 'errors:permission.admin_only_short',
  '你不在白名單中，請聯絡管理員。': 'errors:ai.not_whitelisted',
};

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

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const migrateFile = (filePath: string): number => {
  let source = fs.readFileSync(filePath, 'utf8');
  let substitutions = 0;
  for (const [literal, key] of Object.entries(SUBSTITUTIONS)) {
    const escaped = escapeRegex(literal);
    // Match `content: '<literal>'` or `content: "<literal>"`. The
    // replacement preserves the rest of the line.
    const pattern = new RegExp(`content:\\s*(['"])${escaped}\\1`, 'g');
    source = source.replace(pattern, (_match) => {
      substitutions += 1;
      return `content: bot.translator?.t('${key}') ?? ''`;
    });
  }
  if (substitutions > 0) {
    fs.writeFileSync(filePath, source);
  }
  return substitutions;
};

const main = (): void => {
  let total = 0;
  let touched = 0;
  for (const dir of SCOPED_DIRECTORIES) {
    for (const file of walk(path.join(ROOT, dir))) {
      const n = migrateFile(file);
      if (n > 0) {
        touched += 1;
        total += n;
        console.log(`  migrated ${path.relative(ROOT, file)}: +${n}`);
      }
    }
  }
  console.log(`Migrated ${total} duplicated reply line(s) across ${touched} file(s).`);
};

main();
