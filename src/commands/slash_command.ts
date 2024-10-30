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
import Mee6LevelsApi from 'mee6-levels-api';
import { 
    BaseBot,
    AllowedTextChannel
} from "@dcbotTypes";
import utils from "@utils";
import db from "@db";
import { Tomori } from "bot/tomori/types";

export const help = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        if (!bot.config.commands) {
            await interaction.editReply({ content: "沒有指令清單"});
            return;
        }

        let  helpContent = '## 指令清單\n';
        for (let i = 0; i < bot.config.commands.length; i++) {
            helpContent += "* `" + bot.config.commands[i].name + "` : " + bot.config.commands[i].description + "\n";
        }

        await interaction.editReply({ content: helpContent });
    } catch (error) {
        utils.errorLogger(bot.clientId, error);
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
            await interaction.reply({ content: "請通知管理員進行管理員設定", ephemeral: true });
            return;
        }

        // send message to admin via dm
        const admin = await interaction.guild?.members.fetch(bot.adminId);
        if (admin) {
            await admin.send(`Bug Report from ${interaction.user.username}：${content}`);
            await interaction.reply({ content: "已通知管理員", ephemeral: true });
        } else {
            await interaction.reply({ content: "請通知管理員確認管理員設定", ephemeral: true });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, error);
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

            // await utils.channelLogger(bot.guildInfo[guild.id].channels.debug, `Talk Command Created, ${interaction.user.username}：${content}`, 'system');
            await utils.channelLogger(bot.guildInfo[guild.id].channels.debug, 'system', '', '', `Talk Command Created, ${interaction.user.username}：${content}`);
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, error);
        await interaction.reply({ content: "無法傳送訊息", ephemeral: true });
    }
}

export const change_avatar = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const guild = interaction.guild;
        const identities = bot.config.identities;

        if (!guild) {
            await interaction.editReply({ content: "找不到伺服器"});
            return;
        }
        if (!identities) {
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
        await userBot.client.user.setAvatar(identities[newName].avator_url);

        // color roles
        if (identities[newName].color_role) {
            const newColorRole = guild?.roles.cache.find(role => role.name === identities[newName].color_role);
            if (newColorRole) 
                await userBot.roles.add(newColorRole);
        }

        if (identities[oldName] && identities[oldName].color_role) {
            const oldColorRole = guild?.roles.cache.find(role => role.name === identities[oldName].color_role);
            if (oldColorRole && userBot.roles.cache.has(oldColorRole?.id as string)) 
                await userBot.roles.remove(oldColorRole);
        }

        await interaction.editReply({ content: `${oldName}已死，現在正是${newName}復權的時刻` });
    } catch (error) {
        utils.errorLogger(bot.clientId, error);
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
        utils.errorLogger(bot.clientId, error);
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
        utils.errorLogger(bot.clientId, error);
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
        utils.errorLogger(bot.clientId, error);
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
        utils.errorLogger(bot.clientId, error);
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
        utils.errorLogger(bot.clientId, error);
        await interaction.editReply({ content: "無法錄音" });
    }
}

export const add_reply = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    const input = interaction.options.get("keyword")?.value;
    const reply = interaction.options.get("reply")?.value;

    const existPair = await db.Reply.find({ input, reply });

    if (existPair.length === 0) {
        const newReply = new db.Reply({ input, reply });
        await newReply.save();
        await interaction.reply({ content: `已新增 輸入：${input} 回覆：${reply}！` });
    } else {
        await interaction.reply({ content: `此配對 輸入：${input} 回覆：${reply} 已經存在！` });
    }
}

export const delete_reply = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    const input = interaction.options.get("keyword")?.value;
    const reply = interaction.options.get("reply")?.value;

    const existPair = await db.Reply.find({ input, reply });

    if (existPair.length === 0) {
        await interaction.reply({ content: `找不到 輸入：${input} 回覆：${reply}！` });
    } else {
        await db.Reply.deleteOne({ input, reply });
        await interaction.reply({ content: `已刪除 輸入：${input} 回覆：${reply}！` });
    }
}

export const give_score = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    const score = `${Math.floor(Math.random() * 11)}/10`;
    await interaction.reply({ content: score });
}

export const gay = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    const user = interaction.options.get("user")?.value;
    if (bot.guildInfo[interaction.guild?.id as string].members[user as string]) {
        const target = bot.guildInfo[interaction.guild?.id as string].members[user as string];
        const res = `${target.displayName} ${(Math.random() > 0.05 ? "是" : "不是")} gay`;
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
        utils.errorLogger(bot.clientId, error);
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
        utils.errorLogger(bot.clientId, error);
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

        if (action == "add") {
            const existPair = await db.Todo.find({ content });
            if (existPair.length === 0) {
                const newTodo = new db.Todo({ content });
                await newTodo.save();
                await interaction.editReply({ content: `已新增待辦事項：${content}` });
            } else {
                await interaction.editReply({ content: `此待辦事項：${content} 已經存在！` });
            }
        } else if (action == "delete") {
            // content is index
            const todoList = await db.Todo.find({});
            if (!parseInt(content)) {
                await interaction.editReply({ content: "請輸入數字" });
                return;
            }
            if (parseInt(content) > todoList.length) {
                await interaction.editReply({ content: `找不到待辦事項：${content}！` });
            } else {
                await db.Todo.deleteOne({ name: todoList[parseInt(content) - 1].content });
                await interaction.editReply({ content: `已刪除待辦事項：${content}！` });
            }
        } else if (action == "list") {
            const todoList = await db.Todo.find({});
            let content = "待辦事項：\n";
            todoList.map((e, i) => {
                content += `> ${i + 1}. ${e.content}\n`;
            });
            await interaction.editReply({ content });
        }
    } catch (error) {
        utils.errorLogger(bot.clientId, error);
        await interaction.editReply({ content: "無法變更待辦事項" });
    }
}

export const get_avatar = async (interaction: ChatInputCommandInteraction, bot: BaseBot) => {
    await interaction.deferReply();
    try {
        const user = interaction.options.get("user")?.value as string;
        const member = bot.guildInfo[interaction.guild?.id as string].members[user];
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
        utils.errorLogger(bot.clientId, error);
        await interaction.editReply({ content: "無法取得頭像" });
    }
}

/********** Only for Tomori **********/

export const update_role = async (interaction: ChatInputCommandInteraction, bot: Tomori) => {
    await interaction.deferReply();
    try {
        let leaderboard = await Mee6LevelsApi.getLeaderboardPage(interaction.guild?.id as string);
        let guild = bot.guildInfo[interaction.guild?.id as string].guild;
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
            for (const roleLevel in bot.tomoriConfig.level_roles) {
                if (level >= parseInt(roleLevel.split('_')[1])) {
                    roleToAssign = bot.tomoriConfig.level_roles[roleLevel];
                } else {
                    break;
                }
            }
            if (roleToAssign === "") return;

            // test if the role is exist
            let CorrectRole = guildMember.roles.cache.some(role => role.name === roleToAssign);
            if (!CorrectRole) {
                const channel = interaction.channel as AllowedTextChannel;

                // remove old role
                for (let roleLevel in bot.tomoriConfig.level_roles) {
                    let roleName = bot.tomoriConfig.level_roles[roleLevel];
                    let role = guild.roles.cache.find(role => role.name === roleName);
                    if (role) {
                        let _ = await guildMember.roles.remove(role);
                        await channel.send(`[ SYSTEM ] 移除 ${guildMember.user.tag} ${roleName}`);
                    }
                }

                // add new role
                const role = guild.roles.cache.find(role => role.name === roleToAssign);
                if (role) {
                    let _ = await guildMember.roles.add(role);
                    await channel.send(`[ SYSTEM ] 給予 ${guildMember.user.tag} ${roleToAssign}`);
                }
            }
        }));
        await interaction.editReply({ content: "更新完成" });
    } catch (error) {
        utils.errorLogger(bot.clientId, error);
        await interaction.editReply({ content: "無法更新身份組" });
    }
}