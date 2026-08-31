/**
 * `x-media-feed` plugin barrel.
 *
 * Only the factory, its dependency seam, and the config types surface
 * here; the poll pass and its helpers stay behind `internal/`.
 */
export { createXMediaFeedPlugin } from './plugin';
