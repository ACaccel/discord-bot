/**
 * Startup-time configuration is missing or malformed. Always fail-fast:
 * the process should exit ≠ 0 so the supervisor restarts and ops sees
 * the failure immediately. Never thrown from a runtime hot path.
 */
import { DomainError, type DomainErrorInit } from './domain-error';

export type ConfigurationErrorCode =
  | 'MISSING_ENV'
  | 'INVALID_ENV'
  | 'INVALID_CONFIG_JSON'
  | 'UNSUPPORTED_FEATURE'
  /**
   * A plugin called `PluginInitContext.registerInstance` outside the
   * `init` phase. Raised by the lifecycle runner's stage guard; see
   * `core/plugin/host/lifecycle.ts`. Reused rather than promoted to a
   * dedicated error subclass because the violation is a startup-time
   * composition bug, equivalent in severity to the existing
   * `INVALID_CONFIG_JSON` / `MISSING_ENV` family.
   */
  | 'LIFECYCLE_PHASE_VIOLATION'
  /**
   * `client.login()` rejected (invalid token, network failure, Discord
   * outage). Raised by {@link BaseBot.login} so {@link BaseBot.run}
   * rejects rather than silently entering a half-started state.
   */
  | 'BOT_LOGIN_FAILED'
  /**
   * `client.login()` resolved but `client.user` was still unset, meaning
   * the gateway handshake did not complete the way Discord.js usually
   * guarantees. Treated as a fatal startup failure.
   */
  | 'BOT_LOGIN_NO_USER';

export class ConfigurationError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<ConfigurationErrorCode, P> {
  public override readonly kind = 'ConfigurationError';
  public constructor(init: DomainErrorInit<ConfigurationErrorCode, P>) {
    super(init);
  }
}
