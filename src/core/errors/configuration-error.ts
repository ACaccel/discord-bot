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
  | 'UNSUPPORTED_FEATURE';

export class ConfigurationError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<ConfigurationErrorCode, P> {
  public override readonly kind = 'ConfigurationError';
  public constructor(init: DomainErrorInit<ConfigurationErrorCode, P>) {
    super(init);
  }
}
