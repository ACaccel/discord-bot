import type {
    ChatInputCommandInteraction,
    GuildMember,
    User} from "discord.js";
import {
    EmbedBuilder
} from "discord.js";
import type { BaseBot } from "@bot";
import { Command } from "@cmd";

import { logError } from '@core/logger';
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

type TFn = (key: string, params?: Record<string, string | number>) => string;

const buildDescription = (id: string, user: User | null, member: GuildMember | null, t: TFn): string => {
    const yesNo = (b: boolean): string => t(b ? 'replies:inspect_member_ids.yes' : 'replies:inspect_member_ids.no');

    if (!user && !member) {
        return [
            `**ID**: \`${id}\``,
            t('replies:inspect_member_ids.not_in_guild_line'),
            t('replies:inspect_member_ids.user_not_found_line'),
        ].join("\n");
    }

    const targetUser = member?.user || user;
    if (!targetUser) {
        return [
            `**ID**: \`${id}\``,
            t('replies:inspect_member_ids.parse_failed_line'),
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
        t('replies:inspect_member_ids.profile_link_line', { id: targetUser.id }),
        t('replies:inspect_member_ids.in_guild_line', { value: yesNo(!!member) }),
        t('replies:inspect_member_ids.account_type_line', { value: targetUser.bot ? "Bot" : "User" }),
        `**Username**: ${toText(targetUser.username)}`,
        `**Global Name**: ${toText(targetUser.globalName)}`,
        `**Tag**: ${toText(targetUser.tag)}`,
        `**Mention**: <@${targetUser.id}>`,
        t('replies:inspect_member_ids.created_at_line', { value: fmtTimestamp(targetUser.createdAt) }),
        `**Avatar**: [Link](${avatarUrl})`,
        `**Banner**: ${bannerUrl ? `[Link](${bannerUrl})` : "N/A"}`,
        `**Accent Color**: ${targetUser.accentColor ? `#${targetUser.accentColor.toString(16).padStart(6, "0")}` : "N/A"}`,
        t('replies:inspect_member_ids.system_user_line', { value: yesNo(targetUser.system ?? false) }),
        `**Public Flags**: ${userFlags.length > 0 ? userFlags.join(", ") : "None"}`,
        t('replies:inspect_member_ids.joined_at_line', { value: member ? fmtTimestamp(member.joinedAt) : "N/A" }),
        t('replies:inspect_member_ids.display_name_line', { value: member ? toText(member.displayName) : "N/A" }),
        t('replies:inspect_member_ids.timed_out_line', { value: member ? yesNo(member.isCommunicationDisabled()) : "N/A" }),
        t('replies:inspect_member_ids.timeout_until_line', { value: member ? fmtTimestamp(member.communicationDisabledUntil) : "N/A" }),
        t('replies:inspect_member_ids.pending_line', { value: member ? yesNo(member.pending ?? false) : "N/A" }),
        t('replies:inspect_member_ids.highest_role_line', { value: member ? `<@&${member.roles.highest.id}>` : "N/A" }),
        t('replies:inspect_member_ids.role_count_line', { value: roles ? String(roles.size) : "N/A" }),
        t('replies:inspect_member_ids.top_roles_line', { value: topRoles }),
        t('replies:inspect_member_ids.boost_since_line', { value: member ? fmtTimestamp(member.premiumSince) : "N/A" }),
        t('replies:inspect_member_ids.kickable_line', { value: member ? yesNo(member.kickable) : "N/A" }),
        t('replies:inspect_member_ids.bannable_line', { value: member ? yesNo(member.bannable) : "N/A" }),
    ];

    return truncate(lines.join("\n"));
};

export default class inspect_member_ids extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "inspect_member_ids",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "檢查多個 ID 是否在本 guild，並列出可查資訊",
            options: {
                string: [
                    {
                        name: "ids",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
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
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_info_not_found') ?? '' });
                return;
            }

            const rawIds = interaction.options.getString("ids", true);
            const allIds = parseIds(rawIds);

            if (allIds.length === 0) {
                await interaction.editReply({ content: bot.translator?.t('replies:inspect_member_ids.no_valid_id') ?? '' });
                return;
            }

            const ids = allIds.slice(0, MAX_IDS_PER_RUN);
            const droppedCount = allIds.length - ids.length;
            const embeds: EmbedBuilder[] = [];
            const t: TFn = (key, params) => bot.translator?.t(key, params) ?? '';

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i] as string;
                const member = await guild.members.fetch(id).catch(() => null);
                const fetchedUser = member?.user || await bot.client.users.fetch(id).catch(() => null);
                const user = fetchedUser ? await fetchedUser.fetch(true).catch(() => fetchedUser) : null;

                const embed = new EmbedBuilder()
                    .setTitle(t('replies:inspect_member_ids.title', { current: i + 1, total: ids.length }))
                    .setColor(member ? 0x57F287 : 0xED4245)
                    .setDescription(buildDescription(id, user, member, t))
                    .setFooter({ text: `${guild.name}｜in guild: ${member ? "yes" : "no"}` });

                embeds.push(embed);
            }

            const first = embeds.shift();
            if (!first) {
                await interaction.editReply({ content: bot.translator?.t('replies:inspect_member_ids.embed_failed') ?? '' });
                return;
            }

            await interaction.editReply({
                content: droppedCount > 0
                    ? t('replies:inspect_member_ids.exceeds_max', { max: MAX_IDS_PER_RUN, dropped: droppedCount })
                    : undefined,
                embeds: [first],
            });

            for (const embed of embeds) {
                await interaction.followUp({ embeds: [embed] });
            }
        } catch (error) {
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:inspect_member_ids.failed') ?? '' });
        }
    }
}
