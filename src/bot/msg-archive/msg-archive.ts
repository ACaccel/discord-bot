import { Client } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { createMessageBackupPlugin } from '@plugins';

interface MsgArchiveConfig extends Config {
    backup_server: string[];
}

/**
 * MsgArchive composition root. Phase 4b-3 moved the periodic-backup
 * lifecycle (channel collection, per-channel pagination, log file
 * format, stale-Fetch-doc cleanup) into
 * {@link createMessageBackupPlugin}. This class now only registers
 * the plugin and suppresses the listener categories BaseBot still
 * wires (interactions / reactions / guildCreate) — Konata is a chat
 * bot, msg-archive is a worker; it must not respond to either.
 */
export class MsgArchive extends BaseBot<MsgArchiveConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: MsgArchiveConfig) {
        super(client, token, mongoURI, clientId, config);
        this.use(createMessageBackupPlugin({ backupServers: this.config.backup_server }));
    }

    public override interactionEventListener = async (): Promise<void> => {};
    public override messageReactionAddListener = async (): Promise<void> => {};
    public override messageReactionRemoveListener = async (): Promise<void> => {};
    public override guildCreateListener = async (): Promise<void> => {};
}
