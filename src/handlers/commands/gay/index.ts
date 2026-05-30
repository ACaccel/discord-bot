import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

const IS_GAY_PROBABILITY = 0.95;

export default class gay extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'gay',
      category: 'fun',
      options: {
        user: [
          {
            name: 'user',
            required: true,
          },
        ],
      },
    });
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    const userId = interaction.options.get('user')?.value;
    if (!interaction.guild?.members.cache.has(userId as string)) return;

    const target = interaction.guild.members.cache.get(userId as string);
    const t = bot.translator;
    // Defensive guard for the pre-run() window: the translator field is
    // only set once `run()` resolves. The early-return keeps the strict
    // typecheck honest and silently no-ops when the target is unknown.
    if (t === undefined || target === undefined) return;

    const key =
      Math.random() < IS_GAY_PROBABILITY ? 'replies:gay.is_gay' : 'replies:gay.is_not_gay';
    await interaction.reply({ content: t.t(key, { name: target.displayName }) });
  }
}
