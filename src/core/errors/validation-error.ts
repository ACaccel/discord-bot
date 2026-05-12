/**
 * User-provided input failed a validation rule. Use for slash-command
 * option values, modal field values, parsed config, etc. — anything
 * the user can correct by sending the request again.
 */
import { DomainError, type DomainErrorInit } from './domain-error';

export type ValidationErrorCode =
  | 'FIELD_REQUIRED'
  | 'FIELD_OUT_OF_RANGE'
  | 'FIELD_INVALID_FORMAT'
  | 'FIELD_TOO_LONG'
  | 'FIELD_TOO_SHORT';

export class ValidationError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<ValidationErrorCode, P> {
  public override readonly kind = 'ValidationError';
  public constructor(init: DomainErrorInit<ValidationErrorCode, P>) {
    super(init);
  }
}
