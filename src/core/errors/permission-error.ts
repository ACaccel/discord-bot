/**
 * The caller is authenticated but lacks the privilege required for the
 * operation (admin-only command, whitelist member-only command, etc.).
 */
import { DomainError, type DomainErrorInit } from './domain-error';

export type PermissionErrorCode = 'PERMISSION_DENIED' | 'NOT_WHITELISTED' | 'ADMIN_ONLY';

export class PermissionError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<PermissionErrorCode, P> {
  public override readonly kind = 'PermissionError';
  public constructor(init: DomainErrorInit<PermissionErrorCode, P>) {
    super(init);
  }
}
