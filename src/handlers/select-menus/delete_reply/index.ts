import type {
    StringSelectMenuInteraction} from 'discord.js';
import {
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { SSMHandler } from '@select-menu';
import { requireGuildRepos } from '../../require-guild-repos';

export default class delete_reply extends SSMHandler {
    public override async execute(interaction: StringSelectMenuInteraction, bot: BaseBot): Promise<void> {
        const key = interaction.customId.split('|')[1] ?? '';
        const value = interaction.values[0] ?? '';

        const repos = await requireGuildRepos(bot, interaction);
        if (repos === null) return;

        // G-2: repo methods return Result<T, DatabaseError>. An `err`
        // is re-thrown so it propagates to the dispatcher's catch
        // exactly as a raw mongoose error did before G-2.
        const pairResult = await repos.reply.findById(value);
        if (!pairResult.ok) throw pairResult.error;
        const pair = pairResult.value;
        if (!pair) {
            await interaction.reply({ content: bot.translator?.t('replies:delete_reply.record_not_found') ?? '', flags: MessageFlags.Ephemeral });
            return;
        }
        const replymsg = pair.reply;
        const deleteResult = await repos.reply.deleteById(value);
        if (!deleteResult.ok) throw deleteResult.error;

        await interaction.reply({ content: bot.translator?.t('replies:delete_reply.deleted', { key, reply: replymsg }) ?? '' });
    }
}