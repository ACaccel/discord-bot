/**
 * AutoReplyPlugin — Discord `messageCreate` subscriber that performs
 * the legacy `auto_reply` behaviour as a self-contained plugin.
 *
 * Behaviours preserved verbatim from `src/events/message_reply.ts` so
 * Phase 4b is behaviour-neutral:
 *   - Hard-coded reaction to the "肥貓晚安" line (fires even for bots).
 *   - DB-backed reply lookup via `ReplyRepo.findByInput`; random pick
 *     when multiple replies match the same input.
 *   - Per-user lucky replies (fatcat / mubaimu) at fixed probabilities.
 *   - Global lucky "[*]" reply at 0.5% probability.
 *   - `長髮男` regex reply.
 *   - `<count>d<sides>` dice expression with the original 0 < count <
 *     100 and 0 < sides < 2^30 bounds.
 *
 * DI: the plugin resolves {@link GuildRegistry} per event from
 * `ctx.resolve`. The resolver is a O(1) map lookup and avoids holding
 * mutable plugin state across the host's lifecycle.
 */
import { TOKENS } from '../../core/ioc';
import type { GuildRegistry } from '../../core/guild-registry';
import type { Logger } from '../../core/logger';
import type { Plugin } from '../../core/plugin';

const PLUGIN_ID = 'auto-reply';
const PLUGIN_VERSION = '1.0.0';

const FATCAT_USER_ID = '516912789369913371';
const MUBAIMU_USER_ID = '705605105352966144';
const FATCAT_PROBABILITY = 0.01;
const MUBAIMU_PROBABILITY = 0.005;
const LUCKY_GLOBAL_PROBABILITY = 0.005;

// i18n-ignore: trigger-matching keyword/regex, not user-facing prose.
const LONG_HAIR_REGEX = /長髮男(?=\s|$)/;
const DICE_REGEX = /^(\d+)d(\d+)$/;
const DICE_MAX_COUNT = 100;
const DICE_MAX_SIDES = 2 ** 30;

// i18n-ignore: trigger-matching keyword, not a user-facing reply.
const GOODNIGHT_LINE = '該睡覺了，肥貓跟你說晚安';

/** Roll dice; `null` when the input is not a dice expression. */
export const rollDice = (msg: string): string | null => {
  const match = DICE_REGEX.exec(msg);
  if (match === null) return null;
  const count = Number.parseInt(match[1] as string, 10);
  const sides = Number.parseInt(match[2] as string, 10);
  if (count <= 0 || count > DICE_MAX_COUNT || sides <= 0 || sides > DICE_MAX_SIDES) {
    return `out of range (0 < count < ${DICE_MAX_COUNT}, 0 < sides < 2^30)`;
  }
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  return `🎲 ${count}d${sides}: [${rolls.join(', ')}]`;
};

/**
 * Look up a reply for `input` from the per-guild ReplyRepo. Returns a
 * matching reply (uniformly random when multiple match), or `null`
 * when nothing matches. Repo failures propagate; the caller is
 * expected to catch and log.
 */
export const lookupReply = async (
  registry: GuildRegistry,
  guildId: string,
  input: string,
): Promise<string | null> => {
  const repos = registry.getRepos(guildId);
  if (repos === undefined) return null;
  const results = await repos.reply.findByInput(input);
  if (results.length === 0) return null;
  const pick = results[Math.floor(Math.random() * results.length)];
  return pick?.reply ?? null;
};

const safeLookup = async (
  registry: GuildRegistry,
  guildId: string,
  input: string,
  logger: Logger,
  context: string,
): Promise<string | null> => {
  try {
    return await lookupReply(registry, guildId, input);
  } catch (err: unknown) {
    logger.error(
      { err: err instanceof Error ? err : new Error(String(err)), guildId, context },
      'auto-reply: reply lookup threw; continuing with static behaviours',
    );
    return null;
  }
};

export const AutoReplyPlugin: Plugin = {
  id: PLUGIN_ID,
  version: PLUGIN_VERSION,
  scope: 'bot',
  critical: false,

  events: {
    messageCreate: async (ctx, message): Promise<void> => {
      // `ctx.resolve` is O(1) and returns the singleton — cheap to call
      // per message and avoids mutable plugin state. Logger is already
      // bound to `{ plugin: 'auto-reply' }` by the host.
      const registry = ctx.resolve(TOKENS.GuildRegistry);
      const logger = ctx.logger;
      const t = ctx.translator;

      if (!message.channel.isSendable()) return;
      if (message.guildId === null) return;
      const guildId = message.guildId;

      if (message.content.includes(GOODNIGHT_LINE)) {
        await message.reply(t.t('replies:auto_reply.goodnight_reply'));
      }

      // The remaining behaviours all skip bot authors so two bots
      // running this plugin do not feedback-loop each other.
      if (message.author.bot) return;

      const reply = await safeLookup(registry, guildId, message.content, logger, 'direct');
      if (reply !== null) {
        await message.channel.send({ content: reply });
      }

      if (message.author.id === FATCAT_USER_ID && Math.random() < FATCAT_PROBABILITY) {
        await message.channel.send(t.t('replies:auto_reply.fatcat_line'));
      }
      if (message.author.id === MUBAIMU_USER_ID && Math.random() < MUBAIMU_PROBABILITY) {
        await message.channel.send(t.t('replies:auto_reply.mubaimu_line'));
      }
      if (Math.random() < LUCKY_GLOBAL_PROBABILITY) {
        const lucky = await safeLookup(registry, guildId, '[*]', logger, 'lucky');
        if (lucky !== null) {
          await message.channel.send({ content: lucky });
        }
      }

      if (LONG_HAIR_REGEX.test(message.content)) {
        await message.channel.send(t.t('replies:auto_reply.long_hair_line'));
      }

      const diceResult = rollDice(message.content);
      if (diceResult !== null) {
        await message.channel.send(diceResult);
      }
    },
  },
};
