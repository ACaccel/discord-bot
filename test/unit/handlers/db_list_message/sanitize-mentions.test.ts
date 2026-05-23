import { describe, expect, it } from 'vitest';

import { sanitizeMentions } from '../../../../src/handlers/commands/db_list_message/sanitize-mentions';

describe('sanitizeMentions', () => {
  it('inserts a zero-width space into @everyone and @here', () => {
    expect(sanitizeMentions('hello @everyone')).toBe('hello @​everyone');
    expect(sanitizeMentions('hi @here')).toBe('hi @​here');
  });

  it('demotes user mentions to readable @user(id)', () => {
    expect(sanitizeMentions('<@123>')).toBe('@user(123)');
    expect(sanitizeMentions('<@!456>')).toBe('@user(456)');
  });

  it('demotes role mentions to readable @role(id)', () => {
    expect(sanitizeMentions('<@&789>')).toBe('@role(789)');
  });

  it('leaves plain text untouched', () => {
    expect(sanitizeMentions('hello world')).toBe('hello world');
  });
});
