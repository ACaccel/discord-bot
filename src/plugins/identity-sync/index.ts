/**
 * Identity-sync plugin barrel. Surfaces the factory + config type; the
 * apply routine stays under `internal/`.
 */
export { createIdentitySyncPlugin, type IdentitySyncPluginConfig } from './plugin';
