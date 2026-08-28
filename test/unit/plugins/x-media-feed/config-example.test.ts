/**
 * Guards the shipped example config against the plugin's own schema.
 *
 * The plugin parses its block at construction time regardless of
 * `enabled`, so an example that does not satisfy the schema is not a
 * documentation nit — an operator who seeds `config.json` from
 * `config.example.json` (which is exactly what CI does, and what the
 * setup instructions tell a human to do) would crash nijika at boot.
 * The placeholder handles are the easy way to get this wrong: they must
 * satisfy the same 15-character X handle limit as a real one.
 */
import { describe, expect, it } from 'vitest';

import nijikaExample from '../../../../src/bot/nijika/config.example.json';
import { parseXMediaFeedConfig } from '../../../../src/plugins/x-media-feed/config';

describe('nijika config.example.json — x_media_feed block', () => {
  const block = (nijikaExample as Record<string, unknown>)['x_media_feed'];

  it('is present, so operators have something to copy', () => {
    expect(block).toBeDefined();
  });

  it('satisfies the plugin schema, so seeding config.json from it boots', () => {
    expect(() => parseXMediaFeedConfig(block)).not.toThrow();
  });

  it('ships disabled, so copying it never starts polling by accident', () => {
    expect(parseXMediaFeedConfig(block).enabled).toBe(false);
  });

  it('names a default channel that the example guild actually configures', () => {
    const parsed = parseXMediaFeedConfig(block);
    const guilds = (
      nijikaExample as { guilds: Record<string, { channels: Record<string, string> }> }
    ).guilds;
    const names = new Set(Object.values(guilds).flatMap((g) => Object.keys(g.channels ?? {})));
    // Every channel the block routes to must exist in the example's
    // `channels` map, or the example documents a feed that silently
    // never posts.
    expect(names.has(parsed.defaultChannel)).toBe(true);
    for (const account of parsed.accounts) {
      expect(names.has(account.channel ?? parsed.defaultChannel)).toBe(true);
    }
  });
});
