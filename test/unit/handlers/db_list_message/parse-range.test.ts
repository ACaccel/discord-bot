import { describe, expect, it } from 'vitest';

import { parseStartEnd } from '../../../../src/handlers/commands/db_list_message/parse-range';

describe('parseStartEnd', () => {
  it('returns a full local-day range when no hour is provided', () => {
    const result = parseStartEnd('2026-05-23', null);
    expect(result).not.toBeNull();
    const expectedStart = new Date(2026, 4, 23, 0, 0, 0, 0).getTime();
    const expectedEnd = new Date(2026, 4, 24, 0, 0, 0, 0).getTime();
    expect(result?.startMs).toBe(expectedStart);
    expect(result?.endMs).toBe(expectedEnd);
  });

  it('returns a one-hour window when an hour is provided', () => {
    const result = parseStartEnd('2026-05-23', 14);
    expect(result).not.toBeNull();
    expect(result!.endMs - result!.startMs).toBe(3_600_000);
    expect(new Date(result!.startMs).getHours()).toBe(14);
  });

  it('returns null for malformed date strings', () => {
    expect(parseStartEnd('not-a-date', null)).toBeNull();
    expect(parseStartEnd('2026-13-01', null)).toBeNull();
    expect(parseStartEnd('', null)).toBeNull();
  });

  it('returns null when the hour is out of range', () => {
    expect(parseStartEnd('2026-05-23', 24)).toBeNull();
    expect(parseStartEnd('2026-05-23', -1)).toBeNull();
    expect(parseStartEnd('2026-05-23', 1.5)).toBeNull();
  });

  it('treats undefined hour as a full-day request', () => {
    const result = parseStartEnd('2026-05-23', undefined);
    expect(result?.endMs).toBeGreaterThan(result?.startMs ?? Infinity);
  });
});
