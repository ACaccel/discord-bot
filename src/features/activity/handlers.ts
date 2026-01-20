import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { logger, misc, JobManager } from '@utils';
import {
    activityAnnouncement,
    findActivity,
    scheduleActivity,
    deleteActivity,
    IActivityBot,
    activityJobKey,
} from './activity';

export const handleActivityCreate = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IActivityBot,
): Promise<void> => {
    await interaction.deferReply();
    try {
        const title = interaction.options.get("title")?.value as string | null;
        const duration = interaction.options.get("duration")?.value as string | null;
        const description = interaction.options.get("description")?.value as string | null;

        if (!duration || !title) {
            await interaction.editReply({ content: "請輸入活動標題和持續時間" });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }

        const channel = interaction.channel;
        if (!channel?.isSendable()) {
            await interaction.editReply({ content: "找不到頻道或頻道不可發送訊息" });
            return;
        }

        const db = bot.guildInfo[guild.id].db;
        if (!db) {
            await interaction.editReply({ content: "找不到資料庫" });
            return;
        }

        // parse duration
        const durationMs = misc.parseDuration(duration);
        if (durationMs === null) {
            await interaction.editReply({ content: "無效的持續時間" });
            return;
        }

        const current_time = Date.now();
        const end_time = current_time + durationMs;
        const end_time_date = new Date(end_time);

        // create activity announcement
        const activity_id = current_time.toString(); // use timestamp as activity id
        const message_id = await activityAnnouncement(
            activity_id,
            channel,
            title,
            description || "無",
            end_time_date
        );
        if (!message_id) {
            await interaction.editReply({ content: "無法建立活動" });
            return;
        }

        // save activity to database
        const newActivity = new db.models["Activity"]({
            activity_id: activity_id,
            message_id: message_id,
            title: title,
            description: description || "",
            expired_at: end_time,
            channel_id: channel.id,
            participants: [],
        });
        await newActivity.save();

        // schedule job to close activity
        if (await findActivity(bot, guild.id, activity_id)) {
            new JobManager(bot.jobs).schedule(activityJobKey(activity_id), end_time_date, () => scheduleActivity(bot, guild.id, activity_id));
        }

        await interaction.editReply({ 
            content: `活動已建立！\n**活動ID**: ${activity_id}\n將於 ${end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 結束` 
        });
    } catch (error) {
        logger.errorLogger(bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: "無法建立活動" });
    }
};

export const handleActivityDelete = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IActivityBot,
): Promise<void> => {
    await interaction.deferReply();
    try {
        const activity_id = interaction.options.get("activity_id")?.value as string | null;
        if (!activity_id) {
            await interaction.editReply({ content: "請提供活動ID" });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }

        const result = await deleteActivity(bot, guild.id, activity_id);
        if (typeof result === 'string' && result !== null) {
            await interaction.editReply({ content: `無法刪除活動: ${result}` });
            return;
        }

        await interaction.editReply({ content: "活動已刪除" });
    } catch (error) {
        logger.errorLogger(bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: "無法刪除活動" });
    }
};
