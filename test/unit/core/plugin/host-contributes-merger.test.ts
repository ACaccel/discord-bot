/**
 * Unit tests for the `buildEffectiveRegistries` pure helper extracted
 * in PR-G3. The PluginHost suite covers integration behaviour; this
 * file pins the merge function's own contract.
 */
import { describe, expect, it } from 'vitest';

import { buildEffectiveRegistries } from '../../../../src/core/plugin/host/contributes-merger';
import { DuplicateContributionError } from '../../../../src/core/plugin/registries';
import type { Plugin } from '../../../../src/core/plugin';

const stubCtor = (label: string): unknown => ({ label });

const entry = (_id: string, contributes: Plugin<unknown>['contributes'] = {}) => ({
  plugin: { contributes },
});

describe('buildEffectiveRegistries', () => {
  it('merges core registries with no plugin contributions', () => {
    const core = {
      commands: { ping: stubCtor('core-ping') } as never,
    };
    const out = buildEffectiveRegistries([], new Map(), core);
    expect(Object.keys(out.commands)).toEqual(['ping']);
    expect(Object.keys(out.buttons)).toHaveLength(0);
  });

  it('appends plugin contributions in registration order', () => {
    const reg = new Map([
      ['p1', entry('p1', { commands: { foo: stubCtor('p1-foo') } as never })],
      ['p2', entry('p2', { commands: { bar: stubCtor('p2-bar') } as never })],
    ]);
    const out = buildEffectiveRegistries(['p1', 'p2'], reg, {});
    expect(Object.keys(out.commands).sort()).toEqual(['bar', 'foo']);
  });

  it('throws DuplicateContributionError when two sources claim the same name', () => {
    const reg = new Map([
      ['p1', entry('p1', { commands: { dup: stubCtor('p1-dup') } as never })],
      ['p2', entry('p2', { commands: { dup: stubCtor('p2-dup') } as never })],
    ]);
    expect(() => buildEffectiveRegistries(['p1', 'p2'], reg, {})).toThrowError(
      DuplicateContributionError,
    );
  });

  it('reports core vs plugin in the conflict source list', () => {
    const reg = new Map([
      ['p1', entry('p1', { commands: { ping: stubCtor('p1-ping') } as never })],
    ]);
    const core = { commands: { ping: stubCtor('core-ping') } as never };
    try {
      buildEffectiveRegistries(['p1'], reg, core);
      throw new Error('expected throw');
    } catch (err) {
      const dup = err as DuplicateContributionError;
      expect(dup.sources).toEqual(['core', 'p1']);
    }
  });

  it('treats empty plugin contributions as no-ops', () => {
    const reg = new Map([['p1', entry('p1', {})]]);
    const out = buildEffectiveRegistries(['p1'], reg, {});
    expect(Object.keys(out.commands)).toHaveLength(0);
    expect(Object.keys(out.reactions)).toHaveLength(0);
  });
});
