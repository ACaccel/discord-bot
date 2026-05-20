import type { ChatInputCommandInteraction} from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { requireGuildRepos } from '../../require-guild-repos';

import { logError } from '@core/logger';
export default class ai_whitelist_list extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_whitelist_list',
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: '列出目前 AI 白名單的所有用戶',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const repos = await requireGuildRepos(bot, interaction);
        if (repos === null) return;

        try {
            // G-2: an `err` is re-thrown into the surrounding catch.
            const docsResult = await repos.userApiSetting.listAll();
            if (!docsResult.ok) throw docsResult.error;
            const docs = docsResult.value;
            if (docs.length === 0) {
                await interaction.editReply({ content: bot.translator?.t('replies:ai_whitelist.empty') ?? '' });
                return;
            }

            const header = bot.translator?.t('replies:ai_whitelist.header', { count: docs.length }) ?? '';
            const lines = docs.map((d) => `<@${d.userId}> — \`${d.provider}\` / \`${d.model}\``);

            // Build pages that stay within Discord's 2000-character limit.
            const MAX = 2000;
            const pages: string[] = [];
            let current = header;
            for (const line of lines) {
                const next = `${current}\n${line}`;
                if (next.length > MAX) {
                    pages.push(current);
                    current = line;
                } else {
                    current = next;
                }
            }
            pages.push(current);

            await interaction.editReply({ content: pages[0]! });
            for (let i = 1; i < pages.length; i++) {
                await interaction.followUp({ content: pages[i]!, flags: MessageFlags.Ephemeral });
            }
        } catch (err) {
            logError(bot.logger, bot.clientId, interaction.guildId, err);
            await interaction.editReply({ content: bot.translator?.t('errors:db.operation_failed') ?? '' });
        }
    }
}
