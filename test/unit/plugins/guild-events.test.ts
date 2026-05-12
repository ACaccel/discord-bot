import { describe, expect, it } from 'vitest';
import { createGuildEventsPlugin } from '../../../src/plugins/guild-events';

describe('createGuildEventsPlugin', () => {
  it('accepts an empty config and defaults blockedChannels to []', () => {
    const plugin = createGuildEventsPlugin({});
    expect(plugin.id).toBe('guild-events');
    expect(plugin.scope).toBe('bot');
    expect(plugin.events?.messageUpdate).toBeTypeOf('function');
    expect(plugin.events?.messageDelete).toBeTypeOf('function');
    expect(plugin.events?.guildMemberUpdate).toBeTypeOf('function');
  });

  it('accepts a blockedChannels list', () => {
    const plugin = createGuildEventsPlugin({ blockedChannels: ['1', '2'] });
    expect(plugin.id).toBe('guild-events');
  });

  it('rejects configs whose fields have the wrong shape', () => {
    expect(() =>
      createGuildEventsPlugin({ blockedChannels: 'not-an-array' as unknown as string[] }),
    ).toThrow();
  });

  it('rejects unknown keys (.strict() prevents config drift)', () => {
    expect(() => createGuildEventsPlugin({ blocked: ['1'] })).toThrow();
  });
});
