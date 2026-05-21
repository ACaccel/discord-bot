import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import { createMessageBackupPlugin } from '@plugins';

interface MsgArchiveConfig extends Config {
    backup_server: string[];
}

/**
 * MsgArchive composition root. The periodic-backup lifecycle (channel
 * collection, per-channel pagination, log file format, stale-Fetch-doc
 * cleanup) lives in {@link createMessageBackupPlugin}. This class
 * registers that plugin and suppresses the listener categories BaseBot
 * wires (interactions / reactions / guildCreate): msg-archive is a
 * worker bot and must not respond to any of them.
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
