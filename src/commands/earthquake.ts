import { AllowedTextChannel } from "@dcbotTypes";
import { Channel } from "discord.js";

export const earthquake_warning = async(channel: Channel, eq_role: string, magnitude: number, countdown: number) => {
    channel = channel as AllowedTextChannel;
    if (magnitude >= 5) {
        channel.send(`# <@&${eq_role}> 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        "\n> 肥貓跌倒了！！");
    } else if (magnitude >= 3) {
        channel.send(`# <@&${eq_role}> 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        "\n> 為什麼要地震！？");
        // channel.send(`# 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        // "\n> 為什麼要地震！？");
    } else if (magnitude >= 1) {
        channel.send(`# 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        "\n> 為什麼要地震！？");
    }
}