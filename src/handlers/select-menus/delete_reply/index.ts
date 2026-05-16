import {
    StringSelectMenuInteraction,
    MessageFlags,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SSMHandler } from '@select-menu';
import { requireGuildRepos } from '../../require-guild-repos';

export default class delete_reply extends SSMHandler {
    public override async execute(interaction: StringSelectMenuInteraction, bot: BaseBot): Promise<void> {
        const key = interaction.customId.split('|')[1];
        const value = interaction.values[0];

        const repos = await requireGuildRepos(bot, interaction);
        if (repos === null) return;

        const pair = await repos.reply.findById(value);
        if (!pair) {
            await interaction.reply({ content: bot.translator?.t('replies:delete_reply.record_not_found') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }
        const replymsg = pair.reply;
        await repos.reply.deleteById(value);

        await interaction.reply({ content: bot.translator?.t('replies:delete_reply.deleted', { key, reply: replymsg }) ?? '' });
    }
}