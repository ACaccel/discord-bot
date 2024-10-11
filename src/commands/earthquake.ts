import { AllowedTextChannel } from "@dcbotTypes";
import { Channel } from "discord.js";

export const earthquake_warning = async(channel: Channel, magnitude: number, countdown: number) => {
    channel = channel as AllowedTextChannel;
    if (magnitude >= 4) {
        channel.send(`# <@&1235653362482024569> 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        "\n> 肥貓跌倒了！！");
    }
    else if (magnitude >= 2) {
        channel.send(`# <@&1235653362482024569> 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        "\n> 為什麼要地震！？");
        // channel.send(`# 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        // "\n> 為什麼要地震！？");
    }
    else {
        channel.send(`# 有感地震警報，台北預估震度${magnitude}級，${countdown}秒後抵達！！！` +
        "\n> 為什麼要地震！？");
    }
  }