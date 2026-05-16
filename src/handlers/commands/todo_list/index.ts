import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';
import { requireGuildRepos } from '../../require-guild-repos';

export default class todo_list extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "todo_list",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "待辦事項",
            options: {
                string: [
                    {
                        name: "action",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "新增或刪除",
                        required: true,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "新增 (+ content: 內容)", value: "add" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "刪除 (+ content: 編號)", value: "delete" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "查看", value: "list" }
                        ]
                    },{
                        name: "content",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "內容 (optional)",
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

            if (action == "add") {
                const existPair = await todos.findByContent(content);
                if (existPair.length === 0) {
                    await todos.create(content);
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.added', { content }) ?? '' });
                } else {
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.already_exists', { content }) ?? '' });
                }
            } else if (action == "delete") {
                // content is index
                const todoList = await todos.listAll();
                if (!parseInt(content)) {
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.expect_number') ?? '' });
                    return;
                }
                if (parseInt(content) > todoList.length) {
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.not_found', { content }) ?? '' });
                } else {
                    const deleted_content = todoList[parseInt(content) - 1].content;
                    await todos.deleteByContent(deleted_content);
                    await interaction.editReply({ content: bot.translator?.t('replies:todo_list.deleted', { content: deleted_content }) ?? '' });
                }
            } else if (action == "list") {
                const todoList = await todos.listAll();
                let content = bot.translator?.t('replies:todo_list.header') ?? '';
                todoList.map((e, i) => {
                    content += `> ${i + 1}. ${e.content}\n`;
                });
                await interaction.editReply({ content });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:todo_list.failed') ?? '' });
        }
    }
}