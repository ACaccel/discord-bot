import { describe, expect, it } from 'vitest';

import { translateProviderError } from '../../../../src/infra/llm/error-translator';

describe('translateProviderError', () => {
  it('classifies HTTP 429 as LLM_RATE_LIMITED regardless of provider', () => {
    for (const provider of ['openai', 'anthropic', 'gemini', 'xai'] as const) {
      const err = translateProviderError(provider, 'X.chat', {
        status: 429,
        message: 'rate limited',
      });
      expect(err.code).toBe('LLM_RATE_LIMITED');
      expect(err.context.operation).toBe('X.chat');
      expect(err.context['input']).toMatchObject({ provider, status: 429 });
    }
  });

  it('classifies HTTP 401 / 403 as LLM_INVALID_API_KEY', () => {
    expect(
      translateProviderError('openai', 'X.chat', { status: 401, message: 'bad key' }).code,
    ).toBe('LLM_INVALID_API_KEY');
    expect(
      translateProviderError('openai', 'X.chat', { status: 403, message: 'forbidden' }).code,
    ).toBe('LLM_INVALID_API_KEY');
  });

  it('classifies HTTP 5xx as LLM_UPSTREAM_5XX', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(
        translateProviderError('openai', 'X.chat', { status, message: 'upstream down' }).code,
      ).toBe('LLM_UPSTREAM_5XX');
    }
  });

  it('classifies HTTP 400 + context_length_exceeded code as LLM_CONTEXT_TOO_LONG', () => {
    const err = translateProviderError('openai', 'X.chat', {
      status: 400,
      error: { code: 'context_length_exceeded', message: 'too long' },
    });
    expect(err.code).toBe('LLM_CONTEXT_TOO_LONG');
  });

  it('classifies HTTP 400 + Anthropic-style invalid_request_error with context-length message as LLM_CONTEXT_TOO_LONG', () => {
    const err = translateProviderError('anthropic', 'X.chat', {
      status: 400,
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: maximum context length exceeded',
      },
    });
    expect(err.code).toBe('LLM_CONTEXT_TOO_LONG');
  });

  it('classifies provider-specific rate_limit_error type even when status is missing', () => {
    const err = translateProviderError('anthropic', 'X.chat', {
      type: 'rate_limit_error',
      message: 'slow down',
    });
    expect(err.code).toBe('LLM_RATE_LIMITED');
  });

  it('falls back to LLM_UNKNOWN for unrecognised shapes', () => {
    const err = translateProviderError('openai', 'X.chat', { weird: true });
    expect(err.code).toBe('LLM_UNKNOWN');
  });

  it('preserves the original error as `cause`', () => {
    const original = new Error('upstream failed');
    const err = translateProviderError('openai', 'X.chat', original);
    expect(err.cause).toBe(original);
  });

  it('classifies a bare 400 without context-length signals as LLM_UNKNOWN', () => {
    // 400 alone is ambiguous (bad request shape); only the context-
    // length sub-signal escalates it to LLM_CONTEXT_TOO_LONG.
    const err = translateProviderError('openai', 'X.chat', {
      status: 400,
      error: { type: 'invalid_request_error', message: 'malformed input' },
    });
    expect(err.code).toBe('LLM_UNKNOWN');
  });
});
