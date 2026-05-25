/**
 * MessageBackupPlugin — periodic per-guild message backup.
 *
 * The plugin owns the full backup logic; the `MsgArchive` composition
 * root simply registers it. The hot loop and its helpers (channel
 * fetch, retry, pagination, log file format, stale-Fetch-doc cleanup)
 * live in `internal/` so this file stays lifecycle wiring only.
 *
 * Wiring:
 *   - Reads `backupServers` config — the list of guild ids the bot
 *     should back up.
 *   - Schedules itself on `onReady` (one-shot per guild then a
 *     1-hour repeat loop). `onShutdown` clears the loop so a fast
 *     restart does not double-trigger.
 *
 * Why bot-scope rather than guild-scope: backup batches all
 * configured guilds in series to keep request-rate predictable. A
 * guild-scoped variant would race against itself on the Mongo
 * connection pool.
 */
import { TOKENS } from '../../core/plugin';
import { logError } from '../../core/logger';
import type { Plugin } from '../../core/plugin';
import { performBackup } from './internal';

const PLUGIN_ID = 'message-backup';
const PLUGIN_VERSION = '1.0.0';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface MessageBackupPluginConfig {
  readonly backupServers: readonly string[];
}

export const createMessageBackupPlugin = (
  rawConfig: MessageBackupPluginConfig,
): Plugin => {
  const config: MessageBackupPluginConfig = {
    backupServers: [...rawConfig.backupServers],
  };
  const running = new Set<string>();
  let loopHandle: NodeJS.Timeout | undefined;
  let stopped = false;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    async onReady(ctx): Promise<void> {
      const registry = ctx.resolve(TOKENS.GuildRegistry);
      const client = ctx.resolve(TOKENS.DiscordClient);

      const runOnce = async (): Promise<void> => {
        for (const guildId of config.backupServers) {
          if (running.has(guildId)) {
            logError(ctx.logger, guildId, 'Backup already running, skipping this tick');
            continue;
          }
          running.add(guildId);
          try {
            await performBackup(guildId, registry, client, ctx.logger);
          } finally {
            running.delete(guildId);
          }
        }
      };

      await runOnce();
      const scheduleNext = (): void => {
        if (stopped) return;
        loopHandle = setTimeout(async () => {
          await runOnce();
          scheduleNext();
        }, BACKUP_INTERVAL_MS);
      };
      scheduleNext();
    },

    async onShutdown(): Promise<void> {
      stopped = true;
      if (loopHandle !== undefined) {
        clearTimeout(loopHandle);
        loopHandle = undefined;
      }
    },
  };
};
