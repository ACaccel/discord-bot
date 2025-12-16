import { 
    ChatInputCommandInteraction,
    GuildMember,
    Role,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger, bot_cmd } from '@utils';

export default class role_message extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "role_message",
            description: "發送身份組領取訊息",
            options: {
                string: [
                    {
                        name: "roles",
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
                await interaction.editReply({ content: "找不到伺服器" });
                return;
            }
            const member = interaction.member as GuildMember;
            if (!member.permissions.has("ManageRoles")) {
                await interaction.editReply({ content: "你沒有權限發送身份組領取訊息" });
                return;
            }
    
            // Verify IDs format and existence
            const roles = interaction.options.get("roles")?.value as string;
            if (!roles || !roles.match(/^<@&\d+>(\s*<@&\d+>)*$/)) {
                await interaction.editReply({ content: "格式錯誤！regex: match(/^<@&\d+>(\s*<@&\d+>)*$/)" });
                return;
            }
            // Extract role IDs from mentions
            const roleIds = Array.from(roles.matchAll(/<@&(\d+)>/g)).map(match => match[1]);
            const validRoles: Role[] = [];
            for (const roleId of roleIds) {
                const role = guild.roles.cache.get(roleId);
                if (!role) {
                    await interaction.editReply({ content: `找不到ID為 ${roleId} 的身份組, 請確認ID是否正確` });
                    return;
                }
                validRoles.push(role);
            }
            if (validRoles.length === 0) {
                await interaction.editReply({ content: "請至少提供一個有效的身份組ID" });
                return;
            }
    
            // build buttons
            const button_config = validRoles.map(role => ({
                customId: `toggle_role|${role.id}`,
                label: role.name
            }))
            const rows = bot_cmd.buildButtonRows(button_config);
    
            await interaction.editReply({
                content: "請選擇你要領取的身份組：",
                components: rows
            });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法發送身份組領取訊息" });
        }
    }
}