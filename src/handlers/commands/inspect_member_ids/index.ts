import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    User,
} from "discord.js";
import { BaseBot } from "@bot";
import { Command } from "@cmd";
import { logger } from "@utils";

const MAX_IDS_PER_RUN = 20;

const parseIds = (raw: string): string[] => {
    const matches = raw.match(/\d{17,20}/g) || [];
    return Array.from(new Set(matches));
};

const fmtTimestamp = (date: Date | null | undefined): string => {
    if (!date) return "N/A";
    const unix = Math.floor(date.getTime() / 1000);
    return `<t:${unix}:F> (<t:${unix}:R>)`;
};

const toText = (value: unknown): string => {
    if (value === null || value === undefined) return "N/A";
    if (typeof value === "string" && value.trim() === "") return "N/A";
    return String(value);
};

const truncate = (text: string, max = 3800): string => {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
};

const buildDescription = (id: string, user: User | null, member: GuildMember | null): string => {
    if (!user && !member) {
        return [
            `**ID**: \`${id}\``,
            "**是否在本伺服器**: 否",
            "**使用者資訊**: 查無資料（可能不存在、未快取或無法存取）",
        ].join("\n");
    }

    const targetUser = member?.user || user;
    if (!targetUser) {
        return [
            `**ID**: \`${id}\``,
            "**狀態**: 無法解析使用者資料",
        ].join("\n");
    }

    const userFlags = targetUser.flags?.toArray() || [];
    const avatarUrl = targetUser.displayAvatarURL({ extension: "png", forceStatic: false, size: 1024 });
    const bannerUrl = targetUser.bannerURL({ extension: "png", size: 1024 });
    const roles = member
        ? member.roles.cache
            .filter((r) => r.id !== member.guild.id)
            .sort((a, b) => b.position - a.position)
        : null;
    const topRoles = roles ? roles.first(10).map((r) => `<@&${r.id}>`).join(", ") : "N/A";

    const lines = [
        `**ID**: \`${targetUser.id}\``,
        `**可點擊個人頁**: [Open Profile](https://discord.com/users/${targetUser.id})`,
        `**是否在本伺服器**: ${member ? "是" : "否"}`,
        `**帳號類型**: ${targetUser.bot ? "Bot" : "User"}`,
        `**Username**: ${toText(targetUser.username)}`,
        `**Global Name**: ${toText(targetUser.globalName)}`,
        `**Tag**: ${toText(targetUser.tag)}`,
        `**Mention**: <@${targetUser.id}>`,
        `**帳號建立時間**: ${fmtTimestamp(targetUser.createdAt)}`,
        `**Avatar**: [Link](${avatarUrl})`,
        `**Banner**: ${bannerUrl ? `[Link](${bannerUrl})` : "N/A"}`,
        `**Accent Color**: ${targetUser.accentColor ? `#${targetUser.accentColor.toString(16).padStart(6, "0")}` : "N/A"}`,
        `**System User**: ${targetUser.system ? "是" : "否"}`,
        `**Public Flags**: ${userFlags.length > 0 ? userFlags.join(", ") : "None"}`,
        `**加入伺服器時間**: ${member ? fmtTimestamp(member.joinedAt) : "N/A"}`,
        `**暱稱(Display Name)**: ${member ? toText(member.displayName) : "N/A"}`,
        `**已逾時(Timed Out)**: ${member?.isCommunicationDisabled() ? "是" : "否"}`,
        `**逾時到期**: ${member ? fmtTimestamp(member.communicationDisabledUntil) : "N/A"}`,
        `**Pending 成員驗證**: ${member?.pending ? "是" : "否"}`,
        `**最高身分組**: ${member ? `<@&${member.roles.highest.id}>` : "N/A"}`,
        `**身分組數量**: ${roles ? String(roles.size) : "N/A"}`,
        `**前 10 個身分組**: ${topRoles}`,
        `**Boost 開始時間**: ${member ? fmtTimestamp(member.premiumSince) : "N/A"}`,
        `**可被踢出**: ${member ? (member.kickable ? "是" : "否") : "N/A"}`,
        `**可被封鎖**: ${member ? (member.bannable ? "是" : "否") : "N/A"}`,
    ];

    return truncate(lines.join("\n"));
};

export default class inspect_member_ids extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "inspect_member_ids",
            description: "檢查多個 ID 是否在本 guild，並列出可查資訊",
            options: {
                string: [
                    {
                        name: "ids",
                        description: "可貼多個 ID（逗號/空白/換行分隔）",
                        required: true,
                    },
                ],
            },
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

            const rawIds = interaction.options.getString("ids", true);
            const allIds = parseIds(rawIds);

            if (allIds.length === 0) {
                await interaction.editReply({ content: "找不到有效 ID，請輸入 17~20 位數字的 Discord ID" });
                return;
            }

            const ids = allIds.slice(0, MAX_IDS_PER_RUN);
            const droppedCount = allIds.length - ids.length;
            const embeds: EmbedBuilder[] = [];

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                const member = await guild.members.fetch(id).catch(() => null);
                const fetchedUser = member?.user || await bot.client.users.fetch(id).catch(() => null);
                const user = fetchedUser ? await fetchedUser.fetch(true).catch(() => fetchedUser) : null;

                const embed = new EmbedBuilder()
                    .setTitle(`可疑 ID 檢查 ${i + 1}/${ids.length}`)
                    .setColor(member ? 0x57F287 : 0xED4245)
                    .setDescription(buildDescription(id, user, member))
                    .setFooter({ text: `${guild.name}｜in guild: ${member ? "yes" : "no"}` });

                embeds.push(embed);
            }

            const first = embeds.shift();
            if (!first) {
                await interaction.editReply({ content: "無法建立檢查結果" });
                return;
            }

            await interaction.editReply({
                content: droppedCount > 0 ? `一次最多檢查 ${MAX_IDS_PER_RUN} 筆，已忽略 ${droppedCount} 筆。` : undefined,
                embeds: [first],
            });

            for (const embed of embeds) {
                await interaction.followUp({ embeds: [embed] });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "檢查可疑 ID 失敗" });
        }
    }
}
