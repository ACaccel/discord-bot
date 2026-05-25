import { describe, expect, it } from 'vitest';
import { normalizeDiscordLocale, resolveLocale } from '../../../../src/core/i18n';

describe('normalizeDiscordLocale', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['zh-tw', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(normalizeDiscordLocale(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'ja', 'de', 'fr-FR'])('returns undefined for %p', (input) => {
    expect(normalizeDiscordLocale(input)).toBeUndefined();
  });
});

describe('resolveLocale', () => {
  it('prefers user locale over guild and interaction', () => {
    expect(
      resolveLocale({ userLocale: 'en', guildLocale: 'zh-TW', interactionLocale: 'zh-TW' }),
    ).toBe('en');
  });

  it('falls back to guild when user locale is unsupported', () => {
    expect(
      resolveLocale({ userLocale: 'ja', guildLocale: 'en-US', interactionLocale: 'zh-TW' }),
    ).toBe('en');
  });

  it('falls back to interaction locale when user and guild are absent', () => {
    expect(resolveLocale({ interactionLocale: 'zh-Hant' })).toBe('zh-TW');
  });

  it('returns the default fallback when every input is missing or unsupported', () => {
    expect(resolveLocale({ userLocale: 'ja', guildLocale: 'ko', interactionLocale: 'de' })).toBe(
      'zh-TW',
    );
  });

  it('respects a custom fallback', () => {
    expect(resolveLocale({}, 'en')).toBe('en');
  });
});
