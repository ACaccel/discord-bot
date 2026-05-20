import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { requireGuildRepos } from '../../require-guild-repos';

import { replyForError } from '../../reply-for-error';
export default class add_reply extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "add_reply",
            options: {
                string: [
                    {
                        name: "keyword",
                        required: true
                    },{
                        name: "reply",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const input = interaction.options.get("keyword")?.value as string;
            const reply = interaction.options.get("reply")?.value as string;

            const repos = await requireGuildRepos(bot, interaction);
            if (repos === null) return;
            // G-2: repo methods return Result<T, DatabaseError>. An `err`
            // is re-thrown so the surrounding catch runs the unchanged
            // log + failure-reply path — behaviour-equivalent to the
            // pre-G-2 raw-mongoose-error propagation.
            const existPairResult = await repos.reply.findExactPair(input, reply);
            if (!existPairResult.ok) throw existPairResult.error;
            const existPair = existPairResult.value;

            if (existPair.length === 0) {
                const createResult = await repos.reply.create(input, reply);
                if (!createResult.ok) throw createResult.error;
                await interaction.editReply({ content: bot.translator?.t('replies:add_reply.added', { input, reply }) ?? '' });
            } else {
                await interaction.editReply({ content: bot.translator?.t('replies:add_reply.already_exists', { input, reply }) ?? '' });
            }
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:add_reply.failed', interaction.guild?.id);
        }
    }
}