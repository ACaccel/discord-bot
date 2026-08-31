/**
 * xAI Grok provider adapter.
 *
 * The whole request/response dance lives in
 * {@link OpenAICompatibleProvider}; this file is the xAI spec for it.
 * xAI's `/v1/chat/completions` does NOT accept the Agent Tools (the
 * older `search_parameters` field returns HTTP 410), so web search runs
 * through `/v1/responses`, where a server-side `web_search` executes
 * inside xAI and merges into `output_text`.
 *
 * Ref: https://docs.x.ai/docs/guides/tools/overview
 */
import type OpenAI from 'openai';

import { OpenAICompatibleProvider, type OpenAICompatibleSpec } from './openai-compatible-provider';

const SPEC: OpenAICompatibleSpec = {
  name: 'xai',
  operation: 'XAIProvider.chat',
  baseURL: 'https://api.x.ai/v1',
  // xAI takes the bare `web_search` tool, not OpenAI's
  // `web_search_preview`; both are members of `Responses.Tool`.
  webSearchTool: { type: 'web_search' },
};

export class XAIProvider extends OpenAICompatibleProvider {
  public constructor(apiKey?: string, client?: OpenAI) {
    super(SPEC, apiKey, client);
  }
}
