import { AllowedTextChannel } from "@dcbotTypes";
import { Channel } from "discord.js";

export const earthquake_warning = async(channel: Channel, eq_role: string) => {
    channel = channel as AllowedTextChannel;
    // await channel.send(`# <@&${eq_role}> 台北強震警報!!!` +
    //     "\n> 為什麼要地震！？");
}