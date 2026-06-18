/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logGuildEvent so the suppression tests can assert the audit line is ALSO
// skipped (not just the embed); importOriginal keeps logError / logSystem real.
vi.mock('@core/logger', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  logGuildEvent: vi.fn(),
}));

import { EmbedBuilder, type Guild, type Message, type TextChannel } from 'discord.js';
import { logGuildEvent } from '@core/logger';
import { createGuildEventsPlugin } from '../../../src/plugins/guild-events';
import { __test as guildEventsTest } from '../../../src/plugins/guild-events/plugin';
import {
  createPermissionRankPolicy,
  type GuildOnboardingPort,
  type PermissionRankPolicy,
  type PluginEventContext,
} from '../../../src/core/plugin';
import type { GuildRegistry } from '../../../src/core/guild-registry';
import { createContainer } from '../../../src/core/ioc';
import { TOKENS } from '../../../src/core/ioc/tokens';
import { createLogger } from '../../../src/core/logger';
import { systemClock } from '../../../src/core/time';

describe('createGuildEventsPlugin', () => {
  it('declares its bot-scoped event subscriptions (no config)', () => {
    const plugin = createGuildEventsPlugin();
    expect(plugin.id).toBe('guild-events');
    expect(plugin.scope).toBe('bot');
    expect(plugin.events?.messageUpdate).toBeTypeOf('function');
    expect(plugin.events?.messageDelete).toBeTypeOf('function');
    expect(plugin.events?.guildMemberUpdate).toBeTypeOf('function');
    expect(plugin.events?.guildCreate).toBeTypeOf('function');
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

/**
 * Behaviour: the mirror (and its audit-log side effect) is suppressed for a
 * channel above the `guild_events` rank ceiling. Drives the real
 * `messageUpdate` / `messageDelete` handlers with a live IoC container holding
 * a real (static-config) policy and a fake event channel; the channel's `send`
 * spy is the probe — it fires only when the message is NOT suppressed.
 */
describe('guild-events suppression by permission_rank', () => {
  const silent = createLogger({ level: 'silent', pretty: false });

  const fakeEventChannel = (): { send: ReturnType<typeof vi.fn> } & TextChannel => {
    const send = vi.fn(async () => undefined);
    return { send, isSendable: () => true } as unknown as {
      send: ReturnType<typeof vi.fn>;
    } & TextChannel;
  };

  const registryWith = (eventChannel: TextChannel): GuildRegistry =>
    ({
      getRepos: () => undefined,
      getChannel: (_guildId: string, name: string) => (name === 'event' ? eventChannel : undefined),
      getRole: () => undefined,
      listGuildIds: () => [],
    }) as unknown as GuildRegistry;

  const buildCtx = (registry: GuildRegistry, policy: PermissionRankPolicy): PluginEventContext => {
    const container = createContainer();
    container.registerSingleton(TOKENS.Logger, () => silent);
    container.registerSingleton(TOKENS.GuildRegistry, () => registry);
    container.registerSingleton(TOKENS.PermissionRankPolicy, () => policy);
    return {
      logger: silent,
      translator: undefined,
      clock: systemClock,
      resolve: container.resolve.bind(container),
    } as unknown as PluginEventContext;
  };

  const author = {
    bot: false,
    id: 'u1',
    username: 'user',
    displayName: 'User',
    displayAvatarURL: () => 'https://example.test/a.png',
  };

  type ChannelStub = { parentId: string | null };
  const NO_LOOKUP = { get: (): ChannelStub | undefined => undefined };

  // `lookup` resolves intermediate ancestors so the effective-rank walk can
  // climb past the immediate parent (thread → channel → category).
  const message = (
    channelId: string,
    content: string,
    parentId: string | null = null,
    lookup: { get: (id: string) => ChannelStub | undefined } = NO_LOOKUP,
  ): Message =>
    ({
      content,
      author,
      guild: { id: 'g1', name: 'Guild', channels: { cache: lookup } },
      guildId: 'g1',
      channel: { id: channelId, parentId },
      partial: false,
      attachments: { size: 0, map: () => [], forEach: () => undefined },
    }) as unknown as Message;

  // `forum` is ranked so a thread under it (itself unlisted = rank 0) inherits
  // the parent's rank and is suppressed; `cat` proves the full-ancestry case.
  const policy = createPermissionRankPolicy({ g1: { channels: { private: 1, forum: 1, cat: 1 } } });

  const fireUpdate = async (
    channelId: string,
    channel: TextChannel,
    parentId: string | null = null,
    lookup?: { get: (id: string) => ChannelStub | undefined },
  ): Promise<void> => {
    const handler = createGuildEventsPlugin().events?.messageUpdate;
    if (handler === undefined) throw new Error('no messageUpdate handler');
    await handler(
      buildCtx(registryWith(channel), policy),
      message(channelId, 'old', parentId, lookup) as Parameters<typeof handler>[1],
      message(channelId, 'new', parentId, lookup) as Parameters<typeof handler>[2],
    );
  };

  const fireDelete = async (channelId: string, channel: TextChannel): Promise<void> => {
    const handler = createGuildEventsPlugin().events?.messageDelete;
    if (handler === undefined) throw new Error('no messageDelete handler');
    await handler(
      buildCtx(registryWith(channel), policy),
      message(channelId, 'gone') as Parameters<typeof handler>[1],
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors a message edit in a rank-0 (public) channel — embed AND audit fire', async () => {
    const channel = fakeEventChannel();
    await fireUpdate('public', channel);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(logGuildEvent).toHaveBeenCalledTimes(1);
  });

  it('suppresses a message edit above the ceiling — neither embed NOR audit fire', async () => {
    const channel = fakeEventChannel();
    await fireUpdate('private', channel);
    expect(channel.send).not.toHaveBeenCalled();
    expect(logGuildEvent).not.toHaveBeenCalled();
  });

  it('suppresses an edit in a thread under a ranked parent forum (effective rank via parent)', async () => {
    const channel = fakeEventChannel();
    await fireUpdate('thread', channel, 'forum'); // thread rank 0, parent forum rank 1
    expect(channel.send).not.toHaveBeenCalled();
    expect(logGuildEvent).not.toHaveBeenCalled();
  });

  it('suppresses an edit in a thread nested under a private category (full ancestry)', async () => {
    const channel = fakeEventChannel();
    // thread 'th' → channel 'ch-cat' (unlisted) → category 'cat' (rank 1); the
    // lookup resolves the intermediate channel so the walk reaches the category.
    const lookup = { get: (id: string) => (id === 'ch-cat' ? { parentId: 'cat' } : undefined) };
    await fireUpdate('th', channel, 'ch-cat', lookup);
    expect(channel.send).not.toHaveBeenCalled();
    expect(logGuildEvent).not.toHaveBeenCalled();
  });

  it('suppresses a message delete above the ceiling — neither embed NOR audit fire', async () => {
    const channel = fakeEventChannel();
    await fireDelete('private', channel);
    expect(channel.send).not.toHaveBeenCalled();
    expect(logGuildEvent).not.toHaveBeenCalled();
  });

  it('mirrors a message delete in a rank-0 channel — embed AND audit fire', async () => {
    const channel = fakeEventChannel();
    await fireDelete('public', channel);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(logGuildEvent).toHaveBeenCalledTimes(1);
  });
});
