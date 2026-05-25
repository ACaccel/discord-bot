import { describe, expect, it } from 'vitest';

import { clampOptions } from '../../../../src/handlers/commands/emoji_frequency/clamp-options';

describe('clampOptions', () => {
  it('clamps topN above 30 down to 30', () => {
    expect(clampOptions({ topN: 50, lastNMonths: 1 }).topN).toBe(30);
  });

  it('clamps lastNMonths above 24 down to 24', () => {
    expect(clampOptions({ topN: 5, lastNMonths: 36 }).lastNMonths).toBe(24);
  });

  it('leaves values within bounds untouched', () => {
    expect(clampOptions({ topN: 5, lastNMonths: 3 })).toEqual({ topN: 5, lastNMonths: 3 });
  });
});
