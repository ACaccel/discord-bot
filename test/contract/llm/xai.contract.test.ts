import OpenAI from 'openai';
import nock from 'nock';
import { describe, expect, it } from 'vitest';

import { XAIProvider } from '../../../src/infra/llm';
import { expectLlmError, settings, setupNock } from './_helpers';

const BASE = 'https://api.x.ai';
const CHAT_PATH = '/v1/chat/completions';

const buildProvider = (): XAIProvider =>
  new XAIProvider(
    'sk-test',
    new OpenAI({ apiKey: 'sk-test', baseURL: `${BASE}/v1`, maxRetries: 0 }),
  );

const callerSettings = settings({ provider: 'xai', model: 'grok-3' });
const callerMessages = [{ role: 'user', content: 'hi' } as const];

describe('XAIProvider contract', () => {
  setupNock();

  it('success: returns content + usage', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(200, {
        choices: [{ message: { content: 'hello world' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });
    const result = await buildProvider().chat(callerMessages, callerSettings);
    expect(result.content).toBe('hello world');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('401: translates to LLM_INVALID_API_KEY', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(401, {
        error: { type: 'authentication_error', code: 'invalid_api_key', message: 'bad key' },
      });
    await expectLlmError(
      buildProvider().chat(callerMessages, callerSettings),
      'LLM_INVALID_API_KEY',
    );
  });

  it('429: translates to LLM_RATE_LIMITED', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(429, { error: { type: 'rate_limit_error', message: 'slow down' } });
    await expectLlmError(buildProvider().chat(callerMessages, callerSettings), 'LLM_RATE_LIMITED');
  });

  it('5xx: translates to LLM_UPSTREAM_5XX', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(503, { error: { type: 'server_error', message: 'unavailable' } });
    await expectLlmError(buildProvider().chat(callerMessages, callerSettings), 'LLM_UPSTREAM_5XX');
  });

  it('context-length-exceeded (400 + code): translates to LLM_CONTEXT_TOO_LONG', async () => {
    nock(BASE)
      .post(CHAT_PATH)
      .reply(400, {
        error: {
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
          message: 'maximum context length exceeded',
        },
      });
    await expectLlmError(
      buildProvider().chat(callerMessages, callerSettings),
      'LLM_CONTEXT_TOO_LONG',
    );
  });
});
