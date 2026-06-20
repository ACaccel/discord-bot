/**
 * Unit tests for the pure topology helpers
 * (`src/core/plugin/host/topology.ts`). The host's higher-level tests
 * cover them indirectly, but the pure-function shape justifies
 * dedicated tests.
 */
import { describe, expect, it } from 'vitest';

import { buildDependentsIndex, topologicalOrder } from '../../../../src/core/plugin/host/topology';
import { PluginRegistrationError } from '../../../../src/core/plugin/host/errors';
import type { Plugin } from '../../../../src/core/plugin';

const entry = (
  _id: string,
  deps: string[] = [],
): { plugin: Pick<Plugin<unknown>, 'dependencies'> } => ({
  plugin: { dependencies: deps.map((d) => ({ id: d, versionRange: '*' })) },
});

const fromPairs = (
  pairs: ReadonlyArray<readonly [string, ReturnType<typeof entry>]>,
): ReadonlyMap<string, ReturnType<typeof entry>> => new Map(pairs);

describe('topologicalOrder', () => {
  it('preserves registration order when there are no dependencies', () => {
    const reg = fromPairs([
      ['a', entry('a')],
      ['b', entry('b')],
      ['c', entry('c')],
    ]);
    expect(topologicalOrder(reg)).toEqual(['a', 'b', 'c']);
  });

  it('places dependencies before their dependents', () => {
    const reg = fromPairs([
      ['child', entry('child', ['parent'])],
      ['parent', entry('parent')],
    ]);
    expect(topologicalOrder(reg)).toEqual(['parent', 'child']);
  });

  it('handles a diamond (A -> B, A -> C, B -> D, C -> D)', () => {
    const reg = fromPairs([
      ['A', entry('A')],
      ['B', entry('B', ['A'])],
      ['C', entry('C', ['A'])],
      ['D', entry('D', ['B', 'C'])],
    ]);
    const order = topologicalOrder(reg);
    expect(order[0]).toBe('A');
    expect(order[3]).toBe('D');
    expect(order.indexOf('B')).toBeGreaterThan(0);
    expect(order.indexOf('C')).toBeGreaterThan(0);
  });

  it('throws PluginRegistrationError with reason CIRCULAR_DEPENDENCY on a cycle', () => {
    const reg = fromPairs([
      ['a', entry('a', ['b'])],
      ['b', entry('b', ['a'])],
    ]);
    expect(() => topologicalOrder(reg)).toThrowError(PluginRegistrationError);
    try {
      topologicalOrder(reg);
    } catch (err) {
      expect((err as PluginRegistrationError).reason).toBe('CIRCULAR_DEPENDENCY');
    }
  });
});

describe('buildDependentsIndex', () => {
  it('returns an empty Set for each plugin when no edges exist', () => {
    const reg = fromPairs([
      ['a', entry('a')],
      ['b', entry('b')],
    ]);
    const idx = buildDependentsIndex(reg);
    expect(idx.get('a')?.size).toBe(0);
    expect(idx.get('b')?.size).toBe(0);
  });

  it('populates forward edges for each dependency declaration', () => {
    const reg = fromPairs([
      ['parent', entry('parent')],
      ['child1', entry('child1', ['parent'])],
      ['child2', entry('child2', ['parent'])],
    ]);
    const idx = buildDependentsIndex(reg);
    expect([...(idx.get('parent') ?? [])].sort()).toEqual(['child1', 'child2']);
    expect(idx.get('child1')?.size).toBe(0);
  });
});
