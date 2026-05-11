import { describe, expect, it } from 'vitest';
import { asChannelId, asGuildId, asMessageId, asRoleId, asUserId } from '../../../src/core/ids';

describe('branded ID constructors', () => {
  it.each([
    ['asGuildId', asGuildId],
    ['asChannelId', asChannelId],
    ['asMessageId', asMessageId],
    ['asUserId', asUserId],
    ['asRoleId', asRoleId],
  ] as const)('%s returns the underlying string for valid input', (_label, ctor) => {
    expect(ctor('123456789012345678')).toBe('123456789012345678');
  });

  it.each([
    ['asGuildId', asGuildId],
    ['asChannelId', asChannelId],
    ['asMessageId', asMessageId],
    ['asUserId', asUserId],
    ['asRoleId', asRoleId],
  ] as const)('%s rejects empty string', (_label, ctor) => {
    expect(() => ctor('')).toThrow(TypeError);
  });

  it.each([
    ['asGuildId', asGuildId],
    ['asChannelId', asChannelId],
    ['asMessageId', asMessageId],
    ['asUserId', asUserId],
    ['asRoleId', asRoleId],
  ] as const)('%s rejects non-string input', (_label, ctor) => {
    expect(() => ctor(42)).toThrow(TypeError);
    expect(() => ctor(null)).toThrow(TypeError);
    expect(() => ctor(undefined)).toThrow(TypeError);
  });
});
