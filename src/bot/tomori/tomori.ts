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

// Tomori adds no fields beyond the base `Config`. Channel suppression for
// guild-events / channel-logging now comes from the per-guild
// `permission_rank` block (see `GuildConfig.permission_rank`), resolved via
// `TOKENS.PermissionRankPolicy`, rather than a personality-level list.
type TomoriConfig = Config;

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Intro paragraph rendered at the top of the `/help` embed; the
        // key is resolved once the translator is loaded (see BaseBot.run).
        this.helpMessageKey = 'replies:tomori.help_message';
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
        this.use(createGuildEventsPlugin());
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
    }
}
