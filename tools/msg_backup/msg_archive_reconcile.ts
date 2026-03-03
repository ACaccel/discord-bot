import { ChannelType, Client, Collection, DMChannel, GatewayIntentBits, Message, TextBasedChannel } from "discord.js";
import dotenv from "dotenv";
import db from "@db";
import fs from "fs";
import path from "path";
import config from "./config.json";

dotenv.config({ path: "./src/bot/msg_archive/.env" });

// ================================================
// ================ CONFIGURATION =================
// ================================================
// backup start date in format YYYY-MM-DD (local time / parsed by JS Date)
// Example: "2024-01-01"
const START_DATE = config.start_date;

// Target guilds for backup.
// If this array is non-empty, ONLY these guild IDs will be processed.
// If you want to process all guilds the bot is in, set this to [].
const BACKUP_SERVER: string[] = config.guilds;

// ================================================
// ================ END CONFIGURATION =============
// ================================================

type GuildDatabase = Awaited<ReturnType<typeof db.dbConnect>>;

interface ChannelSummary {
    guildId: string;
    guildName: string;
    channelId: string;
    channelName: string;
    inserted: number;
    updatedPartial: number;
    deletedBot: number;
    fixedDups: number;
}

const channelSummaries: ChannelSummary[] = [];

const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// log file setup (single log file in current working directory)
const LOG_FILE = path.join(
    process.cwd(),
    'tools',
    `msg_archive_reconcile_${new Date().toISOString().replace(/[:.]/g, "-")}.log`
);

const log = (message: string) => {
    console.log(message);
    try {
        fs.appendFileSync(LOG_FILE, message + "\n");
    } catch {
        // ignore logging errors to avoid breaking the tool
    }
};

if (!TOKEN || !MONGO_URI) {
    console.error("Missing TOKEN or MONGO_URI in environment variables.");
    process.exit(1);
}

const parseStartTimestamp = (): number => {
    if (!START_DATE) {
        console.error("START_DATE is empty. Please set START_DATE in tools/msg_archive_reconcile.ts (format: YYYY-MM-DD).");
        process.exit(1);
    }

    // Basic format check: YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(START_DATE)) {
        console.error("START_DATE format invalid. Expected YYYY-MM-DD, e.g., 2024-01-01.");
        process.exit(1);
    }

    const asDate = new Date(START_DATE);
    if (Number.isNaN(asDate.getTime())) {
        console.error("START_DATE cannot be parsed by Date(). Please check the value.");
        process.exit(1);
    }

    return asDate.getTime();
};

interface MonthBucket {
    year: number;
    month: number; // 1-12
}

const buildMonthBuckets = (startMs: number, endMs: number): MonthBucket[] => {
    const buckets: MonthBucket[] = [];
    const start = new Date(startMs);
    const end = new Date(endMs);

    // normalize to first day of month
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);

    end.setUTCDate(1);
    end.setUTCHours(0, 0, 0, 0);

    let current = new Date(start.getTime());
    while (current.getTime() <= end.getTime()) {
        buckets.push({
            year: current.getUTCFullYear(),
            month: current.getUTCMonth() + 1
        });
        current.setUTCMonth(current.getUTCMonth() + 1);
    }

    return buckets;
};

const findMonthIndex = (buckets: MonthBucket[], year: number, month: number): number => {
    return buckets.findIndex(b => b.year === year && b.month === month);
};

const reconcileChannel = async (
    guildId: string,
    guildName: string,
    channel: TextBasedChannel,
    database: GuildDatabase,
    startTimestamp: number,
    monthBuckets: MonthBucket[]
) => {
    log(`[Guild ${guildId}] Start reconcile channel: ${channel.id} (${(channel as any).name || "DM"})`);

    const anyChannel = channel as any;
    // Some channel types (e.g. forum parents) do not support message fetching.
    // In those cases, skip reconciliation for this channel instead of throwing.
    if (!anyChannel.messages || typeof anyChannel.messages.fetch !== "function") {
        log(
            `[Guild ${guildId}] Channel ${anyChannel.name || channel.id} does not support message fetching (no messages manager). Skipping.`
        );
        return;
    }

    let beforeId: string | undefined = undefined;
    let processedMessages = 0;
    let deletedBotMessages = 0;
    let fixedDuplicates = 0;
    let insertedMissing = 0;
    let updatedPartials = 0;
    let lastReportedMonthKey: string | null = null;
    let monthProcessed = 0;
    let monthInserted = 0;
    let monthDeletedBot = 0;
    let monthFixedDups = 0;
    let monthUpdatedPartials = 0;
    let latestMessageId: string | undefined = undefined;

    const totalMonths = monthBuckets.length;

    // Batch processing buffers
    const BATCH_SIZE = 100; // Process messages in batches
    const messageBatch: Message[] = [];
    const messageIdBatch: string[] = [];
    let pendingInserts: any[] = [];
    let pendingUpdates: any[] = [];
    let pendingBotDeletes: string[] = [];
    let pendingDupDeletes: string[] = [];

    const flushBatch = async () => {
        if (messageIdBatch.length === 0) return;

        // Batch query: fetch all messageIds at once
        const existingDocs = await database.models["Message"].find({
            messageId: { $in: messageIdBatch }
        });
        const existingMap = new Map<string, any[]>();
        existingDocs.forEach((doc: any) => {
            if (!existingMap.has(doc.messageId)) {
                existingMap.set(doc.messageId, []);
            }
            existingMap.get(doc.messageId)!.push(doc);
        });

        // Process each message in the batch
        for (const msg of messageBatch) {
            if (!msg.author) continue;

            if (msg.author.bot) {
                pendingBotDeletes.push(msg.id);
                continue;
            }

            const docs = existingMap.get(msg.id) || [];

            if (docs.length === 0) {
                // Prepare for batch insert
                pendingInserts.push({
                    channelId: channel.id,
                    channelName: (channel as any).name || "",
                    content: msg.content,
                    messageId: msg.id,
                    userId: msg.author.id,
                    userName: msg.author.username,
                    attachments: msg.attachments.map((attachment: any) => ({
                        id: attachment.id,
                        name: attachment.name,
                        url: attachment.url,
                        contentType: attachment.contentType
                    })),
                    reactions: msg.reactions.cache.map((reaction: any) => ({
                        id: reaction.emoji.id,
                        name: reaction.emoji.name,
                        animated: reaction.emoji.animated,
                        count: reaction.count,
                        userIds: reaction.users.cache.map((user: any) => user.id)
                    })),
                    stickers: msg.stickers.map((sticker: any) => ({
                        id: sticker.id,
                        name: sticker.name
                    })),
                    timestamp: msg.createdTimestamp
                });
            } else if (docs.length === 1) {
                const doc = docs[0] as any;
                const cutoff = new Date("2025-09-01").getTime();
                const isPartial =
                    (typeof doc.timestamp === "number" && doc.timestamp < cutoff) &&
                    (Array.isArray(doc.attachments) && doc.attachments.length === 0) &&
                    (Array.isArray(doc.reactions) && doc.reactions.length === 0) &&
                    (Array.isArray(doc.stickers) && doc.stickers.length === 0);

                if (isPartial) {
                    // Prepare for batch update
                    pendingUpdates.push({
                        filter: { _id: doc._id },
                        update: {
                            $set: {
                                channelId: channel.id,
                                channelName: (channel as any).name || "",
                                content: msg.content,
                                userId: msg.author.id,
                                userName: msg.author.username,
                                attachments: msg.attachments.map((attachment: any) => ({
                                    id: attachment.id,
                                    name: attachment.name,
                                    url: attachment.url,
                                    contentType: attachment.contentType
                                })),
                                reactions: msg.reactions.cache.map((reaction: any) => ({
                                    id: reaction.emoji.id,
                                    name: reaction.emoji.name,
                                    animated: reaction.emoji.animated,
                                    count: reaction.count,
                                    userIds: reaction.users.cache.map((user: any) => user.id)
                                })),
                                stickers: msg.stickers.map((sticker: any) => ({
                                    id: sticker.id,
                                    name: sticker.name
                                })),
                                timestamp: msg.createdTimestamp
                            }
                        }
                    });
                }
            } else if (docs.length > 1) {
                const [keep, ...dups] = docs;
                if (dups.length > 0) {
                    pendingDupDeletes.push(...dups.map((d: any) => d._id));
                }
            }
        }

        // Execute batch operations
        if (pendingInserts.length > 0) {
            try {
                await database.models["Message"].insertMany(pendingInserts, { ordered: false });
                insertedMissing += pendingInserts.length;
                monthInserted += pendingInserts.length;
            } catch (err: any) {
                // Handle duplicate key errors: insert remaining one by one
                if (err.code === 11000 || err.name === 'BulkWriteError') {
                    const inserted = err.insertedCount || 0;
                    insertedMissing += inserted;
                    monthInserted += inserted;
                    // Try inserting remaining individually (skip duplicates)
                    for (const doc of pendingInserts.slice(inserted)) {
                        try {
                            await database.models["Message"].create(doc);
                            insertedMissing++;
                            monthInserted++;
                        } catch {
                            // Skip duplicates
                        }
                    }
                } else {
                    throw err;
                }
            }
            pendingInserts = [];
        }

        if (pendingUpdates.length > 0) {
            const bulkOps = pendingUpdates.map(op => ({
                updateOne: {
                    filter: op.filter,
                    update: op.update
                }
            }));
            await database.models["Message"].bulkWrite(bulkOps, { ordered: false });
            updatedPartials += pendingUpdates.length;
            monthUpdatedPartials += pendingUpdates.length;
            pendingUpdates = [];
        }

        if (pendingBotDeletes.length > 0) {
            const deleteResult = await database.models["Message"].deleteMany({
                messageId: { $in: pendingBotDeletes }
            });
            if (deleteResult.deletedCount) {
                deletedBotMessages += deleteResult.deletedCount;
                monthDeletedBot += deleteResult.deletedCount;
            }
            pendingBotDeletes = [];
        }

        if (pendingDupDeletes.length > 0) {
            await database.models["Message"].deleteMany({
                _id: { $in: pendingDupDeletes }
            });
            fixedDuplicates += pendingDupDeletes.length;
            monthFixedDups += pendingDupDeletes.length;
            pendingDupDeletes = [];
        }

        // Clear batch buffers
        messageBatch.length = 0;
        messageIdBatch.length = 0;
    };

    outer: while (true) {
        const fetchedAll: Collection<string, Message> = await anyChannel.messages.fetch({
            limit: 100,
            ...(beforeId && { before: beforeId })
        });

        if (fetchedAll.size === 0) {
            break;
        }

        // Find the newest message id by comparing timestamps in the batch
        let newestMsgId: string | undefined;
        let newestTimestamp = 0;
        for (const msg of fetchedAll.values()) {
            if (msg.createdTimestamp > newestTimestamp) {
                newestTimestamp = msg.createdTimestamp;
                newestMsgId = msg.id;
            }
        }
        if (newestMsgId && !latestMessageId) {
            latestMessageId = newestMsgId;
        }

        for (const msg of fetchedAll.values()) {
            const ts = msg.createdTimestamp;
            if (ts < startTimestamp) {
                // reached messages older than start time; flush remaining batch and stop
                if (messageBatch.length > 0) {
                    await flushBatch();
                }
                break outer;
            }

            const d = new Date(ts);
            const year = d.getUTCFullYear();
            const month = d.getUTCMonth() + 1;
            const monthKey = `${year}-${month.toString().padStart(2, "0")}`;

            if (monthKey !== lastReportedMonthKey) {
                // summarize previous month if exists
                if (lastReportedMonthKey !== null) {
                    log(
                        `[Guild ${guildId}] [Channel ${(channel as any).name || channel.id}] ` +
                        `Month ${lastReportedMonthKey} summary: ` +
                        `Processed ${monthProcessed} messages, ` +
                        `Inserted ${monthInserted}, ` +
                        `Updated partial ${monthUpdatedPartials}, ` +
                        `Deleted bot ${monthDeletedBot}, ` +
                        `Fixed dups ${monthFixedDups}`
                    );
                    monthProcessed = 0;
                    monthInserted = 0;
                    monthDeletedBot = 0;
                    monthFixedDups = 0;
                    monthUpdatedPartials = 0;
                }

                const idx = findMonthIndex(monthBuckets, year, month);
                if (idx !== -1) {
                    const processedMonths = totalMonths - idx;
                    const remainingMonths = idx;
                    log(
                        `[Guild ${guildId}] [Channel ${(channel as any).name || channel.id}] ` +
                        `Progress: ${year}-${month.toString().padStart(2, "0")} ` +
                        `(${processedMonths}/${totalMonths} months processed, ${remainingMonths} remaining)`
                    );
                } else {
                    log(
                        `[Guild ${guildId}] [Channel ${(channel as any).name || channel.id}] ` +
                        `Processing month: ${year}-${month.toString().padStart(2, "0")}`
                    );
                }
                lastReportedMonthKey = monthKey;
            }

            processedMessages++;
            monthProcessed++;

            if (!msg.author) {
                continue;
            }

            // Add to batch for processing
            messageBatch.push(msg);
            messageIdBatch.push(msg.id);

            // Flush batch when it reaches BATCH_SIZE
            if (messageBatch.length >= BATCH_SIZE) {
                await flushBatch();
            }
        }

        // Flush remaining messages in batch after processing all fetched messages
        if (messageBatch.length > 0) {
            await flushBatch();
        }

        const lastKey = fetchedAll.lastKey();
        if (!lastKey) {
            break;
        }
        beforeId = lastKey;
    }

    // Final month summary if we processed any messages in the last month
    if (lastReportedMonthKey !== null) {
        log(
            `[Guild ${guildId}] [Channel ${(channel as any).name || channel.id}] ` +
            `Month ${lastReportedMonthKey} summary: ` +
            `Processed ${monthProcessed} messages, ` +
            `Inserted ${monthInserted}, ` +
            `Updated partial ${monthUpdatedPartials}, ` +
            `Deleted bot ${monthDeletedBot}, ` +
            `Fixed dups ${monthFixedDups}`
        );
    }

    // sync Fetch.lastMessageID for this channel to the latest message we've seen
    if (latestMessageId) {
        await database.models["Fetch"].findOneAndUpdate(
            { channel: (channel as any).name || "", channelID: channel.id },
            { lastMessageID: latestMessageId },
            { upsert: true }
        );
    }

    log(
        `[Guild ${guildId}] Finished channel ${(channel as any).name || channel.id}. ` +
        `Total processed: ${processedMessages}, Inserted: ${insertedMissing}, ` +
        `Updated partial: ${updatedPartials}, ` +
        `Deleted bot: ${deletedBotMessages}, Fixed dups: ${fixedDuplicates}`
    );

    channelSummaries.push({
        guildId,
        guildName,
        channelId: channel.id,
        channelName: (channel as any).name || "DM",
        inserted: insertedMissing,
        updatedPartial: updatedPartials,
        deletedBot: deletedBotMessages,
        fixedDups: fixedDuplicates
    });
};

const reconcileGuild = async (
    client: Client,
    guildId: string,
    database: GuildDatabase,
    startTimestamp: number
) => {
    log(`[Guild ${guildId}] Starting reconciliation from ${new Date(startTimestamp).toISOString()}`);

    const guild = await client.guilds.fetch(guildId);
    // Ensure channels are loaded into cache
    await guild.channels.fetch();
    const monthBuckets = buildMonthBuckets(startTimestamp, Date.now());

    const textChannels: TextBasedChannel[] = [];
    const seenChannelIds = new Set<string>();

    const channelTypes: ChannelType[] = [
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildAnnouncement,
        ChannelType.AnnouncementThread,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.GuildStageVoice,
        ChannelType.GuildForum,
    ];
    const allowedTypes = new Set<ChannelType>(channelTypes);

    // include all allowed text-based guild channels AND all discussion / forum threads as separate channels
    for (const channel of guild.channels.cache.values()) {
        if (!channel) continue;

        const anyChannel = channel as any;

        if (typeof anyChannel.type === "number" && allowedTypes.has(anyChannel.type)) {
            if (!seenChannelIds.has(channel.id)) {
                textChannels.push(channel as TextBasedChannel);
                seenChannelIds.add(channel.id);
            }
        }

        // discussion / thread channels under this parent (e.g., text channel threads, forum posts)
        const threadManager = anyChannel.threads;
        if (threadManager && typeof threadManager.fetchActive === "function" && typeof threadManager.fetchArchived === "function") {
            try {
                const active = await threadManager.fetchActive();
                active.threads.forEach((thread: any) => {
                    if (!thread) return;
                    if (typeof thread.type !== "number" || !allowedTypes.has(thread.type)) return;
                    if (seenChannelIds.has(thread.id)) return;
                    textChannels.push(thread as TextBasedChannel);
                    seenChannelIds.add(thread.id);
                });

                const archived = await threadManager.fetchArchived();
                archived.threads.forEach((thread: any) => {
                    if (!thread) return;
                    if (typeof thread.type !== "number" || !allowedTypes.has(thread.type)) return;
                    if (seenChannelIds.has(thread.id)) return;
                    textChannels.push(thread as TextBasedChannel);
                    seenChannelIds.add(thread.id);
                });
            } catch (err) {
                log(
                    `[Guild ${guildId}] Failed to fetch threads for channel ${(channel as any).name || channel.id}: ` +
                    String(err)
                );
            }
        }
    }
    // Log all channel names line by line
    log(`[Guild ${guildId}] Channel list:`);
    textChannels.forEach(channel => {
        log(`- ${(channel as any).name || channel.id}`);
    });

    log(`[Guild ${guildId}] Found ${textChannels.length} text-based channels (including threads & forum posts) to reconcile.`);

    let channelIndex = 0;
    for (const channel of textChannels) {
        channelIndex++;
        log(
            `[Guild ${guildId}] (${channelIndex}/${textChannels.length}) ` +
            `Reconciling channel: ${(channel as any).name || channel.id}`
        );
        await reconcileChannel(guildId, guild.name, channel, database, startTimestamp, monthBuckets);
    }

    log(`[Guild ${guildId}] Reconciliation completed.`);
};

const main = async () => {
    const startTimestamp = parseStartTimestamp();
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    log("Logging in Discord client for reconciliation tool...");
    await client.login(TOKEN);
    log("Discord client logged in.");

    const backupServers = BACKUP_SERVER.length > 0
        ? BACKUP_SERVER
        : client.guilds.cache.map(guild => guild.id)

    log(`Target guilds for reconciliation: ${backupServers.join(", ")}`);

    for (const guildId of backupServers) {
        log(`[Guild ${guildId}] Connecting to MongoDB...`);
        const database = await db.dbConnect(MONGO_URI, guildId);
        await reconcileGuild(client, guildId, database, startTimestamp);
    }

    log("==== Reconciliation Overview by Channel ====");
    channelSummaries.forEach(summary => {
        log(
            `[OVERVIEW] [Guild ${summary.guildId} ${summary.guildName}] ` +
            `[Channel ${summary.channelName} (${summary.channelId})] ` +
            `Inserted ${summary.inserted}, ` +
            `Updated partial ${summary.updatedPartial}, ` +
            `Deleted bot ${summary.deletedBot}, ` +
            `Fixed dups ${summary.fixedDups}`
        );
    });

    log("All guilds reconciled. Exiting.");
    process.exit(0);
};

main().catch(err => {
    console.error("Reconciliation tool failed:", err);
    process.exit(1);
});

