import { describe, expect, it } from 'vitest';
import { TtsReplyPlugin } from '../../../src/plugins/tts-reply';

describe('TtsReplyPlugin shape', () => {
  it('declares id, version, scope and a messageCreate subscription', () => {
    expect(TtsReplyPlugin.id).toBe('tts-reply');
    expect(TtsReplyPlugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(TtsReplyPlugin.scope).toBe('bot');
    expect(TtsReplyPlugin.events?.messageCreate).toBeTypeOf('function');
  });
});
