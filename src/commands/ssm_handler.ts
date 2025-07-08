//==================================================//
// String Select Menu Custom ID: <ssm_type|ssm_value>
//==================================================// 

import { BaseBot } from "@dcbotTypes";
import { StringSelectMenuInteraction } from "discord.js";

export const delete_reply = async (interaction: StringSelectMenuInteraction, bot: BaseBot) => {
    const key = interaction.customId.split('|')[1];
    const value = interaction.values[0];

    const db = bot.guildInfo[interaction.guild?.id as string].db;
    if (!db) {
        await interaction.reply({ content: "找不到資料庫", ephemeral: true }); 
        return;
    }

    const pair = await db.models["Reply"].findById(value);
    const replymsg = pair.reply;
    await db.models["Reply"].findByIdAndDelete(value);
    
    await interaction.reply({ content: `已刪除回覆：${key} => ${replymsg}` });
}