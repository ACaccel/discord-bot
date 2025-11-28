import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import Mee6LevelsApi from 'mee6-levels-api';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';
import { Nijika } from 'bot/nijika/nijika';

// only for Nijika
export default class update_role extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "update_role",
            description: "更新Mee6等級身分組"
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            if (!(bot instanceof Nijika)) return;

            let leaderboard = await Mee6LevelsApi.getLeaderboardPage(interaction.guild?.id as string);
            let guild = bot.guildInfo[interaction.guild?.id as string].guild;
            const channel = interaction.channel;
            if (!channel?.isSendable()) return;
            // let alive_role = guild.roles.cache.find(role => role.name === "活人");
    
            await Promise.all(leaderboard.map(async (member) => {
                let { id, level } = member;
                let guildMember = guild.members.cache.get(id);
    
                if (guildMember) { } else return;
                // live people role.
                // if(level >= 6) {
                // 	if (!guildMember.roles.cache.some(role => role.name === "活人")) {
                // 		let _ = await guildMember.roles.add(alive_role);
                // 		interaction.channel.send(`[ SYSTEM ] 給予 ${guildMember.user.tag} 活人`);
                // 	}
                // }
    
                // find corresponding role
                let roleToAssign = "";
                for (const roleLevel in bot.config.level_roles) {
                    if (level >= parseInt(roleLevel.split('_')[1])) {
                        roleToAssign = bot.config.level_roles[roleLevel];
                    } else {
                        break;
                    }
                }
                if (roleToAssign === "") return;
    
                // update role
                const addedRole = guild.roles.cache.find(role => role.name === roleToAssign);
                const hasRoleToAssign = guildMember.roles.cache.has(addedRole?.id as string);
                for (const roleLevel in bot.config.level_roles) {
                    const removedRole = guild.roles.cache.find(role => role.name === bot.config.level_roles[roleLevel]);
                    if (!removedRole) continue;
                    
                    if (guildMember.roles.cache.has(removedRole.id) && removedRole.name !== roleToAssign) {
                        await guildMember.roles.remove(removedRole);
                        await channel.send(`[ SYSTEM ] ${guildMember.user.displayName}, 移除: ${bot.config.level_roles[roleLevel]}`);
                    }
                }
                if (addedRole && !hasRoleToAssign) {
                    await guildMember.roles.add(addedRole);
                    await channel.send(`[ SYSTEM ] ${guildMember.user.displayName}, 獲得: ${roleToAssign}`);
                }
            }));
            await interaction.editReply({ content: "更新完成" });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法更新身份組" });
        }
    }
}