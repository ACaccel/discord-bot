import type { Client } from 'discord.js';

import type { Config } from '@bot';
import { BaseBot } from '@bot';
import type { ClientEventBridgeSuppression } from '../client-event-bridge';
import { createMessageBackupPlugin } from '@plugins';

interface MsgArchiveConfig extends Config {
    backup_server: string[];
}

/**
 * MsgArchive composition root. The periodic-backup lifecycle (channel
 * collection, per-channel pagination, log file format, stale-Fetch-doc
 * cleanup) lives in {@link createMessageBackupPlugin}. This class
 * registers that plugin and suppresses every interactive listener
 * category through the R1 `eventBridgeSuppression` hook: msg-archive
 * is a worker bot and must not respond to interactions, reactions, or
 * the guildCreate onboarding flow.
 */
export class MsgArchive extends BaseBot<MsgArchiveConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: MsgArchiveConfig) {
        super(client, token, mongoURI, clientId, config);
        this.use(createMessageBackupPlugin({ backupServers: this.config.backup_server }));
    }

    protected override eventBridgeSuppression(): ClientEventBridgeSuppression {
        return { interaction: true, reaction: true, guildCreate: true };
    }
}
