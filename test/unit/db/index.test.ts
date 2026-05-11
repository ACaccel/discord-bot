import { describe, expect, it } from 'vitest';
import { buildGuildMongoUri } from '../../../src/db';

describe('buildGuildMongoUri', () => {
  it('appends the guild id and authSource query for a valid snowflake', () => {
    expect(buildGuildMongoUri('mongodb://user:pass@host/', '123456789012345678')).toBe(
      'mongodb://user:pass@host/123456789012345678?authSource=admin',
    );
  });

  it('rejects an empty guild id', () => {
    expect(() => buildGuildMongoUri('mongodb://host/', '')).toThrow(TypeError);
  });

  it('rejects a guild id with non-digit characters', () => {
    expect(() => buildGuildMongoUri('mongodb://host/', 'abc')).toThrow(TypeError);
    expect(() => buildGuildMongoUri('mongodb://host/', '123/etc')).toThrow(TypeError);
    expect(() => buildGuildMongoUri('mongodb://host/', '123?injected=1')).toThrow(TypeError);
  });
});
