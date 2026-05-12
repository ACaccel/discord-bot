import { Message, TextChannel } from "discord.js";
import { BaseBot } from "@bot";
import { bot_cmd, misc } from "@utils";

// deprecated!
export const anti_dizzy_react = async (msg: Message) => {
    const content = msg.content;
    const andyDictionary = [
        /暈/, /她{1}不{0,1}在{1}/, /他{1}不{0,1}在{1}/, /女{1}朋{0,1}友{1}/, /男{1}朋{0,1}友{1}/
    ]
    if(andyDictionary.some((e) => content.match(e))) {
        bot_cmd.msgReact(msg, ['1067851490271711312']);
    }
}

export const tts_reply = async (msg: Message) => {
    if (msg.content === "tts") {
        const ref_msg_ch = msg.guild?.channels.cache.get(msg.reference?.channelId as string) as TextChannel;
        const ref_msg = ref_msg_ch?.messages.cache.get(msg.reference?.messageId as string)?.content;
        if (!ref_msg) {
            await msg.reply("Cannot find the message");
            return null;
        }

        const { attachment, error } = await misc.tts_api(ref_msg);
        if (error || !attachment) {
            await msg.reply(error);
            return;
        }
        await msg.reply({ files: [attachment] });
    }
}

const search_reply = async (msg: string, bot: BaseBot, guild_id: string) => {
    // search reply from database
    const repos = bot.guildInfo[guild_id]?.repos;
    if (!repos) {
        throw new Error("Cannot connect to MongoDB.");
    }
    const res = await repos.reply.findByInput(msg);
    const success = res.length !== 0;

    // if number of reply > 1, randomly select one
    let reply = "";
    if (success) {
        reply = res[Math.floor(Math.random() * res.length)].reply;
    }
    return { reply, success };
}

const roll_dice = (msg: string | undefined, regex: RegExp) => {
    if (!msg) return null;
    if (regex.test(msg)) {
        const match = msg.match(regex);
        if (match) {
            const count = parseInt(match[1]);
            const sides = parseInt(match[2]);
            if (count > 100 || count <= 0 || sides > 2**30 || sides <= 0) return "out of range (0 < count < 100, 0 < sides < 2^30)";
            else {
                const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
                return `🎲 ${count}d${sides}: [${rolls.join(', ')}]`;
            }
        }
    }
}

export const auto_reply = async (msg: Message, bot: BaseBot, guild_id: string) => {
    if (!msg.channel.isSendable()) return;

    if (msg.content.includes('該睡覺了，肥貓跟你說晚安')) {
        await msg.reply('健康に良くない！<:ave_mortis_bad_for_health:1333052644368846878>')
    }

    if (msg.author.bot) return; // prevent recusive reply
    
    // normal reply
    const { reply, success } = await search_reply(msg.content, bot, guild_id);
    if (success) {
        await msg.channel.send({ content: reply as string });
    }

    // special reply
    if (msg.author.id === "516912789369913371" && Math.random() > (1-0.01)) {
        // reply to fatcat
        await msg.channel.send("肥貓好gay");
    }
    if (msg.author.id === "705605105352966144" && Math.random() > (1-0.005)) {
        // reply to mubaimu
        await msg.channel.send("晴人杰");
    }
    if (Math.random() > 0.995) {
        // reply to lucky
        const { reply, success } = await search_reply("[*]", bot, guild_id);
        if (success) {
            await msg.channel.send({ content: reply as string });
        }
    }

    // regex reply
    const regex = /長髮男(?=\s|$)/;
    if (regex.test(msg.content)) {
        await msg.channel.send("去spa");
    }

    const dice_roll = /^(\d+)d(\d+)$/;
    const dice_res = roll_dice(msg.content, dice_roll);
    if (dice_res) {
        await msg.channel.send(dice_res);
    }
}