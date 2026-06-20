/**
 * Per-guild execution with failure isolation.
 *
 * Runs `perGuild` for each guild id in order, catching errors so one
 * guild's failure (auth error, unreachable shard) never aborts the rest
 * of the fleet. Each attempt becomes a {@link GuildOutcome}; the caller
 * derives its report and exit code from the aggregate. Outcome order
 * matches the input order.
 */
import type { Logger } from '../../../src/core/logger';

/** The result of attempting one guild: success carries `result`, failure carries `error`. */
export interface GuildOutcome<R> {
  readonly guildId: string;
  readonly ok: boolean;
  readonly result: R | null;
  readonly error: string | null;
}

export const runPerGuild = async <R>(
  guilds: readonly string[],
  perGuild: (guildId: string) => Promise<R>,
  logger: Logger,
  component: string,
): Promise<readonly GuildOutcome<R>[]> => {
  const outcomes: GuildOutcome<R>[] = [];
  for (const guildId of guilds) {
    try {
      const result = await perGuild(guildId);
      outcomes.push({ guildId, ok: true, result, error: null });
      logger.info({ guildId, result }, `${component}: guild done`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      outcomes.push({ guildId, ok: false, result: null, error });
      logger.error({ guildId, error }, `${component}: guild failed`);
    }
  }
  return outcomes;
};
