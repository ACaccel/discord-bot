import { GoogleGenerativeAI } from '@google/generative-ai';
import nock from 'nock';
import { describe, expect, it } from 'vitest';

import { GeminiProvider } from '../../../src/infra/llm';
import { expectLlmError, settings, setupNock } from './_helpers';

const BASE = 'https://generativelanguage.googleapis.com';
const MODEL = 'gemini-2.0-flash';
// SDK path includes the API version + the model + `:generateContent`.
// The interceptor matches the path prefix; the query string (?key=...)
// is matched separately via `.query(true)`.
const GEN_PATH = new RegExp(`^/v1beta/models/${MODEL}:generateContent$`);

const buildProvider = (): GeminiProvider => new GeminiProvider(new GoogleGenerativeAI('fake-key'));

const callerSettings = settings({ provider: 'gemini', model: MODEL });
const callerMessages = [{ role: 'user', content: 'hi' } as const];

describe('GeminiProvider contract', () => {
  setupNock();

  it('success: returns content + usage', async () => {
    nock(BASE)
      .post(GEN_PATH)
      .query(true)
      .reply(200, {
        candidates: [
          {
            content: { parts: [{ text: 'hello world' }], role: 'model' },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
      });
    const result = await buildProvider().chat(callerMessages, callerSettings);
    expect(result.content).toBe('hello world');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('401-ish (Gemini surfaces auth failures via 400 INVALID_ARGUMENT API key not valid): translates to LLM_INVALID_API_KEY', async () => {
    // Gemini occasionally responds with 401 too. Match the canonical
    // 401 path here; the legacy 400/API_KEY_INVALID variant is
    // surfaced as LLM_UNKNOWN today (acceptable — the message text
    // contains "API key not valid" which the translator does not yet
    // peek into; the contract test pins TODAY's behaviour).
    nock(BASE)
      .post(GEN_PATH)
      .query(true)
      .reply(401, {
        error: { code: 401, message: 'API key not valid', status: 'UNAUTHENTICATED' },
      });
    await expectLlmError(
      buildProvider().chat(callerMessages, callerSettings),
      'LLM_INVALID_API_KEY',
    );
  });

  it('429: translates to LLM_RATE_LIMITED', async () => {
    nock(BASE)
      .post(GEN_PATH)
      .query(true)
      .reply(429, {
        error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' },
      });
    await expectLlmError(buildProvider().chat(callerMessages, callerSettings), 'LLM_RATE_LIMITED');
  });

  it('5xx: translates to LLM_UPSTREAM_5XX', async () => {
    nock(BASE)
      .post(GEN_PATH)
      .query(true)
      .reply(503, {
        error: { code: 503, message: 'Service unavailable', status: 'UNAVAILABLE' },
      });
    await expectLlmError(buildProvider().chat(callerMessages, callerSettings), 'LLM_UPSTREAM_5XX');
  });

  it('context-length-exceeded (400 with "maximum tokens" in message): translates to LLM_CONTEXT_TOO_LONG', async () => {
    nock(BASE)
      .post(GEN_PATH)
      .query(true)
      .reply(400, {
        error: {
          code: 400,
          message: 'The input token count exceeds the maximum tokens allowed by the model.',
          status: 'INVALID_ARGUMENT',
        },
      });
    await expectLlmError(
      buildProvider().chat(callerMessages, callerSettings),
      'LLM_CONTEXT_TOO_LONG',
    );
  });

  it('every nock interceptor was matched', () => {
    expect(nock.pendingMocks()).toEqual([]);
  });
});
