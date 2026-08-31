/**
 * OpenAI LLM provider adapter.
 *
 * The whole request/response dance lives in
 * {@link OpenAICompatibleProvider}; this file is the OpenAI spec for it.
 * The SDK's default `baseURL` is the OpenAI API itself, so none is set,
 * and the Responses API takes the `web_search_preview` tool.
 *
 * Contract tests in `test/contract/llm/openai.contract.test.ts` pin the
 * error translation.
 */
import type OpenAI from 'openai';

import { OpenAICompatibleProvider, type OpenAICompatibleSpec } from './openai-compatible-provider';

const SPEC: OpenAICompatibleSpec = {
  name: 'openai',
  operation: 'OpenAIProvider.chat',
  webSearchTool: { type: 'web_search_preview' },
};

export class OpenAIProvider extends OpenAICompatibleProvider {
  public constructor(apiKey?: string, client?: OpenAI) {
    super(SPEC, apiKey, client);
  }
}
