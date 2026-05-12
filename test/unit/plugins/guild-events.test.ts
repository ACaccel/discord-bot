import { describe, expect, it } from 'vitest';
import { createGuildEventsPlugin } from '../../../src/plugins/guild-events';

describe('createGuildEventsPlugin', () => {
  it('accepts a minimal config (clientId only) and defaults blockedChannels to []', () => {
    const plugin = createGuildEventsPlugin({ clientId: 'bot-1' });
    expect(plugin.id).toBe('guild-events');
    expect(plugin.scope).toBe('bot');
    expect(plugin.events?.messageUpdate).toBeTypeOf('function');
    expect(plugin.events?.messageDelete).toBeTypeOf('function');
    expect(plugin.events?.guildMemberUpdate).toBeTypeOf('function');
  });

  it('accepts a blockedChannels list', () => {
    const plugin = createGuildEventsPlugin({ clientId: 'bot-1', blockedChannels: ['1', '2'] });
    expect(plugin.id).toBe('guild-events');
  });

  it('requires a non-empty clientId so audit logs carry bot identity', () => {
    expect(() => createGuildEventsPlugin({})).toThrow();
    expect(() => createGuildEventsPlugin({ clientId: '' })).toThrow();
  });

  it('rejects configs whose fields have the wrong shape', () => {
    expect(() =>
      createGuildEventsPlugin({
        clientId: 'bot-1',
        blockedChannels: 'not-an-array' as unknown as string[],
      }),
    ).toThrow();
  });

  it('rejects unknown keys (.strict() prevents config drift)', () => {
    expect(() => createGuildEventsPlugin({ clientId: 'bot-1', blocked: ['1'] })).toThrow();
  });
});
