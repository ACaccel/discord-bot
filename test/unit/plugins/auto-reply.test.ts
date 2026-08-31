import { describe, expect, it } from 'vitest';
import { rollDice } from '../../../src/plugins/auto-reply';

describe('AutoReplyPlugin.rollDice', () => {
  it('returns null when the input is not a dice expression', () => {
    expect(rollDice('hello')).toBeNull();
    expect(rollDice('2d')).toBeNull();
    expect(rollDice('d6')).toBeNull();
  });

  it('rolls each dice and reports them with the count/sides header', () => {
    const result = rollDice('3d6');
    expect(result).toMatch(/^🎲 3d6: \[\d+, \d+, \d+\]$/);
  });

  it('rejects ranges outside the supported bounds', () => {
    expect(rollDice('0d6')).toMatch(/^out of range/);
    expect(rollDice('101d6')).toMatch(/^out of range/);
    expect(rollDice('1d0')).toMatch(/^out of range/);
    // 2^30 + 1 sides — the ceiling is enforced.
    expect(rollDice(`1d${(2 ** 30 + 1).toString()}`)).toMatch(/^out of range/);
  });

  it('produces rolls within the requested side count', () => {
    for (let i = 0; i < 50; i += 1) {
      const result = rollDice('5d20');
      expect(result).not.toBeNull();
      const rolls = (result as string)
        .match(/\[(.*)\]/)?.[1]
        ?.split(', ')
        .map((n) => Number.parseInt(n, 10));
      expect(rolls).toHaveLength(5);
      for (const n of rolls as number[]) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(20);
      }
    }
  });
});
