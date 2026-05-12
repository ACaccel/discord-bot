import { ChatInputCommandInteraction } from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

const IS_GAY_PROBABILITY = 0.95;

export default class gay extends Command {
  constructor() {
    super();
    this.setConfig({
      // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations / description_localizations.
      name: 'gay',
      // i18n-ignore: command-builder metadata; localised in PR 6-3.
      description: '是不是給',
      options: {
        user: [
          {
            name: 'user',
            // i18n-ignore: command-builder metadata; localised in PR 6-3.
            description: '選擇對象',
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
    // Defensive guard for the pre-run() window. Once `run()` resolves
    // the translator field is set; the early-return keeps the strict
    // typecheck honest while preserving the legacy "silently no-op
    // when target is unknown" behaviour.
    if (t === undefined || target === undefined) return;

    const key =
      Math.random() < IS_GAY_PROBABILITY ? 'replies:gay.is_gay' : 'replies:gay.is_not_gay';
    await interaction.reply({ content: t.t(key, { name: target.displayName }) });
  }
}
