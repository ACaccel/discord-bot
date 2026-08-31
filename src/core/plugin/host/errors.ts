/**
 * Public error types for the plugin host. Kept separate from `host.ts`
 * so the lifecycle module can import them without pulling in the host
 * class itself.
 */
import type { PluginId } from '../types';

/** Thrown during `PluginHost.register()`. */
export class PluginRegistrationError extends Error {
  public override readonly name = 'PluginRegistrationError';
  public readonly pluginId: PluginId | undefined;
  public readonly reason: 'DUPLICATE_ID';

  constructor(reason: PluginRegistrationError['reason'], message: string, pluginId?: PluginId) {
    super(message);
    this.reason = reason;
    this.pluginId = pluginId;
  }
}
