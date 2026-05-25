import { describe, expect, it, vi } from 'vitest';

import { bindTranslator } from '../../../../src/core/i18n';
import type { Translator } from '../../../../src/core/i18n';

describe('bindTranslator', () => {
  it('returns the key itself when translator is undefined', () => {
    const t = bindTranslator(undefined);
    expect(t('replies:foo.bar')).toBe('replies:foo.bar');
    expect(t('replies:foo.bar', { name: 'x' })).toBe('replies:foo.bar');
  });

  it('delegates to translator.t with params when present', () => {
    const fake: Pick<Translator, 't'> = {
      t: vi.fn((key: string, params?: Record<string, string | number>) =>
        params === undefined ? `[${key}]` : `[${key}:${JSON.stringify(params)}]`,
      ),
    };
    const t = bindTranslator(fake as Translator);
    expect(t('replies:x.y')).toBe('[replies:x.y]');
    expect(t('replies:x.y', { a: 1 })).toBe('[replies:x.y:{"a":1}]');
    expect(fake.t).toHaveBeenCalledTimes(2);
  });
});
