/**
 * The failure raised when a member names a platform this bot has no
 * adapter for.
 *
 * A `FeedError` rather than a hand-rendered reply, so the refusal takes
 * the same route as every other boundary failure: `replyForError`
 * renders its `messageKey` for the user *and* writes the operator log
 * line. An operator who forgot a `social_feed.platforms` block would
 * otherwise only ever hear about it from a member.
 */
import { FeedError } from '../../../core/errors';
import {
  FEED_PLATFORM_DISPLAY_NAMES,
  SUPPORTED_FEED_PLATFORMS,
  type FeedPlatformId,
} from '../../../infra/social-feed';

const isSupportedPlatform = (id: string): id is FeedPlatformId =>
  (SUPPORTED_FEED_PLATFORMS as readonly string[]).includes(id);

/**
 * How to spell a platform that has no adapter to ask for its own
 * display name.
 *
 * A shipped-but-unconfigured platform still gets its proper name from
 * the shared map, so the refusal reads the same as every other message
 * about it. Anything else — only reachable if Discord sends a value
 * outside the declared choices — echoes the raw id, which is more
 * useful to whoever has to explain it than a blank.
 */
export const feedPlatformDisplayName = (id: string): string =>
  isSupportedPlatform(id) ? FEED_PLATFORM_DISPLAY_NAMES[id] : id;

export const platformNotConfiguredError = (id: string): FeedError<{ platform: string }> =>
  new FeedError({
    code: 'FEED_PLATFORM_NOT_CONFIGURED',
    messageKey: 'errors:feed.platform_not_configured',
    messageParams: { platform: feedPlatformDisplayName(id) },
    context: { operation: 'feed_subscribe', input: { platform: id } },
  });
