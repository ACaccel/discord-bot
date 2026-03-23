import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
} from "discord.js";
import { BaseBot } from "@bot";
import { Command } from "@cmd";
import { logger } from "@utils";

const MAX_DESCRIPTION_LENGTH = 3800;

const chunkLines = (lines: string[], maxLength: number): string[] => {
    const chunks: string[] = [];
    let currentChunk = "";

    for (const line of lines) {
        if (!currentChunk) {
            currentChunk = line;
            continue;
        }

        if ((currentChunk.length + 1 + line.length) <= maxLength) {
            currentChunk += `\n${line}`;
            continue;
        }

        chunks.push(currentChunk);
        currentChunk = line;
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
};

const buildMemberLine = (member: GuildMember): string => {
    const user = member.user;
    const displayName = member.displayName.replace(/\]/g, "\\]");
    const profileUrl = `https://discord.com/users/${user.id}`;
    const badge = user.bot ? "`[BOT]` " : "";
    return `${badge}[${displayName}](${profileUrl}) - <@${user.id}>`;
};

export default class list_guild_members extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "list_guild_members",
            description: "列出目前伺服器所有成員（含機器人）",
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();

        try {
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply({ content: "找不到伺服器資訊" });
                return;
            }

            const memberMap = await guild.members.fetch();
            const members = Array.from(memberMap.values())
                .sort((a, b) => {
                    if (a.user.bot !== b.user.bot) {
                        return Number(a.user.bot) - Number(b.user.bot);
                    }
                    return a.displayName.localeCompare(b.displayName, "zh-Hant");
                });

            if (members.length === 0) {
                await interaction.editReply({ content: "目前沒有可列出的成員" });
                return;
            }

            const lines = members.map(buildMemberLine);
            const chunks = chunkLines(lines, MAX_DESCRIPTION_LENGTH);

            const title = `${guild.name} 成員清單`;
            const totalText = `總數：${members.length}（使用者：${members.filter((m) => !m.user.bot).length}、機器人：${members.filter((m) => m.user.bot).length}）`;

            const firstEmbed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(chunks[0])
                .setColor(0x5865F2)
                .setFooter({ text: `${totalText}｜第 1/${chunks.length} 頁` });

            await interaction.editReply({ embeds: [firstEmbed] });

            for (let i = 1; i < chunks.length; i++) {
                const pageEmbed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(chunks[i])
                    .setColor(0x5865F2)
                    .setFooter({ text: `${totalText}｜第 ${i + 1}/${chunks.length} 頁` });

                await interaction.followUp({ embeds: [pageEmbed] });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "取得成員清單失敗" });
        }
    }
}
