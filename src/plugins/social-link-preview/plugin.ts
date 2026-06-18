/**
 * SocialLinkPreviewPlugin — a `messageCreate` subscriber that detects
 * social-media share links (Twitter/X, Instagram, Threads, Facebook,
 * Bahamut), posts a better preview, and suppresses the user's original
 * auto-preview.
 *
 * Hybrid mechanism (see `src/infra/link-preview/`): video-capable
 * sources are rewritten to an embed-proxy domain so Discord unfurls a
 * playable video; sources without a proxy (Bahamut) are scraped for
 * OpenGraph and rendered as a static embed. The provider framework is
 * extensible — adding a source is one provider file plus one registry
 * line, with no change here.
 *
 * Factory pattern (mirrors `createLlmAutoReplyPlugin`): per-bot settings
 * are parsed once and the provider registry is captured in the closure,
 * so the returned object is pure data. Channel suppression is resolved
 * per-event from the {@link PermissionRankPolicy} (the `social_preview`
 * feature; its default ceiling is unbounded, so previews fire everywhere
 * unless an operator sets a finite ceiling). `deps` exposes an injectable
 * `registry` seam for deterministic tests.
 *
 * Not critical: a preview failure must never abort the bot, and the
 * event handler swallows every error so a bad link cannot break the
 * channel.
 */
import { logError } from '../../core/logger';
import type { Plugin } from '../../core/plugin';
import { TOKENS } from '../../core/plugin';
import { parentChannelIdOf } from '../../infra/discord';
import {
  createDefaultLinkPreviewRegistry,
  type LinkPreviewProviderRegistry,
} from '../../infra/link-preview';
import { parseSocialLinkPreviewConfig } from './config';
import { runSocialLinkPreview } from './internal/orchestrator';

const PLUGIN_ID = 'social-link-preview';
const PLUGIN_VERSION = '1.0.0';

/** Optional collaborators wired by the composition root / tests. */
export interface CreateSocialLinkPreviewDeps {
  /** Provider registry; injectable so tests can supply fakes without the network. */
  readonly registry?: LinkPreviewProviderRegistry;
}

export const createSocialLinkPreviewPlugin = (
  rawConfig: unknown,
  deps: CreateSocialLinkPreviewDeps = {},
): Plugin => {
  const config = parseSocialLinkPreviewConfig(rawConfig);
  const registry =
    deps.registry ??
    createDefaultLinkPreviewRegistry({
      twitterProxyHosts: config.twitterProxyHosts,
      instagramProxyHosts: config.instagramProxyHosts,
      threadsProxyHosts: config.threadsProxyHosts,
      facebookProxyHosts: config.facebookProxyHosts,
      redditProxyHosts: config.redditProxyHosts,
      enabledProviders: config.providers,
    });

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    events: {
      messageCreate: async (ctx, message): Promise<void> => {
        if (!config.enabled) return;
        if (message.author.bot) return; // self-loop + bot-feedback guard
        if (message.guildId === null) return; // guild-only
        // Channels above the social_preview rank ceiling are suppressed.
        // Default ceiling is unbounded, so this is a no-op unless an operator
        // sets a finite `social_preview.maxChannelRank`.
        if (
          ctx
            .resolve(TOKENS.PermissionRankPolicy)
            .isSuppressed(
              message.guildId,
              'social_preview',
              message.channelId,
              parentChannelIdOf(message.channel),
            )
        ) {
          return;
        }
        if (!message.channel.isSendable()) return;

        try {
          await runSocialLinkPreview(
            { registry, config, translator: ctx.translator, logger: ctx.logger },
            message,
          );
        } catch (err: unknown) {
          // Inner code already swallows per-URL failures; this is the
          // belt-and-suspenders guard for anything unexpected.
          logError(ctx.logger, message.guildId, err);
        }
      },
    },
  };
};

export type { SocialLinkPreviewPluginConfig } from './config';
