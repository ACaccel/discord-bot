import { describe, expect, it } from 'vitest';
import { createLlmChatPlugin } from '../../../src/plugins/llm-chat';

describe('createLlmChatPlugin', () => {
  it('has the expected plugin shape', () => {
    const p = createLlmChatPlugin({ clientId: 'bot-1' });
    expect(p.id).toBe('llm-chat');
    expect(p.scope).toBe('bot');
    expect(p.init).toBeTypeOf('function');
    expect(p.events?.messageCreate).toBeTypeOf('function');
  });
});
