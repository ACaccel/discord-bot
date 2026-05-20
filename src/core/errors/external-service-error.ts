/**
 * Failure originating outside the bot process — Discord API, MongoDB
 * cluster, an LLM provider, etc. Use one of the typed subclasses
 * ({@link DiscordApiError}, {@link DatabaseError}, {@link LlmProviderError})
 * so consumers can match on the boundary they care about.
 *
 * Direct instantiation of `ExternalServiceError` is allowed but
 * discouraged: prefer one of the subclasses below so logs carry the
 * `kind` discriminant readers expect.
 */
import { DomainError, type DomainErrorInit } from './domain-error';

export type ExternalServiceErrorCode =
  | 'EXTERNAL_SERVICE_FAILURE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE';

export class ExternalServiceError<
  Code extends string = ExternalServiceErrorCode,
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<Code, P> {
  public override readonly kind: string = 'ExternalServiceError';
  public constructor(init: DomainErrorInit<Code, P>) {
    super(init);
  }
}

/** Discord API surfaced an error response or a connection failure. */
export type DiscordApiErrorCode =
  | 'DISCORD_API_FAILURE'
  | 'DISCORD_RATE_LIMITED'
  | 'DISCORD_TIMEOUT'
  | 'DISCORD_PERMISSION_MISSING'
  | 'DISCORD_INTERACTION_EXPIRED';

export class DiscordApiError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends ExternalServiceError<DiscordApiErrorCode, P> {
  public override readonly kind = 'DiscordApiError';
  public constructor(init: DomainErrorInit<DiscordApiErrorCode, P>) {
    super(init);
  }
}

/**
 * MongoDB / Mongoose interaction failed. Sub-code drives retry policy
 * downstream: `DUPLICATE_KEY` is rarely retryable, `TIMEOUT` /
 * `NETWORK` are retryable with backoff, `UNKNOWN` is logged and
 * surfaced to the user as a generic failure.
 *
 * The mongoose-shape → sub-code translation lives in
 * `src/persistence/error-translator.ts` (per Phase-3 design: this
 * class stays free of mongoose imports; relocated from
 * `infra/mongo/` in gap G-2).
 */
export type DatabaseErrorCode =
  | 'DATABASE_DUPLICATE_KEY'
  | 'DATABASE_TIMEOUT'
  | 'DATABASE_NETWORK'
  | 'DATABASE_VALIDATION'
  | 'DATABASE_UNKNOWN';

export class DatabaseError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends ExternalServiceError<DatabaseErrorCode, P> {
  public override readonly kind = 'DatabaseError';
  public constructor(init: DomainErrorInit<DatabaseErrorCode, P>) {
    super(init);
  }
}

/** LLM provider (OpenAI / Anthropic / Gemini) failure. */
export type LlmProviderErrorCode =
  | 'LLM_RATE_LIMITED'
  | 'LLM_INVALID_API_KEY'
  | 'LLM_CONTEXT_TOO_LONG'
  | 'LLM_UPSTREAM_5XX'
  | 'LLM_TIMEOUT'
  | 'LLM_UNKNOWN';

export class LlmProviderError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends ExternalServiceError<LlmProviderErrorCode, P> {
  public override readonly kind = 'LlmProviderError';
  public constructor(init: DomainErrorInit<LlmProviderErrorCode, P>) {
    super(init);
  }
}
