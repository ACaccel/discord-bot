import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    ChannelType,
    Guild,
    MessageFlags,
} from "discord.js";
import { BaseBot } from "@bot";
import { Command } from "@cmd";
import { logger } from "@utils";
import type { ChannelId } from "../../../core/ids";
import type { MessageDoc } from "../../../persistence/schemas/message.schema";

// Audit C-1 reviewer follow-up: the local DbMessage shape was a hand-
// maintained copy of the persistence schema. Aliasing it to the typed
// `MessageDoc` keeps the handler reactive to schema changes — a future
// field add becomes a compile error in the rendering code instead of a
// silent drift between two definitions.
type DbMessage = MessageDoc;

const isValidDateString = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);

const parseDateParts = (date: string): { year: number; month: number; day: number } | null => {
    if (!isValidDateString(date)) return null;
    const [y, m, d] = date.split("-").map((v) => Number(v));
    if (!y || !m || !d) return null;
    return { year: y, month: m, day: d };
};

// Build start/end timestamps in **local time** (server timezone)
const parseStartEnd = (date: string, hour?: number | null): { startMs: number; endMs: number } | null => {
    const parts = parseDateParts(date);
    if (!parts) return null;

    const { year, month, day } = parts;

    // full day in local time
    if (hour === null || hour === undefined) {
        const start = new Date(year, month - 1, day, 0, 0, 0, 0);
        const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
        return { startMs: start.getTime(), endMs: end.getTime() };
    }

    // single hour in the day (local time)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

    const start = new Date(year, month - 1, day, hour, 0, 0, 0);
    const end = new Date(year, month - 1, day, hour + 1, 0, 0, 0);
    return { startMs: start.getTime(), endMs: end.getTime() };
};

const buildReactionText = (reaction: NonNullable<DbMessage["reactions"]>[number]): string => {
    const name = reaction.name ?? "";
    const id = reaction.id ?? "";
    const animated = Boolean(reaction.animated);

    // Custom emoji: <a:name:id> or <:name:id>
    if (id && name) {
        return `<${animated ? "a:" : ":"}${name}:${id}>`;
    }

    // Unicode emoji (no id)
    if (name) return name;
    return "[unknown_reaction]";
};

// Avoid actually pinging users/roles/everyone when printing into a channel
const sanitizeMentions = (text: string): string => {
    return text
        // @everyone / @here
        .replace(/@everyone/g, "@\u200beveryone")
        .replace(/@here/g, "@\u200bhere")
        // user mentions <@123>, <@!123>
        .replace(/<@!?(\d+)>/g, "@user($1)")
        // role mentions <@&123>
        .replace(/<@&(\d+)>/g, "@role($1)");
};

const getDisplayName = async (guild: Guild, userId: string, fallbackUserName: string, cache: Map<string, string>) => {
    const cached = cache.get(userId);
    if (cached) return cached;

    try {
        const member = await guild.members.fetch(userId);
        const dn = member?.displayName || fallbackUserName;
        cache.set(userId, dn);
        return dn;
    } catch {
        cache.set(userId, fallbackUserName);
        return fallbackUserName;
    }
};

const truncateDisplayName = (name: string, maxLength = 10): string => {
    if (name.length <= maxLength) return name;
    return name.slice(0, maxLength) + "...";
};

export default class db_list_message extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "db_list_message",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "列出特定頻道、特定日期、特定時段(hour)的訊息紀錄",
            options: {
                channel: [
                    {
                        name: "channel",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "要查詢的頻道/討論串",
                        required: true,
                    },
                ],
                string: [
                    {
                        name: "date",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "日期 (YYYY-MM-DD)",
                        required: true,
                    },
                    {
                        name: "print",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "是否直接發成訊息 (yes: 直接發訊息, no: 文字檔, 預設 no)",
                        required: false,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "文字檔 (預設)", value: "no" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "訊息", value: "yes" },
                        ],
                    }
                ],
                number: [
                    {
                        name: "hour",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "時段 (0-23)",
                        required: false,
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
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_not_found') ?? '' });
                return;
            }

            const repos = bot.guildInfo[guild.id]?.repos;
            if (!repos) {
                await interaction.editReply({ content: bot.translator?.t('errors:db.not_found') ?? '' });
                return;
            }

            const channel = interaction.options.getChannel("channel", true);
            const channelTypes: ChannelType[] = [
                ChannelType.GuildText,
                ChannelType.GuildVoice,
                ChannelType.GuildAnnouncement,
                ChannelType.AnnouncementThread,
                ChannelType.PublicThread,
                ChannelType.PrivateThread,
                ChannelType.GuildStageVoice,
                ChannelType.GuildForum,
            ] as const;
            const allowedTypes = new Set<ChannelType>(channelTypes);
            if (!allowedTypes.has(channel.type)) {
                await interaction.editReply({ content: bot.translator?.t('replies:db_list_message.not_text_channel') ?? '' });
                return;
            }

            const date = interaction.options.getString("date", true);
            const print = (interaction.options.getString("print", false) as string | null) || "no";
            const hour = interaction.options.getInteger("hour", false);
            const range = parseStartEnd(date, hour);
            if (!range) {
                await interaction.editReply({ content: bot.translator?.t('replies:db_list_message.invalid_args') ?? '' });
                return;
            }

            const { startMs, endMs } = range;

            const messages = (await repos.message.findByChannelAndTimestampRange(
                channel.id as ChannelId,
                startMs,
                endMs,
            )) as unknown as DbMessage[];

            if (messages.length === 0) {
                const scopeText = hour === null || hour === undefined
                    ? bot.translator?.t('replies:db_list_message.scope_full_day', { date }) ?? ''
                    : bot.translator?.t('replies:db_list_message.scope_hour', { date, hour }) ?? '';
                await interaction.editReply({ content: bot.translator?.t('replies:db_list_message.no_messages', { channelId: channel.id, scopeText }) ?? '' });
                return;
            }

            const displayNameCache = new Map<string, string>();
            const lines: string[] = [];

            for (const msg of messages) {
                const userName = msg.userName || "unknown";
                const rawDisplayName = await getDisplayName(guild, msg.userId, userName, displayNameCache);
                const shortDisplayName = truncateDisplayName(rawDisplayName);

                const tsNum = typeof msg.timestamp === "string" ? Number(msg.timestamp) : msg.timestamp;
                const dateObj = new Date(tsNum || 0);
                const hh = dateObj.getHours().toString().padStart(2, "0");
                const mm = dateObj.getMinutes().toString().padStart(2, "0");
                const timePrefix = `*${hh}:${mm}* `;

                const prefix = `${timePrefix}**${shortDisplayName} (${userName})**: `;

                const lineStartIndex = lines.length;

                const content = (msg.content || "").trimEnd();
                if (content.length > 0) {
                    // Preserve original newlines, but prefix only the first line.
                    const parts = content.split("\n");
                    lines.push(prefix + parts[0]);
                    for (const extra of parts.slice(1)) {
                        lines.push(extra);
                    }
                }

                const attachments = msg.attachments || [];
                for (const a of attachments) {
                    const name = a.name || a.id || "unknown_attachment";
                    const url = a.url ? ` - ${a.url}` : "";
                    lines.push(`${prefix}attachment - ${name}${url}`);
                }

                const stickers = msg.stickers || [];
                for (const s of stickers) {
                    lines.push(`${prefix}sticker - ${s.name || s.id || "unknown_sticker"}`);
                }

                const reactions = msg.reactions || [];
                const reactionParts: string[] = [];
                for (const r of reactions) {
                    const emojiText = buildReactionText(r);
                    const count = typeof r.count === "number" ? r.count : 0;
                    reactionParts.push(`${emojiText} x${count}`);
                }

                // If message has no visible output, still emit a placeholder line
                if (
                    content.length === 0 &&
                    attachments.length === 0 &&
                    stickers.length === 0
                ) {
                    lines.push(`${prefix}[empty]`);
                }

                // Append reaction summary to the first line of this message (if any)
                if (reactionParts.length > 0 && lines.length > lineStartIndex) {
                    lines[lineStartIndex] += ` [reactions: ${reactionParts.join(", ")}]`;
                }
            }

            const rangeText = hour === null || hour === undefined
                ? bot.translator?.t('replies:db_list_message.range_full_day', { date }) ?? ''
                : `${date} ${hour.toString().padStart(2, "0")}:00 - ${(hour + 1).toString().padStart(2, "0")}:00`;

            if (print === "yes") {
                // 直接發成訊息到「slash 使用的頻道」，避免超過 2000 字限制，切塊發送
                const outChannel = interaction.channel;
                if (!outChannel || typeof (outChannel as any).send !== "function") {
                    await interaction.editReply({
                        content: bot.translator?.t('replies:db_list_message.no_output_channel') ?? '',
                    });
                    return;
                }

                // sanitize mentions so we don't ping users/roles/everyone
                const safeLines = lines.map((l) => sanitizeMentions(l));

                const maxLen = 1900;
                const chunks: string[] = [];
                let current = "";

                for (const line of safeLines) {
                    const add = (current ? "\n" : "") + line;
                    if (current.length + add.length > maxLen) {
                        if (current) chunks.push(current);
                        current = line;
                    } else {
                        current += add;
                    }
                }
                if (current) chunks.push(current);

                await interaction.editReply({
                    content: bot.translator?.t('replies:db_list_message.found_split', { count: messages.length, rangeText, channelId: channel.id, chunks: chunks.length }) ?? '',
                });

                for (const chunk of chunks) {
                    await (outChannel as any).send({
                        content: chunk,
                        flags: MessageFlags.SuppressEmbeds,
                    });
                }
            } else {
                const text = lines.join("\n");
                const hourLabel = hour === null || hour === undefined
                    ? "allday"
                    : `${hour.toString().padStart(2, "0")}`;
                const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), {
                    name: `db_list_message_${channel.id}_${date}_${hourLabel}.txt`,
                });

                await interaction.editReply({
                    content: bot.translator?.t('replies:db_list_message.found', { count: messages.length, rangeText, channelId: channel.id }) ?? '',
                    files: [attachment],
                });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:db_list_message.failed') ?? '' });
        }
    }
}

