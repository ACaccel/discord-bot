import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import {
    AutoReplyPlugin,
    createActivityPlugin,
    createGiveawayPlugin,
    createGuildEventsPlugin,
    createVoicePlugin,
} from '@plugins';

interface TomoriConfig extends Config {
    /**
     * Channel ids whose `messageUpdate` / `messageDelete` events the
     * guild-events mirror must suppress, and which the interaction
     * channel-logging middleware skips. Optional because a deployment's
     * `config.json` may omit it; defaults to "mirror everything".
     */
    blocked_channels?: string[];
}

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Tomori opts into auto-reply, guild-event mirroring, giveaway,
        // activity and voice behaviour by registering the corresponding
        // plugins explicitly. Plugins resolve their dependencies through
        // `ctx`, so the composition root does not deep-import
        // `plugins/*/internal`.
        //
        // `guild-events` is what subscribes to `messageUpdate` /
        // `messageDelete` / `guildMemberUpdate` / `guildCreate`; without
        // it the ClientEventBridge never wires those Discord events and
        // no audit log / channel mirror is produced.
        this.use(AutoReplyPlugin);
        this.use(createGuildEventsPlugin({
            blockedChannels: this.config.blocked_channels ?? [],
        }));
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
    }

    protected override channelLoggingBlockedChannels(): readonly string[] {
        return this.config.blocked_channels ?? [];
    }
}
