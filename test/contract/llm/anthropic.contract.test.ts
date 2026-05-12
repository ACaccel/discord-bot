import Anthropic from '@anthropic-ai/sdk';
import nock from 'nock';
import { describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../../../src/infra/llm';
import { expectLlmError, settings, setupNock } from './_helpers';

const BASE = 'https://api.anthropic.com';
const MESSAGES_PATH = '/v1/messages';

const buildProvider = (): AnthropicProvider =>
  new AnthropicProvider(
    'sk-test',
    new Anthropic({ apiKey: 'sk-test', baseURL: BASE, maxRetries: 0 }),
  );

const callerSettings = settings({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
const callerMessages = [{ role: 'user', content: 'hi' } as const];

describe('AnthropicProvider contract', () => {
  setupNock();

  it('success: returns content + usage', async () => {
    nock(BASE)
      .post(MESSAGES_PATH)
      .reply(200, {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello world' }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      });

    const result = await buildProvider().chat(callerMessages, callerSettings);
    expect(result.content).toBe('hello world');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('401: translates to LLM_INVALID_API_KEY', async () => {
    nock(BASE)
      .post(MESSAGES_PATH)
      .reply(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
    await expectLlmError(
      buildProvider().chat(callerMessages, callerSettings),
      'LLM_INVALID_API_KEY',
    );
  });

  it('429: translates to LLM_RATE_LIMITED', async () => {
    nock(BASE)
      .post(MESSAGES_PATH)
      .reply(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
    await expectLlmError(buildProvider().chat(callerMessages, callerSettings), 'LLM_RATE_LIMITED');
  });

  it('5xx: translates to LLM_UPSTREAM_5XX', async () => {
    nock(BASE)
      .post(MESSAGES_PATH)
      .reply(503, { type: 'error', error: { type: 'api_error', message: 'unavailable' } });
    await expectLlmError(buildProvider().chat(callerMessages, callerSettings), 'LLM_UPSTREAM_5XX');
  });

  it('context-length-exceeded (400 invalid_request_error + message): translates to LLM_CONTEXT_TOO_LONG', async () => {
    nock(BASE)
      .post(MESSAGES_PATH)
      .reply(400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'prompt is too long: 200000 tokens > 100000 maximum context length',
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
