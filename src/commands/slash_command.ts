import {
    ChannelType, 
    Guild,
    AttachmentBuilder,
    EmbedBuilder,
    GuildMember,
    ChatInputCommandInteraction,
} from "discord.js";
import axios from "axios";
import fs from "fs";
import { 
    joinVoiceChannel,
    DiscordGatewayAdapterCreator
} from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import { 
    BaseBot,
    AllowedTextChannel
} from "@dcbotTypes";
import utils from "@utils";

export const help = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        let  helpContent = '## 指令清單\n';

        for (let i = 0; i < bot.config.commands.length; i++) {
            helpContent += "* `" + bot.config.commands[i].name + "` : " + bot.config.commands[i].description + "\n";
        }

        await interaction.editReply({ content: helpContent });
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "無法取得指令清單"});
    }
}

export const talk = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    try {
        let ch = interaction.options.get("channel")?.value as string;
        let content = interaction.options.get("content")?.value as string;
        if (!ch || !content) {
            await interaction.reply({ content: "請輸入頻道和內容", ephemeral: true });
            return;
        }
        
        // check existance of channel
        let guild = interaction.guild as Guild;
        let channel = guild.channels.cache.get(ch);
        if (!channel) {
            await interaction.reply({ content: "找不到頻道", ephemeral: true });
            return;
        } else if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.PublicThread ) {
            await interaction.reply({ content: "不是文字頻道", ephemeral: true });
            return;
        }
        channel = channel as AllowedTextChannel;
        
        // avoid to tag everyone
        await interaction.deferReply();
        await interaction.deleteReply();
        if (content.includes("@everyone") || content.includes("@here")) {
            const tagMessage = `${interaction.user.username}好壞喔被我抓到你在 tag 所有人`;
            await channel.send(tagMessage);
        } else {
            await channel.send(content);

            await utils.debugChannelLogger(bot.guildInfo[guild.id].channels.debug, `Talk Command Created, ${interaction.user.username}：${content}`, 'system');
        }
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: "無法傳送訊息", ephemeral: true });
    }
}

export const change_avatar = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const guild = interaction.guild;
        if (!guild) {
            return { content: "Cannot find guild" };
        }

        const newName = interaction.options.get("identity")?.value as string;
        const oldName = bot.guildInfo[guild?.id].bot_name;
        const newColorRole = guild?.roles.cache.find(role => role.name === bot.config.identities[newName].color_role);
        const oldColorRole = guild?.roles.cache.find(role => role.name === bot.config.identities[oldName].color_role);

        // identity assignment
        const userBot = guild.members.cache.get(bot.client.user?.id as string);
        if (userBot) {
            // remove old color role and assign new color role
            if (oldColorRole && userBot.roles.cache.has(oldColorRole?.id as string)) 
                await userBot.roles.remove(oldColorRole);
            if (newColorRole) 
                await userBot.roles.add(newColorRole);

            // change nickname and avatar
            await userBot.setNickname(newName);
            await userBot.client.user.setAvatar(bot.config.identities[newName].avator_url);
        }

        await interaction.editReply({ content: `${oldName}已死，現在正是${newName}復權的時刻` });
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "更改失敗"});
    }
}

export const random_restaurant = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        var api_route = "https://foodapi-chi.vercel.app/api/restaurants/get";
        const response = await axios.get(api_route);
        const resdata = response.data.restaurant;

        await interaction.editReply({ content: `今天吃 ${resdata.name} 吧！\n地址：${resdata.address}\n(https://www.google.com/maps/search/${encodeURIComponent(resdata.name)})` });
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "無法取得餐廳"});
    }
}

export const imgen = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const imgen_ch_id = bot.guildInfo[interaction.guild?.id as string].channels.imgen.id;
        if (interaction.channel?.id !== imgen_ch_id) {
            await interaction.editReply({ content: `這個指令只能在 <#${imgen_ch_id}> 頻道使用喔！` });
            return;
        }
        const content = interaction.options.get("imgae_description")?.value;
        if (!content) {
            await interaction.editReply({ content: "請輸入內容" });
            return;
        }
        var v_value = btoa(unescape(encodeURIComponent(content)));
        try {
            const ux = await axios.get(`https://rbt4168.csie.org/api/draw/q=${v_value}`);
            let buffer = Buffer.from(ux.data.images[0], 'base64');
            let attachment = new AttachmentBuilder(buffer, { name: 'image.png' });
            await interaction.editReply({ files: [attachment] });
        } catch (error) {
            await interaction.editReply({ content: "crychic和mygo吵架忙線中，請稍後再試 ❤️ " });
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "無法產生圖片" });
    }
}

export const ask_nijika_wakeup = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    
}

export const search_anime_scene = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const image = interaction.options.get("image")?.attachment;
        if (!image) {
            await interaction.editReply({ content: "請上傳圖片" });
            return;
        }

        await axios.post(`https://api.trace.moe/search?url=${encodeURIComponent(image.url)}`)
        .then(async (response) => {
            if (response.data.error === "") {
                type IResult = {
                    filename: string;
                    episode: number;
                    similarity: number;
                    from: number;
                    to: number;
                    video: string;
                    image: string;
                }
                let embedarr: EmbedBuilder[] = [];
                const result = response.data.result as IResult[];
                const num_results = interaction.options.get("display_num")?.value ?
                    interaction.options.get("display_num")?.value as number > result.length ? 
                        result.length as number : 
                        interaction.options.get("display_num")?.value as number
                    : 1;

                result.map((e, i) => {
                    if (i >= num_results) return;
                    const filename = e.filename;
                    const episode = e.episode ? e.episode : "N/A";
                    const similarity = e.similarity;
                    const from = e.from;
                    const to = e.to;
                    const video = e.video;
                    const image = e.image;
                    const embedMsg = new EmbedBuilder()
                        .setTitle(filename)
                        .setURL(video)
                        .setDescription(`第 ${episode} 集, 
                            相似度：${similarity.toFixed(2)}%
                            時間：${(from/60).toFixed(0)}:${(from%60).toFixed(2)} - ${(to/60).toFixed(0)}:${(to%60).toFixed(2)}`)
                        .setImage(image)
                        .setTimestamp()
                        .setFooter({ text: `第 ${i + 1} 筆結果` });
                    embedarr.push(embedMsg);
                });

                await interaction.editReply({ embeds: embedarr });
            }
        })
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "無法搜尋動畫截圖" });
    }
}

export const pin_message = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const act = interaction.options.get("action")?.value as string;
        const messageLink = interaction.options.get("message_link")?.value as string;
        const msgID = messageLink.split("/").pop() as string;

        // check is in a thread and permission
        if (!interaction.channel?.isThread()) {
            await interaction.editReply({ content: "這個指令只能在討論串使用喔" });
        }

        if (interaction.channel?.type !== ChannelType.PublicThread || interaction.user.id !== interaction.channel?.ownerId) {
            await interaction.editReply({ content: "你不是串主喔" });
        }
        
        if (act === "unpin") {
            const msg = await interaction.channel?.messages.fetch(msgID);
            if (msg) await msg.unpin();
            await interaction.editReply({ content: `已取消釘選訊息` });
        } else if (act === "pin") {
            const msg = await interaction.channel?.messages.fetch(msgID);
            if (msg) await msg.pin();
            await interaction.editReply({ content: `已釘選訊息` });
        } else {
            await interaction.editReply({ content: "無效的指令" });
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "無法釘選訊息" });
    }
}

export const record = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const action = interaction.options.get("action")?.value as string;
        let duration = interaction.options.get("duration")?.value as number;
        
        if (action === "start") {
            const member = interaction.member as GuildMember;
            if (!member.voice.channelId) {
                await interaction.editReply({ content: "請先加入語音頻道" });
                return;
            }

            if (!bot.voice) {
                bot.voice = {
                    recorder: new VoiceRecorder({}, bot.client),
                    connection: null
                }
            }
            if (!interaction.guild?.voiceAdapterCreator) {
                await interaction.editReply({ content: "無法加入語音頻道" });
                return;
            }
            bot.voice.connection = joinVoiceChannel({
                guildId: interaction.guild?.id as string,
                channelId: member.voice.channelId as string,
                adapterCreator: interaction.guild?.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
                selfDeaf: false
            });
            bot.voice.recorder.startRecording(bot.voice.connection);

            await interaction.editReply({ content: "開始錄音" });
        } else if (action === "stop") {
            if (!bot.voice || !bot.voice.recorder.isRecording() || !bot.voice.connection) {
                await interaction.editReply({ content: "目前沒有錄音" });
                return;
            }

            bot.voice.recorder.stopRecording(bot.voice.connection);
            bot.voice.connection.destroy();
            bot.voice.connection = null;
            await interaction.editReply({ content: "停止錄音" });
        } else if (action === "save") {
            if (!duration) {
                duration = 5;
            }
            if (!bot.voice || !bot.voice.recorder.isRecording() || !bot.voice.connection) {
                await interaction.editReply({ content: "目前沒有錄音" });
                return;
            }
            
            const timestamp = new Date().toLocaleString().replace(/\/|:|\s/g, "-");
            const voice_stream = fs.createWriteStream(`./assets/${timestamp}.zip`);
            await bot.voice.recorder.getRecordedVoice(voice_stream, interaction.guild?.id as string, 'separate', duration);
            const buffer = await bot.voice.recorder.getRecordedVoiceAsBuffer(interaction.guild?.id as string, 'separate', duration);;

            if (buffer.length === 0) {
                await interaction.editReply({ content: "未收到音訊，不儲存音檔" });
            } else {
                const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.zip` })
                await interaction.editReply({ content: `已儲存 ${duration} 分鐘的錄音`, files: [attachment] });
            }
        } else {
            await interaction.editReply({ content: "無效的指令" });
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply({ content: "無法錄音" });
    }
}

export const add_reply = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {

}