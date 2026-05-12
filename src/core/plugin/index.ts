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
  DuplicateContributionError,
  type EffectiveRegistries,
  type PluginHostOptions,
} from './host';

export { mergeRegistries, type ContributionSource } from './registries';

export { EventDispatcher } from './event-dispatcher';

export { InteractionRouter, DoubleNextError } from './interaction-router';
