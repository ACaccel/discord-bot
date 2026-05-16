import { 
    ChatInputCommandInteraction,
    GuildMember,
    Role,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { bot_cmd } from '@utils';

import { logError } from '@core/logger';
export default class role_message extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "role_message",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "發送身份組領取訊息",
            options: {
                string: [
                    {
                        name: "roles",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "可領取身份組id (ex: @身份組1 @身份組2...)",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_not_found') ?? '' });
                return;
            }
            const member = interaction.member as GuildMember;
            if (!member.permissions.has("ManageRoles")) {
                await interaction.editReply({ content: bot.translator?.t('replies:role_message.no_permission') ?? '' });
                return;
            }
    
            // Verify IDs format and existence
            const roles = interaction.options.get("roles")?.value as string;
            if (!roles || !roles.match(/^<@&\d+>(\s*<@&\d+>)*$/)) {
                await interaction.editReply({ content: bot.translator?.t('replies:role_message.format_error') ?? '' });
                return;
            }
            // Extract role IDs from mentions
            const roleIds = Array.from(roles.matchAll(/<@&(\d+)>/g)).map(match => match[1]);
            const validRoles: Role[] = [];
            for (const roleId of roleIds) {
                const role = guild.roles.cache.get(roleId);
                if (!role) {
                    await interaction.editReply({ content: bot.translator?.t('replies:role_message.role_not_found', { id: roleId }) ?? '' });
                    return;
                }
                validRoles.push(role);
            }
            if (validRoles.length === 0) {
                await interaction.editReply({ content: bot.translator?.t('replies:role_message.no_valid_id') ?? '' });
                return;
            }
    
            // build buttons
            const button_config = validRoles.map(role => ({
                customId: `toggle_role|${role.id}`,
                label: role.name
            }))
            const rows = bot_cmd.buildButtonRows(button_config);
    
            await interaction.editReply({
                content: bot.translator?.t('replies:role_message.prompt') ?? '',
                components: rows
            });
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:role_message.failed') ?? '' });
        }
    }
}