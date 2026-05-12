/**
 * State conflict — the resource exists in a state that makes the
 * requested operation invalid (e.g. duplicate whitelist entry, joining
 * a giveaway twice). The caller can usually recover by inspecting the
 * current state.
 */
import { DomainError, type DomainErrorInit } from './domain-error';

export type ConflictErrorCode = 'ALREADY_EXISTS' | 'ALREADY_JOINED' | 'ILLEGAL_STATE_TRANSITION';

export class ConflictError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<ConflictErrorCode, P> {
  public override readonly kind = 'ConflictError';
  public constructor(init: DomainErrorInit<ConflictErrorCode, P>) {
    super(init);
  }
}
