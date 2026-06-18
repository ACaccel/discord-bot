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

        // Plugin registration. Channel suppression (which channels each
        // feature acts on) is resolved from the per-guild `permission_rank`
        // config via `TOKENS.PermissionRankPolicy`; the composition root no
        // longer threads a channel list in. Plugins resolve their
        // dependencies through `ctx`, so the composition root does not
        // deep-import `plugins/*/internal`.
        this.use(AutoReplyPlugin);
        this.use(createGuildEventsPlugin());
        // Social-link preview: detect share links, post a richer preview,
        // and suppress the user's original auto-embed.
        this.use(createSocialLinkPreviewPlugin(this.config.social_link_preview));
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
        // The earthquake webhook server + per-guild broadcast is a
        // bot-scoped plugin; its `start` hook owns the Express route.
        this.use(createEarthquakePlugin({ port: webhookPort }));
    }
}
