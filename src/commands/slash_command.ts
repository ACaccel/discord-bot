import {
    ChannelType, 
    Guild,
    AttachmentBuilder,
    EmbedBuilder,
    GuildMember,
    ChatInputCommandInteraction,
    Role,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import { 
    joinVoiceChannel,
    DiscordGatewayAdapterCreator
} from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import Mee6LevelsApi from 'mee6-levels-api';
import { 
    BaseBot,
    AllowedTextChannel
} from "@dcbotTypes";
import utils from "@utils";
import { giveaway } from "@cmd";
import { Nijika } from "bot/nijika/types";
import slash_command_config from "../slash_command.json";
import identity_config from "../identity.json";

/************************************/
/********** slash commands **********/
/************************************/

export const help = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        if (!bot.config.commands) {
            await interaction.editReply({ content: "沒有指令清單"});
            return;
        }

        let  helpContent = '## Help Message\n';
        helpContent += bot.help_msg;
        helpContent += '### 目前支援的slash command：\n';
        bot.config.commands.forEach((command) => {
            const cmd_config = slash_command_config.find((cmd) => cmd.name === command);
            if (cmd_config) {
                helpContent += `* \`/${cmd_config.name}\` : ${cmd_config.description}\n`;
            }
        });

        await interaction.editReply({ content: helpContent });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得指令清單"});
    }
}

export const bug_report = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    try {
        let content = interaction.options.get("content")?.value as string;
        if (!content) {
            await interaction.reply({ content: "請輸入內容", ephemeral: true });
            return;
        }

        if (!bot.adminId) {
            throw new Error("Admin ID not found");
        }

        // send message to admin via dm
        const admin = await bot.client.users.fetch(bot.adminId);
        if (admin) {
            await admin.send(`Bug Report from ${interaction.user.username}：${content}`);
            await interaction.reply({ content: `問題已回報! 內容: ${content}`, ephemeral: true });
        } else {
            throw new Error("Admin not found");
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.reply({ content: "無法回報問題", ephemeral: true });
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
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.reply({ content: "無法傳送訊息", ephemeral: true });
    }
}

export const change_avatar = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器"});
            return;
        }
        if (!identity_config) {
            await interaction.editReply({ content: "沒有身份組設定"});
            return;
        }

        // change nickname and avatar
        const newName = interaction.options.get("identity")?.value as string;
        const oldName = bot.guildInfo[guild?.id].bot_name;
        const userBot = guild.members.cache.get(bot.client.user?.id as string);
        if (!userBot) {
            await interaction.editReply({ content: "找不到機器人"});
            return;
        }
        await userBot.setNickname(newName);
        const new_identity = identity_config.find((e) => e.name === newName)
        if (!new_identity) {
            await interaction.editReply({ content: "找不到新身份"});
            return;
        }

        // change avatar
        await userBot.client.user.setAvatar(new_identity.avatar_url);
        bot.guildInfo[guild.id].bot_name = newName;

        // change color role
        identity_config.forEach(async (e) => {
            const role = guild?.roles.cache.find(role => role.name === e.color_role);
            if (role) 
                if (userBot.roles.cache.has(role.id)) 
                    await userBot.roles.remove(role);
        });
        const newColorRole = guild?.roles.cache.find(role => role.name === new_identity.color_role);
        if (newColorRole)
            await userBot.roles.add(newColorRole);

        await interaction.editReply({ content: `${oldName}已死，現在正是${newName}復權的時刻` });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "更改失敗"});
    }
}

export const change_nickname = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器"});
            return;
        }

        const newName = interaction.options.get("nickname")?.value as string;
        const userBot = guild.members.cache.get(bot.client.user?.id as string);
        if (!userBot) {
            await interaction.editReply({ content: "找不到機器人"});
            return;
        }
        await userBot.setNickname(newName);

        await interaction.editReply({ content: `已更改暱稱為：${newName}` });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
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
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得餐廳"});
    }
}

export const imgen = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const imgen_ch_id = bot.guildInfo[interaction.guild?.id as string].channels?.imgen.id;
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
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法產生圖片" });
    }
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
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
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
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
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
            const file_path = `./data/voice_record/${interaction.guild?.name}/${timestamp}.zip`;
            fs.mkdirSync(path.dirname(file_path), { recursive: true });
            const voice_stream = fs.createWriteStream(file_path);
            await bot.voice.recorder.getRecordedVoice(voice_stream, interaction.guild?.id as string, 'separate', duration);
            const buffer = await bot.voice.recorder.getRecordedVoiceAsBuffer(interaction.guild?.id as string, 'separate', duration);;

            if (buffer.length === 0) {
                await interaction.editReply({ content: "未收到音訊，不儲存音檔" });
            } else {
                const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.zip` })
                await interaction.editReply({ content: `已儲存倒數 ${duration} 分鐘的錄音`, files: [attachment] });
            }
        } else {
            await interaction.editReply({ content: "無效的指令" });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法錄音" });
    }
}

export const add_reply = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
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
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法新增訊息回覆配對" });
    }
}

export const list_reply = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const keyword = interaction.options.get("keyword")?.value;
        const db = bot.guildInfo[interaction.guild?.id as string].db;
        if (!db) {
            await interaction.editReply({ content: "找不到資料庫" });
            return;
        }
        const replyList = await db.models["Reply"].find({ input: keyword });
        if (replyList.length === 0) {
            await interaction.editReply({ content: `找不到 輸入：${keyword} 的回覆！` });
        } else {
            let content = `輸入：${keyword} 的回覆：\n`;
            replyList.map((e, i) => {
                content += `> ${i + 1}. ${e.reply}\n`;
            });
            await interaction.editReply({ content });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.reply({ content: "無法列出訊息回覆配對" });
    }
}

export const delete_reply = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
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

        if (existPair.length === 0) {
            await interaction.editReply({ content: `找不到 輸入：${input} 回覆：${reply}！` });
        } else {
            await db.models["Reply"].deleteOne({ input, reply });
            await interaction.editReply({ content: `已刪除 輸入：${input} 回覆：${reply}！` });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法刪除訊息回覆配對" });
    }
}

export const give_score = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    const score = `${Math.floor(Math.random() * 11)}/10`;
    await interaction.reply({ content: score });
}

export const gay = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    const user = interaction.options.get("user")?.value;
    if (interaction.guild?.members.cache.has(user as string)) {
        const target = interaction.guild?.members.cache.get(user as string);
        const res = `${target?.displayName} ${(Math.random() > 0.05 ? "是" : "不是")} gay`;
        await interaction.reply({ content: res });
    }
}

export const weather_forecast = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        var api_route = "https://dataservice.accuweather.com/forecasts/v1/hourly/1hour/315078?apikey=rVlGI9UbF0ALnbcerU3qKGQeHYjPyTDj&language=zh-tw&details=true";
        const response = await axios.get(api_route);
        const weatherForecast = response.data[0];
        const temperatureCelsius = (weatherForecast.Temperature.Value - 32) * 5 / 9; // Convert Fahrenheit to Celsius
        const realFeelCelsius = (weatherForecast.RealFeelTemperature.Value - 32) * 5 / 9; // Convert Fahrenheit to Celsius
        let formattedContent = "每小時天氣預報：\n";
        formattedContent += `- 預測時間：${weatherForecast.DateTime}\n`;
        formattedContent += `- 天氣狀況：${weatherForecast.IconPhrase}\n`;
        formattedContent += `- 降雨機率：${weatherForecast.PrecipitationProbability}%\n`;
        formattedContent += `- 雷暴機率：${weatherForecast.ThunderstormProbability}%\n`;
        formattedContent += `- 室外氣溫：${temperatureCelsius}°C\n`;
        formattedContent += `- 體感溫度：${realFeelCelsius}°C\n`;
        formattedContent += `- 相對濕度：${weatherForecast.RelativeHumidity}%\n`;
        
        const formattedContentWithBackticks = formattedContent;
        await interaction.editReply({ content: formattedContentWithBackticks });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得天氣預報" });
    }
}

export const level_detail = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const left = interaction.options.get("left")?.value as number;
        const right = interaction.options.get("right")?.value as number;
        const rangeSize = right - left;

        if (rangeSize <= 10) {
            let content = "";
            const leaderboard = await Mee6LevelsApi.getLeaderboardPage(interaction.guild?.id as string);

            leaderboard.slice(left - 1, right).forEach((e, i) => {
                const averageXp = (e.xp.totalXp / e.messageCount).toPrecision(6);
                content += `> **${e.rank} - ${e.username}﹝Level ${e.level}﹞**\n`;
                content += `**訊息總數：** ${e.messageCount} `;
                content += `**當前經驗值：** ${e.xp.userXp} / ${e.xp.levelXp} `;
                content += `**總經驗值：** ${e.xp.totalXp} `;
                content += `**平均經驗值：** ${averageXp} \n\n`;
            });

            if (content.length < 2000) {
                await interaction.editReply({ content });
            } else {
                await interaction.editReply({ content: "太長了...請選短一點的範圍" });
            }
        } else {
            await interaction.editReply({ content: "太長了...請選短一點的範圍" });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得等級詳情" });
    }
}

export const todo_list = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const action = interaction.options.get("action")?.value as string;
        const content = interaction.options.get("content")?.value as string;

        if (!content && action !== "list") {
            await interaction.editReply({ content: "請輸入待辦事項內容" });
            return;
        }

        const db = bot.guildInfo[interaction.guild?.id as string].db;
        if (!db) {
            await interaction.editReply({ content: "找不到資料庫" });
            return;
        }

        if (action == "add") {
            const existPair = await db.models["Todo"].find({ content });
            if (existPair.length === 0) {
                const newTodo = new db.models["Todo"]({ content });
                await newTodo.save();
                await interaction.editReply({ content: `已新增待辦事項：${content}` });
            } else {
                await interaction.editReply({ content: `此待辦事項：${content} 已經存在！` });
            }
        } else if (action == "delete") {
            // content is index
            const todoList = await db.models["Todo"].find({});
            if (!parseInt(content)) {
                await interaction.editReply({ content: "請輸入數字" });
                return;
            }
            if (parseInt(content) > todoList.length) {
                await interaction.editReply({ content: `找不到待辦事項：${content}` });
            } else {
                const deleted_content = todoList[parseInt(content) - 1].content;
                await db.models["Todo"].deleteOne({ content: deleted_content });
                await interaction.editReply({ content: `已刪除待辦事項：${deleted_content}` });
            }
        } else if (action == "list") {
            const todoList = await db.models["Todo"].find({});
            let content = "待辦事項：\n";
            todoList.map((e, i) => {
                content += `> ${i + 1}. ${e.content}\n`;
            });
            await interaction.editReply({ content });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法變更待辦事項" });
    }
}

export const get_avatar = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const user = interaction.options.get("user")?.value as string;
        const member = interaction.guild?.members.cache.get(user);
        if (member) {
            let url = member.displayAvatarURL();
            url = url.replace(".webp", ".png?size=4096");

            const embed = new EmbedBuilder()
                .setTitle("User Avatar")
                .setAuthor({ name: member.user.tag, iconURL: url })
                .setImage(url)
                .setColor(member.displayHexColor);

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply({ content: "找不到使用者" });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得頭像" });
    }
}

// require message backup of the guild
export const emoji_frequency = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const type = interaction.options.get("type")?.value as string || "static";
        const frequency = interaction.options.get("frequency")?.value as string || "asc";
        let top_n = interaction.options.get("top_n")?.value as number || 5;
        let last_n_months = interaction.options.get("last_n_months")?.value as number || 1;
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }
        if (top_n > 40) top_n = 40;
        if (last_n_months > 6) last_n_months = 6;

        const n_months_ago = new Date();
        n_months_ago.setMonth(n_months_ago.getMonth() - last_n_months);

        const db = bot.guildInfo[guild.id].db;
        if (!db) {
            await interaction.editReply({ content: "請先設定資料庫" });
            return;
        }

        const emojiMap = new Map<string, number>();
        guild.emojis.cache.forEach(emoji => {
            const emojiText = `<${emoji.animated ? "a:" : ":"}${emoji.name}:${emoji.id}>`;
            emojiMap.set(emojiText, 0);
        });
        
        const messages = await db.models["Message"].find({
            $expr: { $gte: [{ $toLong: "$timestamp" }, n_months_ago.getTime()] }
        });

        messages.forEach((message) => {
            const emojis: string[] = message.content.match(/<a?:\w+:\d+>/g) || [];
            emojis.forEach(emoji => {
                if (emojiMap.has(emoji)) {
                    emojiMap.set(emoji, (emojiMap.get(emoji) || 0) + 1);
                }
            });
        });

        const sortedEmojis = Array.from(emojiMap.entries())
            .filter(([emoji]) => type === "animated" ? emoji.startsWith("<a:") : emoji.startsWith("<:"))
            .sort((a, b) => frequency === "asc" ? a[1] - b[1] : b[1] - a[1])
            .slice(0, top_n);

        let content = `最近${last_n_months}個月內使用頻率${frequency === "asc" ? "最低" : "最高"}的 ${top_n} 個${type === "animated" ? "動態" : "靜態"}表情符號：\n`;
        sortedEmojis.forEach(([emoji, count], index) => {
            content += `${index + 1}. ${emoji} - ${count} 次\n`;
        });

        await interaction.editReply({ content });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得表情符號使用頻率" });
    }
}

// danger!!! this command should only be used in a trusted server
// it may cause the bot to be stuck
export const sticker_frequency = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const frequency = interaction.options.get("frequency")?.value as string || "asc";
        let top_n = interaction.options.get("top_n")?.value as number || 5;
        let last_n_days = interaction.options.get("last_n_days")?.value as number || 1;
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }
        if (top_n > 50) top_n = 50;
        if (last_n_days > 5) last_n_days = 5;

        const timeout_limit = 5 * 60; // second
        const n_days_ago = Date.now() - last_n_days * 24 * 60 * 60 * 1000;
        const stickerMap = new Map<string, number>();

        // Prepopulate the stickerMap with all stickers in the server
        guild.stickers.cache.forEach(sticker => {
            stickerMap.set(sticker.name, 0);
        });

        const channels = guild.channels.cache.filter(channel => channel.isTextBased());
        let elapsedSeconds = 0;
        let timeoutReached = false;

        // Set a timeout for 10 seconds
        const timeout = setTimeout(() => {
            timeoutReached = true;
        }, timeout_limit * 1000);

        // Update the interaction message every second
        const interval = setInterval(async () => {
            elapsedSeconds++;
            await interaction.editReply({ content: `正在搜尋訊息中... 已經過 ${elapsedSeconds} 秒, timeout: ${timeout_limit} 秒` });
        }, 1000);

        for (const [, channel] of channels) {
            if (timeoutReached) break;
            if (!channel.isTextBased()) continue;

            let lastMessageId: string | undefined;
            while (true) {
                if (timeoutReached) break;

                const messages = await channel.messages.fetch({ limit: 100, before: lastMessageId });
                if (messages.size === 0) break;

                for (const [, message] of messages) {
                    if (message.createdTimestamp < n_days_ago) break;

                    message.stickers.forEach(sticker => {
                        const stickerName = sticker.name;
                        stickerMap.set(stickerName, (stickerMap.get(stickerName) || 0) + 1);
                    });
                }

                lastMessageId = messages.last()?.id;
                if (!lastMessageId || messages.last()?.createdTimestamp! < n_days_ago) break;
            }
        }

        // Clear the timeout and interval
        clearTimeout(timeout);
        clearInterval(interval);

        const sortedStickers = Array.from(stickerMap.entries())
            .sort((a, b) => frequency === "asc" ? a[1] - b[1] : b[1] - a[1])
            .slice(0, top_n);

        let content = `最近${last_n_days}天內使用頻率${frequency === "asc" ? "最低" : "最高"}的 ${top_n} 個貼圖：\n`;
        sortedStickers.forEach(([sticker, count], index) => {
            content += `${index + 1}. ${sticker} - ${count} 次\n`;
        });

        if (timeoutReached) {
            content += `\n⚠️ 搜尋時間超過 ${timeout_limit} 秒，請縮小搜尋範圍`;
        }

        await interaction.editReply({ content });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法取得貼圖使用頻率" });
    }
};

export const role_message = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }
        const member = interaction.member as GuildMember;
        if (!member.permissions.has("ManageRoles")) {
            await interaction.editReply({ content: "你沒有權限發送身份組領取訊息" });
            return;
        }

        // Verify IDs format and existence
        const roles = interaction.options.get("roles")?.value as string;
        if (!roles || !roles.match(/^<@&\d+>(\s*<@&\d+>)*$/)) {
            await interaction.editReply({ content: "格式錯誤！regex: match(/^<@&\d+>(\s*<@&\d+>)*$/)" });
            return;
        }
        // Extract role IDs from mentions
        const roleIds = Array.from(roles.matchAll(/<@&(\d+)>/g)).map(match => match[1]);
        console.log(roleIds);
        const validRoles: Role[] = [];
        for (const roleId of roleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                await interaction.editReply({ content: `找不到ID為 ${roleId} 的身份組, 請確認ID是否正確` });
                return;
            }
            validRoles.push(role);
        }
        if (validRoles.length === 0) {
            await interaction.editReply({ content: "請至少提供一個有效的身份組ID" });
            return;
        }

        // build buttons
        const buttons: ButtonBuilder[] = validRoles.map(role => {
            return new ButtonBuilder()
                .setCustomId(`toggle_role|${role.id}`)
                .setLabel(role.name)
                .setStyle(ButtonStyle.Primary);
        });
        const rows :ActionRowBuilder<ButtonBuilder>[] = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
        }

        await interaction.editReply({
            content: "請選擇你要領取的身份組：",
            components: rows
        });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法發送身份組領取訊息" });
    }
}

/********** Only for Nijika **********/
/*** (Custom channel restriction) ****/

export const update_role = async (interaction: ChatInputCommandInteraction, bot: Nijika) => {
    await interaction.deferReply();
    try {
        let leaderboard = await Mee6LevelsApi.getLeaderboardPage(interaction.guild?.id as string);
        let guild = bot.guildInfo[interaction.guild?.id as string].guild;
        const channel = interaction.channel as AllowedTextChannel;
        // let alive_role = guild.roles.cache.find(role => role.name === "活人");

        await Promise.all(leaderboard.map(async (member) => {
            let { id, level } = member;
            let guildMember = guild.members.cache.get(id);

            if (guildMember) { } else return;
            // live people role.
            // if(level >= 6) {
            // 	if (!guildMember.roles.cache.some(role => role.name === "活人")) {
            // 		let _ = await guildMember.roles.add(alive_role);
            // 		interaction.channel.send(`[ SYSTEM ] 給予 ${guildMember.user.tag} 活人`);
            // 	}
            // }

            // find corresponding role
            let roleToAssign = "";
            for (const roleLevel in bot.nijikaConfig.level_roles) {
                if (level >= parseInt(roleLevel.split('_')[1])) {
                    roleToAssign = bot.nijikaConfig.level_roles[roleLevel];
                } else {
                    break;
                }
            }
            if (roleToAssign === "") return;

            // update role
            const addedRole = guild.roles.cache.find(role => role.name === roleToAssign);
            const hasRoleToAssign = guildMember.roles.cache.has(addedRole?.id as string);
            for (const roleLevel in bot.nijikaConfig.level_roles) {
                const removedRole = guild.roles.cache.find(role => role.name === bot.nijikaConfig.level_roles[roleLevel]);
                if (!removedRole) continue;
                
                if (guildMember.roles.cache.has(removedRole.id) && removedRole.name !== roleToAssign) {
                    await guildMember.roles.remove(removedRole);
                    await channel.send(`[ SYSTEM ] ${guildMember.user.displayName}, 移除: ${bot.nijikaConfig.level_roles[roleLevel]}`);
                }
            }
            if (addedRole && !hasRoleToAssign) {
                await guildMember.roles.add(addedRole);
                await channel.send(`[ SYSTEM ] ${guildMember.user.displayName}, 獲得: ${roleToAssign}`);
            }
        }));
        await interaction.editReply({ content: "更新完成" });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法更新身份組" });
    }
}

export const giveaway_create = async (interaction: ChatInputCommandInteraction, bot: Nijika) => {
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
        const channel = interaction.guild.channels.cache.get(bot.nijikaConfig.giveaway_channel_id) as AllowedTextChannel;
        if (!channel) {
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
            const job = utils.scheduleJob(end_time_date, () => giveaway.scheduleGiveaway(bot, guild.id, message_id));
            bot.giveaway_jobs.set(message_id, job);
        }

        await interaction.editReply({ content: `抽獎已建立！將於 ${end_time_date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 結束` });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法抽獎" });
    }
}

export const giveaway_delete = async (interaction: ChatInputCommandInteraction, bot: Nijika) => {
    await interaction.deferReply();
    try {
        const message_id = interaction.options.get("message_id")?.value as string;
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器" });
            return;
        }
        await giveaway.deleteGiveaway(bot, guild.id, message_id);
        await interaction.editReply({ content: "抽獎已刪除" });
    } catch (error) {
        utils.errorLogger(bot.clientId, interaction.guild?.id, error);
        await interaction.editReply({ content: "無法刪除抽獎" });
    }
}

/************************************/
/********** Modal commands **********/
/************************************/

// export const modal1 = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
//     // Create the modal
//     const modal = new ModalBuilder()
//     .setCustomId('modal1')
//     .setTitle('My Modal');

//     // Add components to modal

//     // Create the text input components
//     const favoriteColorInput = new TextInputBuilder()
//     .setCustomId('favoriteColorInput')
//     // The label is the prompt the user sees for this input
//     .setLabel("What's your favorite color?")
//     // Short means only a single line of text
//     .setStyle(TextInputStyle.Short);

//     const hobbiesInput = new TextInputBuilder()
//     .setCustomId('hobbiesInput')
//     .setLabel("What's some of your favorite hobbies?")
//     // Paragraph means multiple lines of text.
//     .setStyle(TextInputStyle.Paragraph);

//     // An action row only holds one text input,
//     // so you need one action row per text input.
//     const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(favoriteColorInput);
//     const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(hobbiesInput);

//     // Add inputs to the modal
//     modal.addComponents(firstActionRow, secondActionRow);

//     await interaction.showModal(modal);
// }