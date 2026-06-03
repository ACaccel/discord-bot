import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import {
    AutoReplyPlugin,
    createActivityPlugin,
    createEarthquakePlugin,
    createGiveawayPlugin,
    createGuildEventsPlugin,
    createSocialLinkPreviewPlugin,
    createVoicePlugin,
} from '@plugins';

interface NijikaConfig extends Config {
    blocked_channels: string[];
    level_roles: Record<string, string>;
    /**
     * Raw `social_link_preview` block. Parsed and defaulted by the plugin
     * (see `createSocialLinkPreviewPlugin`), so it is intentionally
     * `unknown` here and may be omitted entirely.
     */
    social_link_preview?: unknown;
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
        // `helpMessage` is resolved from this key inside BaseBot.run()
        // once the translator is loaded.
        this.helpMessageKey = 'replies:nijika.help_message';

        // Plugin registration. `blocked_channels` flows through the
        // InteractionRouter via the `channelLoggingBlockedChannels`
        // hook below; dispatch uses the default
        // `createDispatchMiddleware`. Plugins resolve their
        // dependencies through `ctx`, so the composition root does not
        // deep-import `plugins/*/internal`.
        this.use(AutoReplyPlugin);
        this.use(createGuildEventsPlugin({
            blockedChannels: this.config.blocked_channels,
        }));
        // Social-link preview: detect share links, post a richer preview,
        // and suppress the user's original auto-embed. Reuses
        // `blocked_channels` so excluded channels never trigger a preview.
        this.use(createSocialLinkPreviewPlugin(this.config.social_link_preview, {
            blockedChannels: this.config.blocked_channels,
        }));
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
        // The earthquake webhook server + per-guild broadcast is a
        // bot-scoped plugin; its `start` hook owns the Express route.
        this.use(createEarthquakePlugin({ port: webhookPort }));
    }

    protected override channelLoggingBlockedChannels(): readonly string[] {
        return this.config.blocked_channels;
    }
}
