/**
 * Public error types for the plugin host. Extracted from the monolithic
 * `host.ts` so the topology and lifecycle modules can import them
 * without pulling in the host class itself (audit C-8 split).
 */
import type { DisabledPlugin, PluginId } from '../types';

/** Throws during `PluginHost.register()` and during topological resolution. */
export class PluginRegistrationError extends Error {
  public override readonly name = 'PluginRegistrationError';
  public readonly pluginId: PluginId | undefined;
  public readonly reason:
    | 'DUPLICATE_ID'
    | 'INVALID_CONFIG'
    | 'UNSUPPORTED_SCOPE'
    | 'MISSING_DEPENDENCY'
    | 'CIRCULAR_DEPENDENCY';

  constructor(reason: PluginRegistrationError['reason'], message: string, pluginId?: PluginId) {
    super(message);
    this.reason = reason;
    this.pluginId = pluginId;
  }
}

/** Thrown when a `critical: true` plugin fails during init / start. */
export class CriticalPluginFailureError extends Error {
  public override readonly name = 'CriticalPluginFailureError';
  public readonly pluginId: PluginId;
  public readonly phase: DisabledPlugin['phase'];
  public override readonly cause: unknown;

  constructor(pluginId: PluginId, phase: DisabledPlugin['phase'], cause: unknown) {
    super(
      `CriticalPluginFailureError: plugin "${pluginId}" failed during ${phase}; rethrown because critical=true.`,
      { cause },
    );
    this.pluginId = pluginId;
    this.phase = phase;
    this.cause = cause;
  }
}

/**
 * Thrown by the host (not by the failing plugin) when a plugin is
 * disabled as a transitive consequence of one of its dependencies
 * failing. `rootPluginId` names the original failure; the cascade
 * victim's own hook never ran.
 */
export class DependencyDisabledError extends Error {
  public override readonly name = 'DependencyDisabledError';
  public readonly pluginId: PluginId;
  public readonly rootPluginId: PluginId;
  public override readonly cause: unknown;
  constructor(pluginId: PluginId, rootPluginId: PluginId, rootCause: unknown) {
    super(
      `DependencyDisabledError: plugin "${pluginId}" was disabled because its dependency "${rootPluginId}" failed; ${pluginId}'s lifecycle hooks did not run.`,
      { cause: rootCause },
    );
    this.pluginId = pluginId;
    this.rootPluginId = rootPluginId;
    this.cause = rootCause;
  }
}
