import {
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { logger, misc } from '@utils';
import {
    giveawayAnnouncement,
    findGiveaway,
    scheduleGiveaway,
    IGiveawayBot,
    giveawayJobKey,
} from './giveaway';

export const handleGiveawayCreate = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IGiveawayBot,
): Promise<void> => {
    await interaction.deferReply();
    try {
        const duration = interaction.options.get("duration")?.value as string | null;
        const winner_num = interaction.options.get("winner_num")?.value as number | null;
        const prize = interaction.options.get("prize")?.value as string | null;
        const description = interaction.options.get("description")?.value as string | null;

        if (!duration || !winner_num || !prize) {
            await interaction.editReply({ content: "請輸入持續時間、得獎人數和獎品" });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }

        const channel_id = bot.guildInfo[guild.id].channels?.giveaway?.id;
        if (!channel_id) {
            await interaction.editReply({ content: "抽獎頻道未設定" });
            return;
        }

        const channel = interaction.guild.channels.cache.get(channel_id);
        if (!channel?.isSendable()) {
            await interaction.editReply({ content: "找不到頻道" });
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

        // create giveaway announcement
        const message_id = await giveawayAnnouncement(
            channel,
            prize,
            interaction.user.id,
            winner_num,
            end_time_date,
            description || "無"
        );
        if (!message_id) {
            await interaction.editReply({ content: "無法建立抽獎" });
            return;
        }

        // save giveaway to database
        const newGiveaway = new db.models["Giveaway"]({
            winner_num: winner_num,
            prize: prize,
            end_time: end_time,
            channel_id: channel.id,
            prize_owner_id: interaction.user.id,
            participants: [],
            message_id: message_id
        });
        await newGiveaway.save();

        // schedule job to find winner
        if (await findGiveaway(bot, guild.id, message_id)) {
            const job = misc.scheduleJob(end_time_date, () => scheduleGiveaway(bot, guild.id, message_id));
            bot.jobs.set(giveawayJobKey(message_id), job);
        }

        await interaction.editReply({ content: `抽獎已建立！將於 ${end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 結束` });
    } catch (error) {
        logger.errorLogger(bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: "無法抽獎" });
    }
};

export const handleGiveawayDelete = async (
    interaction: ChatInputCommandInteraction,
    bot: BaseBot & IGiveawayBot,
): Promise<void> => {
    await interaction.deferReply();
    try {
        const message_id = interaction.options.get("message_id")?.value as string | null;
        if (!message_id) {
            await interaction.editReply({ content: "請提供抽獎訊息ID" });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }

        const result = await import('./giveaway').then(m => m.deleteGiveaway(bot, guild.id, message_id));
        if (typeof result === 'string' && result !== null) {
            await interaction.editReply({ content: `無法刪除抽獎: ${result}` });
            return;
        }

        await interaction.editReply({ content: "抽獎已刪除" });
    } catch (error) {
        logger.errorLogger(bot.clientId, interaction.guild?.id ?? null, error);
        await interaction.editReply({ content: "無法刪除抽獎" });
    }
};