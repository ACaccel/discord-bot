import type { Client } from 'discord.js';

import type { Config } from '@bot';
import { BaseBot } from '@bot';
import type { ClientEventBridgeSuppression } from '../client-event-bridge';
import { createMessageBackupPlugin } from '@plugins';

interface MsgArchiveConfig extends Config {
  backup_server: string[];
  /**
   * Minutes between repeat backup passes. Optional — omit to keep the
   * default one-hour cadence owned by `createMessageBackupPlugin`.
   */
  backup_interval_minutes?: number;
  /**
   * Whether each backup pass writes its per-guild transcript to
   * `logs/backup/`. Optional — defaults to `false`. The backup itself always
   * runs; this only gates the transcript log file.
   */
  backup_log_enabled?: boolean;
}

const MINUTE_MS = 60 * 1000;

/**
 * MsgArchive composition root. The periodic-backup lifecycle (channel
 * collection, per-channel pagination, log file format, stale-Fetch-doc
 * cleanup) lives in {@link createMessageBackupPlugin}. This class
 * registers that plugin and suppresses every interactive listener
 * category through the `eventBridgeSuppression` hook: msg-archive
 * is a worker bot and must not respond to interactions, reactions, or
 * the guildCreate onboarding flow.
 */
export class MsgArchive extends BaseBot<MsgArchiveConfig> {
  public constructor(
    client: Client,
    token: string,
    mongoURI: string,
    clientId: string,
    config: MsgArchiveConfig,
  ) {
    super(client, token, mongoURI, clientId, config);
    const intervalMinutes = this.config.backup_interval_minutes;
    this.use(
      createMessageBackupPlugin({
        backupServers: this.config.backup_server,
        backupLogEnabled: this.config.backup_log_enabled ?? false,
        ...(intervalMinutes !== undefined ? { backupIntervalMs: intervalMinutes * MINUTE_MS } : {}),
      }),
    );
  }

  protected override eventBridgeSuppression(): ClientEventBridgeSuppression {
    return { interaction: true, reaction: true, guildCreate: true };
  }
}
