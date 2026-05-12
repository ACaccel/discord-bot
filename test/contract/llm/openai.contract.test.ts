import OpenAI from 'openai';
import nock from 'nock';
import { describe, expect, it } from 'vitest';

import { OpenAIProvider } from '../../../src/infra/llm';
import { expectLlmError, settings, setupNock } from './_helpers';

const BASE = 'https://api.openai.com';
const CHAT_PATH = '/v1/chat/completions';

const buildProvider = (): OpenAIProvider =>
  new OpenAIProvider(new OpenAI({ apiKey: 'sk-test', baseURL: `${BASE}/v1`, maxRetries: 0 }));

describe('OpenAIProvider contract', () => {
  setupNock();

  it('success: returns content + usage', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(200, {
        choices: [{ message: { content: 'hello world' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });

    const result = await buildProvider().chat(
      [{ role: 'user', content: 'hi' }],
      settings({ provider: 'openai', model: 'gpt-4o' }),
    );
    expect(result.content).toBe('hello world');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('401: translates to LLM_INVALID_API_KEY', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(401, {
        error: {
          message: 'Invalid API key',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      });
    await expectLlmError(
      buildProvider().chat(
        [{ role: 'user', content: 'hi' }],
        settings({ provider: 'openai', model: 'gpt-4o' }),
      ),
      'LLM_INVALID_API_KEY',
    );
  });

  it('429: translates to LLM_RATE_LIMITED', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(429, {
        error: { message: 'Rate limit', type: 'rate_limit_error', code: 'rate_limit_exceeded' },
      });
    await expectLlmError(
      buildProvider().chat(
        [{ role: 'user', content: 'hi' }],
        settings({ provider: 'openai', model: 'gpt-4o' }),
      ),
      'LLM_RATE_LIMITED',
    );
  });

  it('5xx: translates to LLM_UPSTREAM_5XX', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(503, {
        error: { message: 'Service unavailable', type: 'server_error' },
      });
    await expectLlmError(
      buildProvider().chat(
        [{ role: 'user', content: 'hi' }],
        settings({ provider: 'openai', model: 'gpt-4o' }),
      ),
      'LLM_UPSTREAM_5XX',
    );
  });

  it('context-length-exceeded (400 + code): translates to LLM_CONTEXT_TOO_LONG', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(400, {
        error: {
          message: 'This model has a maximum context length of 8192 tokens.',
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
        },
      });
    await expectLlmError(
      buildProvider().chat(
        [{ role: 'user', content: 'x'.repeat(100000) }],
        settings({ provider: 'openai', model: 'gpt-4o' }),
      ),
      'LLM_CONTEXT_TOO_LONG',
    );
  });

  it('LlmProviderError carries operation + provider context', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(503, { error: { message: 'boom', type: 'server_error' } });
    const err = await expectLlmError(
      buildProvider().chat(
        [{ role: 'user', content: 'hi' }],
        settings({ provider: 'openai', model: 'gpt-4o' }),
      ),
      'LLM_UPSTREAM_5XX',
    );
    expect(err.context.operation).toBe('OpenAIProvider.chat');
    expect(err.context['input']).toMatchObject({ provider: 'openai', status: 503 });
  });

  it('nock interceptors are consumed by the SDK call', () => {
    // Hygiene check: every test above should leave no pending mocks.
    expect(nock.pendingMocks()).toEqual([]);
  });
});
