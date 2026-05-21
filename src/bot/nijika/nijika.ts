import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import {
    AutoReplyPlugin,
    TtsReplyPlugin,
    createActivityPlugin,
    createEarthquakePlugin,
    createGiveawayPlugin,
    createGuildEventsPlugin,
    createVoicePlugin,
} from '@plugins';

interface NijikaConfig extends Config {
    blocked_channels: string[];
    level_roles: Record<string, string>;
}

export class Nijika extends BaseBot<NijikaConfig> {
    /**
     * @param webhookPort - TCP port for the earthquake-alert webhook
     *   server. Sourced from the validated `Env.PORT` in `index.ts`;
     *   passed through the constructor (rather than read from
     *   `process.env` here) so the composition root stays the single
     *   place that touches the environment.
     */
    public constructor(
        client: Client,
        token: string,
        mongoURI: string,
        clientId: string,
        config: NijikaConfig,
        webhookPort: number,
    ) {
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
        // Gap D2: the earthquake webhook server + per-guild broadcast
        // is now a bot-scoped plugin. Its `start` hook owns the Express
        // route that previously lived inline in `index.ts`.
        this.use(createEarthquakePlugin({ port: webhookPort }));
    }

    protected override channelLoggingBlockedChannels(): readonly string[] {
        return this.config.blocked_channels;
    }
}
