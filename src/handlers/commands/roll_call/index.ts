import type { 
    ChatInputCommandInteraction,
    GuildMember} from 'discord.js';
import {
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';
import { bot_cmd } from '@utils';

import { replyForError } from '../../reply-for-error';
export default class roll_call extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "roll_call",
            options: {
                string: [
                    {
                        name: "users",
                        required: false
                    },
                    {
                        name: "activity_id",
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

            const validUsers: GuildMember[] = [];

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

                // G-2: an `err` is re-thrown into the surrounding catch.
                const activityResult = await repos.activity.findByActivityId(activity_id);
                if (!activityResult.ok) throw activityResult.error;
                const activity = activityResult.value;
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
                const deletedResult = await repos.activity.deleteByActivityId(activity_id);
                if (!deletedResult.ok) throw deletedResult.error;
                if (!deletedResult.value) {
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
        
                const userIds = Array.from(users.matchAll(/<@(\d+)>/g)).map(match => match[1] as string);
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
            await replyForError(interaction, bot, error, 'replies:roll_call.failed', interaction.guild?.id);
        }
    }
}