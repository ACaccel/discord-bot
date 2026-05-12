import { EmbedBuilder, type TextChannel } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createGuildEventsPlugin } from '../../../src/plugins/guild-events';
import { __test as guildEventsTest } from '../../../src/plugins/guild-events/plugin';

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

describe('safeSendEmbed', () => {
  it('swallows channel.send rejections so the caller can keep running its audit-log side effects', async () => {
    const fakeChannel = {
      send: vi.fn(async () => {
        throw new Error('Missing Permissions');
      }),
    } as unknown as TextChannel;
    const embed = new EmbedBuilder().setTitle('x');
    // Should NOT throw — that is the contract this regression test
    // protects: a Discord-side rejection here must not abort the
    // surrounding handler before its guildLogger / attachmentLogger
    // call sites run.
    await expect(
      guildEventsTest.safeSendEmbed(fakeChannel, embed, 'bot-1', 'guild-1', 'message_update'),
    ).resolves.toBeUndefined();
    expect(fakeChannel.send).toHaveBeenCalledTimes(1);
  });

  it('forwards successful sends without error', async () => {
    const fakeChannel = {
      send: vi.fn(async () => undefined),
    } as unknown as TextChannel;
    const embed = new EmbedBuilder().setTitle('x');
    await guildEventsTest.safeSendEmbed(fakeChannel, embed, 'bot-1', 'guild-1', 'message_delete');
    expect(fakeChannel.send).toHaveBeenCalledTimes(1);
  });
});
