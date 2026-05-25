import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { requireGuildRepos } from '../../require-guild-repos';

import { replyForError } from '../../reply-for-error';
export default class todo_list extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "todo_list",
            options: {
                string: [
                    {
                        name: "action",
                        required: true,
                        choices: [
                            { value: "add" },
                            { value: "delete" },
                            { value: "list" }
                        ]
                    },{
                        name: "content",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const action = interaction.options.get("action")?.value as string;
            const content = interaction.options.get("content")?.value as string;
    
            if (!content && action !== "list") {
                await interaction.editReply({ content: bot.translator?.t('replies:todo_list.missing_content') ?? '' });
                return;
            }
    
            const repos = await requireGuildRepos(bot, interaction);
            if (repos === null) return;
            const todos = repos.todo;

            // Repo methods return Result<T, DatabaseError>. An `err`
            // is re-thrown into the surrounding catch.
            if (action === "add") {
                const existPairResult = await todos.findByContent(content);
                if (!existPairResult.ok) throw existPairResult.error;
                if (existPairResult.value.length === 0) {
                    const createResult = await todos.create(content);
                    if (!createResult.ok) throw createResult.error;
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.added', { content }) ?? '' });
                } else {
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.already_exists', { content }) ?? '' });
                }
            } else if (action === "delete") {
                // content is index
                const todoListResult = await todos.listAll();
                if (!todoListResult.ok) throw todoListResult.error;
                const todoList = todoListResult.value;
                if (!parseInt(content)) {
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.expect_number') ?? '' });
                    return;
                }
                if (parseInt(content) > todoList.length) {
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.not_found', { content }) ?? '' });
                } else {
                    // Index is in bounds: the `> todoList.length` guard above rejects out-of-range input.
                    const deleted_content = todoList[parseInt(content) - 1]!.content;
                    const deleteResult = await todos.deleteByContent(deleted_content);
                    if (!deleteResult.ok) throw deleteResult.error;
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.deleted', { content: deleted_content }) ?? '' });
                }
            } else if (action === "list") {
                const todoListResult = await todos.listAll();
                if (!todoListResult.ok) throw todoListResult.error;
                const todoList = todoListResult.value;
                let content = bot.translator?.t('replies:todo_list.header') ?? '';
                todoList.map((e, i) => {
                    content += `> ${i + 1}. ${e.content}\n`;
                });
                await interaction.editReply({ content });
            }
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:todo_list.failed', interaction.guild?.id);
        }
    }
}