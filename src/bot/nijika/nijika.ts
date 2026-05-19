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
        // logic is the default `createDispatchMiddleware`. PR-G4 dropped
        // the `rebootJobs` callback config — plugins now resolve their
        // deps through `ctx` so the composition root no longer
        // deep-imports `plugins/*/internal`.
        this.use(AutoReplyPlugin);
        this.use(TtsReplyPlugin);
        this.use(createGuildEventsPlugin({
            blockedChannels: this.config.blocked_channels,
            clientId: this.clientId,
        }));
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
    }

    protected override channelLoggingBlockedChannels(): readonly string[] {
        return this.config.blocked_channels;
    }
}
