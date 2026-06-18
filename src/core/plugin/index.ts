/**
 * Plugin subsystem barrel.
 *
 * Layered code may import these contracts and the concrete host /
 * dispatcher / router from `@core/plugin` (this barrel). The IoC
 * container behind `PluginInitContext.resolve` stays inaccessible —
 * plugins receive typed-token access only, never the container itself.
 */
export type {
  Plugin,
  PluginId,
  PluginVersion,
  PluginDependency,
  PluginScope,
  PluginContributions,
  PluginEventSubscriptions,
  PluginEventContext,
  PluginInitContext,
  PluginStartContext,
  PluginRuntimeContext,
  PluginRuntimeServices,
  TypedResolver,
  RegisterInstance,
  ContributedRegistry,
  HandlerConstructor,
  JobDescriptor,
  LocaleNamespace,
  DisabledPlugin,
  InteractionContext,
  InteractionMiddleware,
} from './types';

export {
  PluginHost,
  PluginRegistrationError,
  CriticalPluginFailureError,
  DependencyDisabledError,
  DuplicateContributionError,
  type EffectiveRegistries,
  type PluginHostOptions,
} from './host';

export { mergeRegistries, type ContributionSource } from './registries';

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

/*
 * R3: plugin-facing window onto the IoC layer.
 *
 * Plugins must obtain TOKENS / ServiceToken / Resolver via this barrel
 * (`import { TOKENS } from '<path>/core/plugin'`) and never reach into
 * `core/ioc` directly. The container's write-side surface
 * (`ServiceContainer`, `createContainer`, the `token()` factory, container
 * error types) is intentionally NOT re-exported — those remain the
 * exclusive privilege of composition roots under `src/bot/**`.
 *
 * The lint rule `src/plugins/** -> no core/ioc` in `eslint.config.mjs`
 * enforces this contract; the four rule documents (CLAUDE.md,
 * CONTRIBUTING.md, project-conventions SKILL, coding-standards SKILL)
 * carry the verbatim policy paragraph.
 */
export { TOKENS } from '../ioc';
export type { ServiceToken, Resolver } from '../ioc';
