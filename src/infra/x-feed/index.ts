/**
 * `infra/x-feed` barrel.
 *
 * The X (Twitter) timeline Strategy lives in the infra layer because
 * every member here is an outbound boundary: the source reads an
 * account's posts over HTTP and `error-translator` maps the failures
 * into the shared domain taxonomy. Discord-specific assembly (choosing
 * a channel, rendering, posting) belongs to the consuming
 * `src/plugins/x-media-feed/` plugin.
 */
export type {
  XPost,
  XPostMedia,
  XTimelineSource,
  XTimelineFetchOptions,
  XFeedFailure,
} from './types';

export { FxTwitterTimelineSource, type FxTwitterTimelineSourceOptions } from './fxtwitter-source';
export { translateXFeedError, invalidResponseError } from './error-translator';
