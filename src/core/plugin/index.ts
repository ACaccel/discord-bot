/**
 * Plugin subsystem barrel.
 *
 * Layered code may import these contracts and the concrete host /
 * dispatcher / router from `@core/plugin` (this barrel). The IoC
 * container behind `PluginInitContext.resolve` stays inaccessible —
 * plugins receive typed-token access only, never the container itself.
 *
 * The token catalog is NOT re-exported here. It names concrete
 * `infra` / `persistence` / `plugins` types, so it lives with the
 * composition root at [src/bot/tokens.ts](../../bot/tokens.ts) and
 * plugins import it from there.
 */
export type {
  Plugin,
  PluginId,
  PluginVersion,
  PluginEventSubscriptions,
  PluginEventContext,
  PluginInitContext,
  PluginStartContext,
  PluginRuntimeContext,
  PluginRuntimeServices,
  TypedResolver,
  RegisterInstance,
  DisabledPlugin,
  InteractionContext,
  InteractionMiddleware,
} from './types';

export { PluginHost, PluginRegistrationError, type PluginHostOptions } from './host';

export { EventDispatcher } from './event-dispatcher';

export { InteractionRouter, DoubleNextError } from './interaction-router';

export type { GuildOnboardingPort, GuildOnboardingResult } from './guild-onboarding-port';

export { createPermissionRankPolicy, RANKED_FEATURES } from './permission-rank-policy';
export type {
  PermissionRankPolicy,
  RankedFeature,
  Rank,
  PermissionRankConfig,
} from './permission-rank-policy';
