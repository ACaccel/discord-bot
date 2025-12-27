import { Channel } from "discord.js";

export const earthquake_warning = async(channel: Channel, eq_role: string) => {
    if (!channel.isSendable()) return;
    await channel.send(`# <@&${eq_role}> 台北強震警報!!! (4級以上)` +
        "\n> 為什麼要地震！？");
}