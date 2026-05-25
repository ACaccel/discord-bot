/**
 * Shared helpers for LLM contract tests.
 *
 * Every contract test exercises one provider adapter against a `nock`
 * fixture covering: success / 401 / 429 / 5xx / context-too-long.
 * The tests verify that the adapter translates each upstream signal
 * into the matching {@link LlmProviderErrorCode}.
 *
 * Why nock and not the SDK's test doubles: the SDK upgrades over
 * time and we care about the wire-level contract between us and the
 * upstream. nock pins the HTTP boundary so an SDK upgrade that
 * silently changes its surface still fails the suite.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';
import nock from 'nock';

import type { LlmProviderError, LlmProviderErrorCode } from '../../../src/core/errors';
import type { LLMSettings } from '../../../src/infra/llm';

/**
 * Sets up nock for the duration of a `describe` block:
 *   - blocks all real HTTP egress so a missing fixture surfaces as
 *     "no match for request" instead of silently calling the live API;
 *   - removes accumulated interceptors between tests so one test's
 *     leftover stub does not match another's request;
 *   - restores the network at suite end.
 */
export const setupNock = (): void => {
  beforeAll(() => {
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
  });
  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });
};

/** Minimal LLMSettings factory; tests pass overrides positionally. */
export const settings = (
  overrides: Partial<LLMSettings> & Pick<LLMSettings, 'provider' | 'model'>,
): LLMSettings => ({
  temperature: 1.0,
  systemPrompt: '',
  webSearch: false,
  ...overrides,
});

/**
 * Assert that the `chat` call rejects with a {@link LlmProviderError}
 * carrying the expected sub-code. Returns the error so the caller
 * can chain extra assertions (e.g. on `context.input`).
 */
export const expectLlmError = async (
  promise: Promise<unknown>,
  expectedCode: LlmProviderErrorCode,
): Promise<LlmProviderError> => {
  try {
    await promise;
  } catch (err: unknown) {
    const e = err as LlmProviderError;
    if (e.kind !== 'LlmProviderError') {
      throw new Error(`Expected LlmProviderError, got ${e.kind ?? typeof err}: ${String(err)}`);
    }
    if (e.code !== expectedCode) {
      throw new Error(`Expected code ${expectedCode}, got ${e.code}`);
    }
    return e;
  }
  throw new Error(`Expected LlmProviderError(${expectedCode}) but promise resolved`);
};
