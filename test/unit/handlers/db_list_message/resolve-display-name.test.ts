import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  ARCHIVABLE_CHANNEL_TYPES,
  makeDisplayNameResolver,
} from '../../../../src/handlers/commands/db_list_message/resolve-display-name';

describe('ARCHIVABLE_CHANNEL_TYPES', () => {
  it('contains the text-like channel types', () => {
    expect(ARCHIVABLE_CHANNEL_TYPES.has(ChannelType.GuildText)).toBe(true);
    expect(ARCHIVABLE_CHANNEL_TYPES.has(ChannelType.PublicThread)).toBe(true);
    expect(ARCHIVABLE_CHANNEL_TYPES.has(ChannelType.GuildForum)).toBe(true);
  });

  it('excludes non-archivable category and DM types', () => {
    expect(ARCHIVABLE_CHANNEL_TYPES.has(ChannelType.GuildCategory)).toBe(false);
    expect(ARCHIVABLE_CHANNEL_TYPES.has(ChannelType.DM)).toBe(false);
  });
});

describe('makeDisplayNameResolver', () => {
  it('returns the member displayName on the first call and caches it', async () => {
    const fetch = vi.fn().mockResolvedValue({ displayName: 'Alice' });
    const guild = { members: { fetch } } as unknown as Parameters<
      typeof makeDisplayNameResolver
    >[0];
    const resolve = makeDisplayNameResolver(guild);

    expect(await resolve('u1', 'fallback')).toBe('Alice');
    expect(await resolve('u1', 'fallback')).toBe('Alice');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the supplied fallback when fetch rejects', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('boom'));
    const guild = { members: { fetch } } as unknown as Parameters<
      typeof makeDisplayNameResolver
    >[0];
    const resolve = makeDisplayNameResolver(guild);

    expect(await resolve('u2', 'guest')).toBe('guest');
  });
});
