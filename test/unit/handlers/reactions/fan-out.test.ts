/**
 * Unit coverage for the reaction barrel's fan-out — the one dispatch
 * shape the generic custom-id dispatcher does not cover. A reaction
 * carries no customId, so every registered handler sees every reaction
 * and decides for itself; nothing may filter on its behalf.
 */
import type { MessageReaction, User } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { executeReactionAdded, executeReactionRemoved } from '../../../../src/handlers/reactions';
import type { ReactionHandler } from '../../../../src/handlers/reactions';
import type { BaseBot } from '../../../../src/bot';

const fakeReaction = {} as unknown as MessageReaction;
const fakeUser = {} as unknown as User;

const handlerNamed = (
  name: string,
  seen: string[],
): ReactionHandler & { added: ReturnType<typeof vi.fn> } => {
  const added = vi.fn(async () => {
    seen.push(`${name}.added`);
  });
  return {
    added,
    executeAdded: added,
    executeRemoved: async () => {
      seen.push(`${name}.removed`);
    },
  } as unknown as ReactionHandler & { added: ReturnType<typeof vi.fn> };
};

const botWith = (handlers: Map<string, ReactionHandler>): BaseBot =>
  ({ reactionHandlers: handlers, logger: undefined }) as unknown as BaseBot;

describe('reaction fan-out', () => {
  it('offers an added reaction to every registered handler', async () => {
    const seen: string[] = [];
    const bot = botWith(
      new Map([
        ['a', handlerNamed('a', seen)],
        ['b', handlerNamed('b', seen)],
      ]),
    );

    await executeReactionAdded(fakeReaction, fakeUser, bot);

    expect(seen).toEqual(['a.added', 'b.added']);
  });

  it('offers a removed reaction to every registered handler', async () => {
    const seen: string[] = [];
    const bot = botWith(
      new Map([
        ['a', handlerNamed('a', seen)],
        ['b', handlerNamed('b', seen)],
      ]),
    );

    await executeReactionRemoved(fakeReaction, fakeUser, bot);

    expect(seen).toEqual(['a.removed', 'b.removed']);
  });

  it('does nothing when no reaction handler is registered', async () => {
    const bot = botWith(new Map());
    await expect(executeReactionAdded(fakeReaction, fakeUser, bot)).resolves.toBeUndefined();
    await expect(executeReactionRemoved(fakeReaction, fakeUser, bot)).resolves.toBeUndefined();
  });
});
