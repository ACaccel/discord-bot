import { 
    ChatInputCommandInteraction,
    GuildMember,
    MessageFlags,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { bot_cmd } from '@utils';

import { logError } from '@core/logger';
export default class roll_call extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "roll_call",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "點名",
            options: {
                string: [
                    {
                        name: "users",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "被點名者 (ex: @user1 @user2...)",
                        required: false
                    },
                    {
                        name: "activity_id",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "活動ID (用於連動活動參與者點名)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        try {
            const users = interaction.options.get("users")?.value as string | undefined;
            const activity_id = interaction.options.get("activity_id")?.value as string | undefined;

            if (!users && !activity_id) {
                await interaction.reply({ content: bot.translator?.t('replies:roll_call.missing_target') ?? '', flags: MessageFlags.Ephemeral });
                return;
            }

            let validUsers: GuildMember[] = [];

            if (activity_id) {
                const guild = interaction.guild;
                if (!guild) {
                    await interaction.reply({ content: bot.translator?.t('errors:command.guild_not_found') ?? '', flags: MessageFlags.Ephemeral });
                    return;
                }

                const repos = bot.guildInfo[guild.id]?.repos;
                if (!repos) {
                    await interaction.reply({ content: bot.translator?.t('errors:db.not_found') ?? '', flags: MessageFlags.Ephemeral });
                    return;
                }

                const activity = await repos.activity.findByActivityId(activity_id);
                if (!activity) {
                    await interaction.reply({ content: bot.translator?.t('replies:roll_call.activity_not_found', { id: activity_id }) ?? '', flags: MessageFlags.Ephemeral });
                    return;
                }

                const participants = activity.participants;
                for (const participant of participants) {
                    const member = guild.members.cache.get(participant);
                    if (member) {
                        validUsers.push(member);
                    }
                }

                if (validUsers.length === 0) {
                    await interaction.reply({ content: bot.translator?.t('replies:roll_call.no_participants') ?? '', flags: MessageFlags.Ephemeral });
                    return;
                }

                // Mongo's deleteOne is atomic: the boolean return is the
                // TOCTOU signal. If two concurrent /roll_call calls race
                // on the same activity_id, the first wins and the second
                // sees `deleted === false`; bail before re-posting the
                // announcement so the channel does not see duplicates.
                const deleted = await repos.activity.deleteByActivityId(activity_id);
                if (!deleted) {
                    await interaction.reply({
                        content:
                            bot.translator?.t('replies:roll_call.activity_already_consumed', {
                                id: activity_id,
                            }) ?? '',
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
            } else if (users) {
                if (!users.match(/^<@\d+>(\s*<@\d+>)*$/)) {
                    await interaction.reply({ content: bot.translator?.t('replies:roll_call.format_error') ?? '', flags: MessageFlags.Ephemeral });
                    return;
                }
        
                const userIds = Array.from(users.matchAll(/<@(\d+)>/g)).map(match => match[1]);
                for (const userId of userIds) {
                    const user = interaction.guild?.members.cache.get(userId);
                    if (!user) {
                        await interaction.reply({ content: bot.translator?.t('replies:roll_call.user_not_found', { id: userId }) ?? '', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    validUsers.push(user);
                }
                if (validUsers.length === 0) {
                    await interaction.reply({ content: bot.translator?.t('replies:roll_call.no_valid_id') ?? '', flags: MessageFlags.Ephemeral });
                    return;
                }
            }
    
            let announcement = bot.translator?.t('replies:roll_call.announcement_header', { userId: interaction.user.id }) ?? '';
            if (activity_id) {
                announcement += bot.translator?.t('replies:roll_call.activity_id_line', { id: activity_id }) ?? '';
            }
            let id = 1;
            validUsers.forEach(user => {
                announcement += `${id}. <@${user.id}>\n`;
                id += 1;
            });
    
            const ch = interaction.channel;
            if (!ch?.isSendable()) return;
            const msg = await ch.send({ content: announcement });
            bot_cmd.msgReact(msg, ["<:slowpoke_wave_lr:1178718404102848573>"])
            await interaction.reply({ content: bot.translator?.t('replies:roll_call.sent') ?? '', flags: MessageFlags.Ephemeral })
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: bot.translator?.t('replies:roll_call.failed') ?? '', flags: MessageFlags.Ephemeral });
        }
    }
}