import { EmbedBuilder, type Guild, type TextChannel } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createGuildEventsPlugin } from '../../../src/plugins/guild-events';
import { __test as guildEventsTest } from '../../../src/plugins/guild-events/plugin';
import type { GuildOnboardingPort } from '../../../src/core/plugin';

describe('createGuildEventsPlugin', () => {
  it('accepts an empty config and defaults blockedChannels to []', () => {
    const plugin = createGuildEventsPlugin({});
    expect(plugin.id).toBe('guild-events');
    expect(plugin.scope).toBe('bot');
    expect(plugin.events?.messageUpdate).toBeTypeOf('function');
    expect(plugin.events?.messageDelete).toBeTypeOf('function');
    expect(plugin.events?.guildMemberUpdate).toBeTypeOf('function');
    expect(plugin.events?.guildCreate).toBeTypeOf('function');
  });

  it('accepts a blockedChannels list', () => {
    const plugin = createGuildEventsPlugin({ blockedChannels: ['1', '2'] });
    expect(plugin.id).toBe('guild-events');
  });

  it('rejects configs whose fields have the wrong shape', () => {
    expect(() =>
      createGuildEventsPlugin({
        blockedChannels: 'not-an-array' as unknown as string[],
      }),
    ).toThrow();
  });

  it('rejects unknown keys (.strict() prevents config drift)', () => {
    expect(() => createGuildEventsPlugin({ blocked: ['1'] })).toThrow();
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
      guildEventsTest.safeSendEmbed(fakeChannel, embed, undefined, 'guild-1', 'message_update'),
    ).resolves.toBeUndefined();
    expect(fakeChannel.send).toHaveBeenCalledTimes(1);
  });

  it('forwards successful sends without error', async () => {
    const fakeChannel = {
      send: vi.fn(async () => undefined),
    } as unknown as TextChannel;
    const embed = new EmbedBuilder().setTitle('x');
    await guildEventsTest.safeSendEmbed(fakeChannel, embed, undefined, 'guild-1', 'message_delete');
    expect(fakeChannel.send).toHaveBeenCalledTimes(1);
  });
});

describe('handleGuildCreate', () => {
  const fakeGuild = (id: string): Guild => ({ id, name: `guild-${id}` }) as unknown as Guild;

  it('delegates onboarding of a new guild to the GuildOnboardingPort', async () => {
    const onboardGuild = vi.fn(async () => ({
      guildId: 'g-1',
      databaseConnected: true,
      commandsRegistered: true,
    }));
    const port: GuildOnboardingPort = { onboardGuild };

    await guildEventsTest.handleGuildCreate(port, undefined, fakeGuild('g-1'));

    expect(onboardGuild).toHaveBeenCalledTimes(1);
    expect(onboardGuild).toHaveBeenCalledWith('g-1');
  });

  it('swallows a port failure so a dispatcher subscription never rejects', async () => {
    const port: GuildOnboardingPort = {
      onboardGuild: vi.fn(async () => {
        throw new Error('connect failed');
      }),
    };

    // Regression contract: onboarding is a structural side effect; a
    // failure is logged, not rethrown.
    await expect(
      guildEventsTest.handleGuildCreate(port, undefined, fakeGuild('g-2')),
    ).resolves.toBeUndefined();
  });
});
