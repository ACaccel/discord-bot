import { 
    ChatInputCommandInteraction,
    GuildMember,
    AttachmentBuilder
} from 'discord.js';
import { 
    joinVoiceChannel,
    DiscordGatewayAdapterCreator
} from "@discordjs/voice";
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import fs from 'fs';
import path from 'path';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class record extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "record",
            description: "錄音",
            options: {
                string: [
                    {
                        name: "action",
                        description: "開始或停止錄音",
                        required: true,
                        choices: [
                            { name: "開始", value: "start" },
                            { name: "停止", value: "stop" },
                            { name: "儲存音檔 (last n minutes)", value: "save" }
                        ]
                    }
                ],
                number: [
                    {
                        name: "duration",
                        description: "錄音時間長度 (last n minutes) (optional)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
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
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法錄音" });
        }
    }
}