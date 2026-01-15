import { 
    ChatInputCommandInteraction,
    GuildMember,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger, bot_cmd } from '@utils';

export default class roll_call extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "roll_call",
            description: "點名",
            options: {
                string: [
                    {
                        name: "users",
                        description: "被點名者 (ex: @user1 @user2...)",
                        required: false
                    },
                    {
                        name: "activity_id",
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
                await interaction.reply({ content: "請提供被點名者 (users) 或活動ID (activity_id)", ephemeral: true });
                return;
            }

            let validUsers: GuildMember[] = [];

            if (activity_id) {
                const guild = interaction.guild;
                if (!guild) {
                    await interaction.reply({ content: "找不到伺服器", ephemeral: true });
                    return;
                }

                const db = bot.guildInfo[guild.id].db;
                if (!db) {
                    await interaction.reply({ content: "找不到資料庫", ephemeral: true });
                    return;
                }

                const activity = await db.models["Activity"].findOne({ activity_id });
                if (!activity) {
                    await interaction.reply({ content: `找不到活動ID為 ${activity_id} 的活動`, ephemeral: true });
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
                    await interaction.reply({ content: "該活動目前沒有參與者", ephemeral: true });
                    return;
                }

                await db.models["Activity"].deleteOne({ activity_id });
            } else if (users) {
                if (!users.match(/^<@\d+>(\s*<@\d+>)*$/)) {
                    await interaction.reply({ content: "格式錯誤！regex: match(/^<@\d+>(\s*<@\d+>)*$/)", ephemeral: true });
                    return;
                }
        
                const userIds = Array.from(users.matchAll(/<@(\d+)>/g)).map(match => match[1]);
                for (const userId of userIds) {
                    const user = interaction.guild?.members.cache.get(userId);
                    if (!user) {
                        await interaction.reply({ content: `找不到ID為 ${userId} 的使用者, 請確認ID是否正確`, ephemeral: true });
                        return;
                    }
                    validUsers.push(user);
                }
                if (validUsers.length === 0) {
                    await interaction.reply({ content: "請至少提供一個有效的使用者ID", ephemeral: true });
                    return;
                }
            }
    
            let announcement = `初華大人的點名簿：<@${interaction.user.id}> 發起了點名！\n`;
            if (activity_id) {
                announcement += `(活動ID: ${activity_id})\n`;
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
            await interaction.reply({ content: "點名已發送！", ephemeral: true })
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.reply({ content: "無法進行點名", ephemeral: true });
        }
    }
}