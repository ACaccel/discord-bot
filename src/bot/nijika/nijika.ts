import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import {
    AutoReplyPlugin,
    TtsReplyPlugin,
    createActivityPlugin,
    createGiveawayPlugin,
    createGuildEventsPlugin,
    createVoicePlugin,
} from '@plugins';
// Direct deep imports into the relocated feature internals — only
// composition roots cross the plugin/internal layer line, and only
// to thread the reboot closure into the plugin factories. The plugin
// itself stays internal-blind so its module remains free of legacy
// `@utils` / `@bot` dependencies in strict-mode typecheck.
import { rebootActivityJobs } from '../../plugins/activity/internal';
import { rebootGiveawayJobs } from '../../plugins/giveaway/internal';

interface NijikaConfig extends Config {
    blocked_channels: string[];
    level_roles: Record<string, string>;
}

export class Nijika extends BaseBot<NijikaConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: NijikaConfig) {
        super(client, token, mongoURI, clientId, config);
        // help_msg is resolved from this key inside BaseBot.run() after
        // the translator is loaded — see audit 3.4.
        this.helpMessageKey = 'replies:nijika.help_message';

        // Phase 4b plugin registration. Audit B-2 removed the previous
        // `interactionEventListener` override: blocked_channels now
        // flows through the InteractionRouter via the
        // `channelLoggingBlockedChannels` hook below, and the dispatch
        // logic is the default `createDispatchMiddleware`.
        this.use(AutoReplyPlugin);
        this.use(TtsReplyPlugin);
        this.use(createGuildEventsPlugin({
            blockedChannels: this.config.blocked_channels,
            clientId: this.clientId,
        }));
        this.use(createGiveawayPlugin({ rebootJobs: () => rebootGiveawayJobs(this) }));
        this.use(createActivityPlugin({ rebootJobs: () => rebootActivityJobs(this) }));
        this.use(createVoicePlugin());
    }

    protected override channelLoggingBlockedChannels(): readonly string[] {
        return this.config.blocked_channels;
    }
}
