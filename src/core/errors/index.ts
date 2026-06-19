/**
 * Domain error barrel. Consumers import named subclasses from here:
 *
 *   import { DatabaseError, ValidationError } from '@core/errors';
 *
 * The `AnyDomainError` union is the discriminant type for code that
 * needs to switch on `kind`. Add new subclasses to this file when they
 * land — `kind` strings must stay unique.
 */
import type { ConfigurationError } from './configuration-error';
import type { ConflictError } from './conflict-error';
import type {
  DiscordApiError,
  DatabaseError,
  LlmProviderError,
  LinkPreviewError,
} from './external-service-error';
import type { NotFoundError } from './not-found-error';
import type { PermissionError } from './permission-error';
import type { ValidationError } from './validation-error';

export type { ErrorContext } from './error-context';
export { isTransientNetworkError } from './transient-network-error';
export { DomainError, type DomainErrorInit } from './domain-error';
export { ValidationError, type ValidationErrorCode } from './validation-error';
export { NotFoundError, type NotFoundErrorCode } from './not-found-error';
export { ConflictError, type ConflictErrorCode } from './conflict-error';
export { PermissionError, type PermissionErrorCode } from './permission-error';
export { ConfigurationError, type ConfigurationErrorCode } from './configuration-error';
export {
  ExternalServiceError,
  type ExternalServiceErrorCode,
  DiscordApiError,
  type DiscordApiErrorCode,
  DatabaseError,
  type DatabaseErrorCode,
  LlmProviderError,
  type LlmProviderErrorCode,
  LinkPreviewError,
  type LinkPreviewErrorCode,
} from './external-service-error';

/**
 * Discriminated union of every concrete `DomainError`. Use to type a
 * Result's error channel when the caller is happy to handle any of
 * them; narrow via `err.kind`.
 */
export type AnyDomainError =
  | ValidationError
  | NotFoundError
  | ConflictError
  | PermissionError
  | ConfigurationError
  | DiscordApiError
  | DatabaseError
  | LlmProviderError
  | LinkPreviewError;
