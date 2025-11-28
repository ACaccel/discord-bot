import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger, giveaway, misc } from '@utils';

export default class giveaway_create extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "giveaway_create",
            description: "建立抽獎",
            options: {
                string: [
                    {
                        name: "duration",
                        description: "抽獎時限 (1s, 1m, 1h, 1d, 1w)",
                        required: true
                    },{
                        name: "prize",
                        description: "獎品",
                        required: true
                    },{
                        name: "description",
                        description: "抽獎描述 (optional)",
                        required: false
                    }
                ],
                number: [
                    {
                        name: "winner_num",
                        description: "中獎人數",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const duration = interaction.options.get("duration")?.value as string;
            const winner_num = interaction.options.get("winner_num")?.value as number;
            const prize = interaction.options.get("prize")?.value as string;
            const description = interaction.options.get("description")?.value as string;
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
            function parseDuration(duration: string): number | null {
                const match = duration.match(/^(\d+)([smhdw])$/);
                if (!match) return null;
            
                const value = parseInt(match[1], 10);
                const unit = match[2];
            
                if (isNaN(value)) return null;
                switch (unit) {
                    case "s": return value * 1000;
                    case "m": return value * 60 * 1000;
                    case "h": return value * 60 * 60 * 1000;
                    case "d": return value * 24 * 60 * 60 * 1000;
                    case "w": return value * 7 * 24 * 60 * 60 * 1000;
                    default: return null;
                }
            }
            
            const durationMs = parseDuration(duration);
            if (durationMs === null) {
                await interaction.editReply({ content: "無效的持續時間" });
                return;
            }
            const current_time = Date.now();
            const end_time = current_time + durationMs;
            const end_time_date = new Date(end_time);
            
            // create giveaway announcement
            const message_id = await giveaway.giveawayAnnouncement(
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
            if (await giveaway.findGiveaway(bot, guild.id, message_id)) {
                const job = misc.scheduleJob(end_time_date, () => giveaway.scheduleGiveaway(bot, guild.id, message_id));
                bot.giveaway_jobs.set(message_id, job);
            }
    
            await interaction.editReply({ content: `抽獎已建立！將於 ${end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 結束` });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法抽獎" });
        }
    }
}