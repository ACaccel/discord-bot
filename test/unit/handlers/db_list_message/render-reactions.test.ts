import { describe, expect, it } from 'vitest';

import { buildReactionText } from '../../../../src/handlers/commands/db_list_message/render-reactions';

describe('buildReactionText', () => {
  it('renders custom static emoji as <:name:id>', () => {
    expect(buildReactionText({ id: '123', name: 'foo', animated: false })).toBe('<:foo:123>');
  });

  it('renders custom animated emoji as <a:name:id>', () => {
    expect(buildReactionText({ id: '999', name: 'wave', animated: true })).toBe('<a:wave:999>');
  });

  it('falls back to the unicode name when no id is stored', () => {
    expect(buildReactionText({ id: '', name: 'thumbsup', animated: false })).toBe('thumbsup');
  });

  it('returns a placeholder when neither id nor name is present', () => {
    expect(buildReactionText({ id: '', name: '', animated: false })).toBe('[unknown_reaction]');
  });
});
