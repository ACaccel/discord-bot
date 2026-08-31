import { describe, expect, it } from 'vitest';
import { buildGuildMongoUri } from '../../../../src/infra/mongo';

describe('buildGuildMongoUri', () => {
  it('appends the guild id and authSource query for a valid snowflake', () => {
    // The credential-bearing form is the shape the builder has to carry
    // through untouched, so it has to appear literally. Both lines are
    // exempted from the `mongodb-connection-uri` gitleaks rule.
    const base = 'mongodb://user:pass@host/'; // gitleaks:allow
    const expected = 'mongodb://user:pass@host/123456789012345678?authSource=admin'; // gitleaks:allow
    expect(buildGuildMongoUri(base, '123456789012345678')).toBe(expected);
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
