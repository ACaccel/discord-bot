/**
 * `/roll_call` reaction tally.
 *
 * The tally recognises its own announcement by prefix. That prefix must
 * come from the catalog, not a zh-TW literal: an English-locale bot
 * posts `Lady Sakiko's roll-call list: …`, which never matched the
 * hard-coded zh-TW string, so ticking a name did nothing at all.
 */
import { describe, expect, it, vi } from 'vitest';

import RollCallReaction from '../../../../src/handlers/reactions/roll_call';
import type { BaseBot } from '../../../../src/bot';

const PREFIXES = {
  'zh-TW': '初華大人的點名簿',
  en: "Lady Sakiko's roll-call list",
} as const;

const botWithPrefix = (prefix: string): BaseBot =>
  ({
    translator: {
      t: (key: string) => (key === 'replies:roll_call.trigger_prefix' ? prefix : key),
    },
  }) as unknown as BaseBot;

interface ReactionFixture {
  readonly edit: ReturnType<typeof vi.fn>;
  readonly reaction: Parameters<RollCallReaction['executeAdded']>[0];
}

const reactionOn = (content: string, reactedIds: readonly string[]): ReactionFixture => {
  const edit = vi.fn(async () => undefined);
  const reaction = {
    message: { content, edit },
    users: { cache: new Map(reactedIds.map((id) => [id, {}])) },
  } as unknown as Parameters<RollCallReaction['executeAdded']>[0];
  return { edit, reaction };
};

const user = {} as Parameters<RollCallReaction['executeAdded']>[1];

describe('roll_call reaction tally', () => {
  it.each(Object.entries(PREFIXES))(
    'updates the tally for the %s announcement',
    async (_locale, prefix) => {
      const content = `${prefix}: <@1> started a roll call!\n1. <@100> \n2. <@200> \n`;
      const { edit, reaction } = reactionOn(content, ['100']);

      await new RollCallReaction().executeAdded(reaction, user, botWithPrefix(prefix));

      expect(edit).toHaveBeenCalledTimes(1);
      const rendered = edit.mock.calls[0]?.[0] as string;
      expect(rendered).toContain('1. ✅ <@100>');
      expect(rendered).toContain('2. <@200>');
    },
  );

  it('ignores a message that is not a roll-call announcement', async () => {
    const { edit, reaction } = reactionOn('just a normal message <@100>', ['100']);

    await new RollCallReaction().executeAdded(reaction, user, botWithPrefix(PREFIXES['zh-TW']));

    expect(edit).not.toHaveBeenCalled();
  });

  it('does nothing when the translator cannot resolve the prefix', async () => {
    const { edit, reaction } = reactionOn('anything', []);
    const bot = { translator: undefined } as unknown as BaseBot;

    await new RollCallReaction().executeRemoved(reaction, user, bot);

    expect(edit).not.toHaveBeenCalled();
  });
});
