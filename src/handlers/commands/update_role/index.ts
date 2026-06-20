import type {
    ChatInputCommandInteraction,
} from 'discord.js';
import Mee6LevelsApi from 'mee6-levels-api';
import type { BaseBot, Config } from '@bot';
import { Command } from '@cmd';

import { replyForError } from '../../reply-for-error';

interface UpdateRoleConfig extends Config {
    level_roles: Record<string, string>;
}

// only for Nijika
export default class update_role extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "update_role",
            category: 'admin',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            let botConfig: UpdateRoleConfig;
            if ('level_roles' in bot.config) {
                botConfig = bot.config as UpdateRoleConfig;
            } else {
                await interaction.editReply({ content: bot.translator?.t('replies:update_role.no_config') ?? '' });
                return;
            }

            const leaderboard = await Mee6LevelsApi.getLeaderboardPage(interaction.guild?.id as string);
            const guild = bot.getGuildInfo(interaction.guild?.id as string)!.guild;
            const channel = interaction.channel;
            if (!channel?.isSendable()) return;

            await Promise.all(leaderboard.map(async (member) => {
                const { id, level } = member;
                const guildMember = guild.members.cache.get(id);

                if (!guildMember) return;

                // find corresponding role
                let roleToAssign = "";
                for (const roleLevel in botConfig.level_roles) {
                    if (level >= parseInt(roleLevel.split('_')[1] ?? '0')) {
                        roleToAssign = botConfig.level_roles[roleLevel] ?? '';
                    } else {
                        break;
                    }
                }
                if (roleToAssign === "") return;

                // update role
                const addedRole = guild.roles.cache.find(role => role.name === roleToAssign);
                const hasRoleToAssign = guildMember.roles.cache.has(addedRole?.id as string);
                for (const roleLevel in botConfig.level_roles) {
                    const removedRole = guild.roles.cache.find(role => role.name === botConfig.level_roles[roleLevel]);
                    if (!removedRole) continue;

                    if (guildMember.roles.cache.has(removedRole.id) && removedRole.name !== roleToAssign) {
                        await guildMember.roles.remove(removedRole);
                        await channel.send(bot.translator?.t('replies:update_role.removed', { name: guildMember.user.displayName, role: botConfig.level_roles[roleLevel] ?? '' }) ?? '');
                    }
                }
                if (addedRole && !hasRoleToAssign) {
                    await guildMember.roles.add(addedRole);
                    await channel.send(bot.translator?.t('replies:update_role.granted', { name: guildMember.user.displayName, role: roleToAssign }) ?? '');
                }
            }));
            await interaction.editReply({ content: bot.translator?.t('replies:update_role.done') ?? '' });
        } catch (error) {
            await replyForError(interaction, bot, error, 'replies:update_role.failed', interaction.guild?.id);
        }
    }
}
