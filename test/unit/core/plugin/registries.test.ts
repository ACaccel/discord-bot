import { describe, expect, it } from 'vitest';
import {
  DuplicateContributionError,
  mergeRegistries,
} from '../../../../src/core/plugin/registries';

class A {}
class B {}
class C {}

describe('mergeRegistries', () => {
  it('returns an empty frozen object when given no sources', () => {
    const out = mergeRegistries('command', []);
    expect(out).toEqual({});
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('merges disjoint sources into one effective registry', () => {
    const out = mergeRegistries('command', [
      { id: 'core', registry: { a: A, b: B } },
      { id: 'pluginX', registry: { c: C } },
    ]);
    expect(out).toEqual({ a: A, b: B, c: C });
  });

  it('throws DuplicateContributionError with both source ids on conflict', () => {
    expect(() =>
      mergeRegistries('command', [
        { id: 'core', registry: { share: A } },
        { id: 'pluginX', registry: { share: B } },
      ]),
    ).toThrowError(DuplicateContributionError);
    try {
      mergeRegistries('command', [
        { id: 'core', registry: { share: A } },
        { id: 'pluginX', registry: { share: B } },
      ]);
    } catch (e) {
      const err = e as DuplicateContributionError;
      expect(err.handlerType).toBe('command');
      expect(err.handlerName).toBe('share');
      expect(err.sources).toEqual(['core', 'pluginX']);
    }
  });

  it('also detects plugin-vs-plugin duplicates (no core source)', () => {
    expect(() =>
      mergeRegistries('button', [
        { id: 'pluginA', registry: { dup: A } },
        { id: 'pluginB', registry: { dup: B } },
      ]),
    ).toThrowError(DuplicateContributionError);
  });
});
