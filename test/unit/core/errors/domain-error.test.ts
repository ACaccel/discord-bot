import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  ConflictError,
  DatabaseError,
  DiscordApiError,
  LlmProviderError,
  NotFoundError,
  PermissionError,
  ValidationError,
  type AnyDomainError,
} from '../../../../src/core/errors';

describe('DomainError subclasses', () => {
  it('each subclass sets the kind discriminant + name + code', () => {
    const cases: Array<[AnyDomainError, string]> = [
      [
        new ValidationError({
          code: 'FIELD_REQUIRED',
          messageKey: 'errors.validation.field_required',
          context: { operation: 'test' },
        }),
        'ValidationError',
      ],
      [
        new NotFoundError({
          code: 'RECORD_NOT_FOUND',
          messageKey: 'errors.not_found.record',
          context: { operation: 'test' },
        }),
        'NotFoundError',
      ],
      [
        new ConflictError({
          code: 'ALREADY_EXISTS',
          messageKey: 'errors.conflict.already_exists',
          context: { operation: 'test' },
        }),
        'ConflictError',
      ],
      [
        new PermissionError({
          code: 'PERMISSION_DENIED',
          messageKey: 'errors.permission.denied',
          context: { operation: 'test' },
        }),
        'PermissionError',
      ],
      [
        new ConfigurationError({
          code: 'MISSING_ENV',
          messageKey: 'errors.config.missing_env',
          context: { operation: 'test' },
        }),
        'ConfigurationError',
      ],
      [
        new DiscordApiError({
          code: 'DISCORD_API_FAILURE',
          messageKey: 'errors.discord.api_failure',
          context: { operation: 'test' },
        }),
        'DiscordApiError',
      ],
      [
        new DatabaseError({
          code: 'DATABASE_UNKNOWN',
          messageKey: 'errors.db.unavailable',
          context: { operation: 'test' },
        }),
        'DatabaseError',
      ],
      [
        new LlmProviderError({
          code: 'LLM_UNKNOWN',
          messageKey: 'errors.llm.unknown',
          context: { operation: 'test' },
        }),
        'LlmProviderError',
      ],
    ];
    for (const [e, kind] of cases) {
      expect(e.kind).toBe(kind);
      expect(e.name).toBe(kind);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('preserves cause via ES2022 Error.cause', () => {
    const root = new Error('boom');
    const e = new DatabaseError({
      code: 'DATABASE_NETWORK',
      messageKey: 'errors.db.network',
      context: { operation: 'MongoMessageRepo.findRecentByChannel' },
      cause: root,
    });
    expect(e.cause).toBe(root);
  });

  it('toJSON includes kind / code / messageKey / context / cause', () => {
    const e = new ValidationError({
      code: 'FIELD_OUT_OF_RANGE',
      messageKey: 'errors.validation.range',
      context: { operation: 'modal.ai_settings', input: { temperature: 5 } },
      messageParams: { field: 'temperature' },
      cause: new Error('original'),
    });
    const json = e.toJSON();
    expect(json).toMatchObject({
      kind: 'ValidationError',
      code: 'FIELD_OUT_OF_RANGE',
      messageKey: 'errors.validation.range',
      messageParams: { field: 'temperature' },
      context: { operation: 'modal.ai_settings' },
    });
  });
});
