import type { 
    ChatInputCommandInteraction,
    GuildMember,
    Role,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import { bot_cmd } from '@utils';

import { replyForError } from '../../reply-for-error';
export default class role_message extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "role_message",
            options: {
                string: [
                    {
                        name: "roles",
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
            const roleIds = Array.from(roles.matchAll(/<@&(\d+)>/g)).map(match => match[1] as string);
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
            await replyForError(interaction, bot, error, 'replies:role_message.failed', interaction.guild?.id);
        }
    }
}