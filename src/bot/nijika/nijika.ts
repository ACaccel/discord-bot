import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import {
  createAutoReplyPlugin,
  createActivityPlugin,
  createEarthquakePlugin,
  createGiveawayPlugin,
  createGuildEventsPlugin,
  createSocialLinkPreviewPlugin,
  createTempRolePlugin,
  createVoicePlugin,
  createXMediaFeedPlugin,
} from '@plugins';

interface NijikaConfig extends Config {
  level_roles: Record<string, string>;
  /**
   * Raw `auto_reply` block. Parsed and defaulted by the plugin
   * (see `createAutoReplyPlugin`), so it is intentionally `unknown`
   * here and may be omitted entirely.
   */
  auto_reply?: unknown;
  /**
   * Raw `social_link_preview` block. Parsed and defaulted by the plugin
   * (see `createSocialLinkPreviewPlugin`), so it is intentionally
   * `unknown` here and may be omitted entirely.
   */
  social_link_preview?: unknown;
  /**
   * Raw `x_media_feed` block. Parsed and defaulted by the plugin
   * (see `createXMediaFeedPlugin`), so it is intentionally `unknown`
   * here and may be omitted entirely.
   */
  x_media_feed?: unknown;
  /**
   * Raw `guild_events` block. Parsed and defaulted by the plugin
   * (see `createGuildEventsPlugin`), so it is intentionally `unknown`
   * here and may be omitted entirely.
   */
  guild_events?: unknown;
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
    this.use(createAutoReplyPlugin(this.config.auto_reply));
    this.use(createGuildEventsPlugin(this.config.guild_events));
    // Social-link preview: detect share links, post a richer preview,
    // and suppress the user's original auto-embed.
    this.use(createSocialLinkPreviewPlugin(this.config.social_link_preview));
    this.use(createGiveawayPlugin());
    this.use(createActivityPlugin());
    // Temporary, permission-less notification roles with a self-claim
    // button and a hard 30-day expiry (see `createTempRolePlugin`).
    this.use(createTempRolePlugin());
    this.use(createVoicePlugin());
    // Polls the configured X (Twitter) accounts and forwards their new
    // image / video posts to the guild's feed channel.
    this.use(createXMediaFeedPlugin(this.config.x_media_feed));
    // The earthquake webhook server + per-guild broadcast is a
    // bot-scoped plugin; its `start` hook owns the Express route.
    this.use(createEarthquakePlugin({ port: webhookPort }));
  }
}
