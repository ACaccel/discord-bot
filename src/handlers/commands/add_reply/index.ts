import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class add_reply extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "add_reply",
            description: "新增自動回覆",
            options: {
                string: [
                    {
                        name: "keyword",
                        description: "關鍵字",
                        required: true
                    },{
                        name: "reply",
                        description: "回覆",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const input = interaction.options.get("keyword")?.value;
            const reply = interaction.options.get("reply")?.value;
    
            const db = bot.guildInfo[interaction.guild?.id as string].db;
            if (!db) {
                await interaction.editReply({ content: "找不到資料庫" });
                return;
            }
            const existPair = await db.models["Reply"].find({ input, reply });
    
            if (existPair && existPair.length === 0) {
                const newReply = new db.models["Reply"]({ input, reply });
                await newReply.save();
                await interaction.editReply({ content: `已新增 輸入：${input} 回覆：${reply}！` });
            } else {
                await interaction.editReply({ content: `此配對 輸入：${input} 回覆：${reply} 已經存在！` });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法新增訊息回覆配對" });
        }
    }
}