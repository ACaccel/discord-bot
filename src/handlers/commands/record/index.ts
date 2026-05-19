import type {
    ChatInputCommandInteraction,
    GuildMember} from 'discord.js';
import {
    AttachmentBuilder,
} from 'discord.js';
import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import fs from 'fs';
import path from 'path';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { logError } from '@core/logger';

export default class record extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "record",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "錄音",
            options: {
                string: [
                    {
                        name: "action",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "開始或停止錄音",
                        required: true,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "開始", value: "start" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "停止", value: "stop" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "儲存音檔 (last n minutes)", value: "save" }
                        ]
                    }
                ],
                number: [
                    {
                        name: "duration",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "錄音時間長度 (last n minutes) (optional)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        const t = (key: string, params?: Record<string, string | number>): string =>
            bot.translator?.t(key, params) ?? '';
        try {
            const action = interaction.options.get("action")?.value as string;
            let duration = interaction.options.get("duration")?.value as number;

            const voice = bot.voice;
            if (voice === undefined) {
                await interaction.editReply({ content: t('replies:record.failed') });
                return;
            }

            if (action === "start") {
                const member = interaction.member as GuildMember;
                if (!member.voice.channelId) {
                    await interaction.editReply({ content: t('replies:record.join_voice_first') });
                    return;
                }
                if (!interaction.guild?.voiceAdapterCreator) {
                    await interaction.editReply({ content: t('replies:record.cannot_join_voice') });
                    return;
                }
                voice.start(
                    interaction.guild.id,
                    member.voice.channelId,
                    interaction.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
                );
                await interaction.editReply({ content: t('replies:record.started') });
            } else if (action === "stop") {
                if (!voice.isRecording()) {
                    await interaction.editReply({ content: t('replies:record.no_recording') });
                    return;
                }
                voice.stop();
                await interaction.editReply({ content: t('replies:record.stopped') });
            } else if (action === "save") {
                if (!duration) {
                    duration = 5;
                }
                if (!voice.isRecording()) {
                    await interaction.editReply({ content: t('replies:record.no_recording') });
                    return;
                }

                const timestamp = new Date().toLocaleString().replace(/\/|:|\s/g, "-");
                const file_path = `./data/voice_record/${interaction.guild?.name}/${timestamp}.zip`;
                fs.mkdirSync(path.dirname(file_path), { recursive: true });
                const voice_stream = fs.createWriteStream(file_path);
                const { buffer } = await voice.save(
                    interaction.guild?.id as string,
                    duration,
                    voice_stream,
                );

                if (buffer.length === 0) {
                    await interaction.editReply({ content: t('replies:record.no_audio') });
                } else {
                    const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.zip` });
                    await interaction.editReply({ content: t('replies:record.saved', { duration }), files: [attachment] });
                }
            } else {
                await interaction.editReply({ content: t('replies:record.invalid_action') });
            }
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: t('replies:record.failed') });
        }
    }
}
