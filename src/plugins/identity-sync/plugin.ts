/**
 * IdentitySyncPlugin — keeps the bot's avatar + per-guild nickname in sync
 * with a configured source user, re-checked once per day.
 *
 * On `onReady` it applies the identity once (so the bot looks right from
 * boot) and, when enabled, schedules a daily cron via the shared
 * {@link JobManager}. `onShutdown` cancels that job. The actual apply logic
 * (mirror-source vs static-fallback, avatar rate-limit guard) lives in
 * `internal/sync.ts`; this file is lifecycle wiring only.
 *
 * Factory pattern (mirrors the other bot-scoped plugins): config is parsed
 * once and the cross-run state + job handle are captured in the closure.
 */
import { TOKENS } from '../../core/plugin';
import type { Plugin } from '../../core/plugin';
import { JobManager } from '@core/scheduling';
import { logError, logSystem } from '../../core/logger';
import { parseIdentitySyncConfig } from './config';
import { runIdentitySync, type IdentitySyncState } from './internal/sync';

const PLUGIN_ID = 'identity-sync';
const PLUGIN_VERSION = '1.0.0';
/** JobMap key for the daily re-check; cancelled on shutdown. */
const JOB_KEY = 'identity-sync:daily';

export const createIdentitySyncPlugin = (rawConfig: unknown): Plugin => {
  const config = parseIdentitySyncConfig(rawConfig);
  const state: IdentitySyncState = { lastSourceAvatarHash: null, fallbackApplied: false };
  let jobManager: JobManager | undefined;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    // Not critical: a failed identity sync must not abort the bot.
    critical: false,

    async onReady(ctx): Promise<void> {
      if (!config.enabled) {
        logSystem(ctx.logger, 'identity-sync disabled; not scheduling');
        return;
      }
      try {
        const client = ctx.resolve(TOKENS.DiscordClient);
        jobManager = new JobManager(ctx.resolve(TOKENS.JobMap));

        // Apply once now so the identity is correct immediately at boot.
        await runIdentitySync({ client, config, logger: ctx.logger }, state);

        // Daily re-check via the shared scheduler (cron from config).
        jobManager.scheduleRecurring(JOB_KEY, config.schedule, () =>
          runIdentitySync({ client, config, logger: ctx.logger }, state),
        );
        // node-schedule returns null for an invalid cron (its types claim
        // `Job`, so the compiler cannot catch it); read the stored value back
        // to detect it and warn rather than logging a false "scheduled". A
        // real Job is always truthy, so `!job` means null/undefined here.
        if (!jobManager.get(JOB_KEY)) {
          ctx.logger.warn(
            { plugin: PLUGIN_ID, schedule: config.schedule },
            'identity-sync: invalid cron schedule; daily re-check not scheduled',
          );
        } else {
          logSystem(ctx.logger, `identity-sync scheduled (${config.schedule})`);
        }
      } catch (err: unknown) {
        logError(ctx.logger, null, err);
      }
    },

    async onShutdown(): Promise<void> {
      jobManager?.cancel(JOB_KEY);
    },
  };
};

export type { IdentitySyncPluginConfig } from './config';
