import * as fs from 'fs';
import * as path from 'path';
import {
    ChannelType,
    Client,
    DiscordAPIError,
    Message,
    PartialMessage,
    GuildMember,
    PartialGuildMember,
    MessageReaction,
    PartialMessageReaction,
    TextBasedChannel
} from 'discord.js';
import { BaseBot, Config } from '@bot';
import { logger } from '@utils';

interface MsgArchiveConfig extends Config {
    backup_server: string[];
}

interface ChannelBackupStats {
    channelId: string;
    channelName: string;
    mode: 'incremental' | 'full';
    resumeFromMsgId?: string;
    startMsgId?: string;
    startMsgContent?: string;
    endMsgId?: string;
    endMsgContent?: string;
    newMessages: number;
    totalFetched: number;
    skippedBots: number;
    skippedDuplicates: number;
    batches: number;
    durationMs: number;
    error?: string;
}

class BackupLog {
    private fd: number;
    constructor(filePath: string) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        this.fd = fs.openSync(filePath, 'w');
    }
    writeln(line = '') { fs.writeSync(this.fd, line + '\n'); }
    close() { fs.closeSync(this.fd); }
}

const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Retries `fn` up to `maxAttempts` times on ConnectTimeoutError with exponential backoff.
// All other errors are re-thrown immediately.
async function retryFetch<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let delay = 2000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const isTimeout = err?.name === 'ConnectTimeoutError' || String(err).includes('ConnectTimeoutError');
            if (!isTimeout || attempt === maxAttempts) throw err;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
    throw new Error('unreachable');
}

const ALLOWED_CHANNEL_TYPES = new Set<ChannelType>([
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.AnnouncementThread,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
]);

export class MsgArchive extends BaseBot<MsgArchiveConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: MsgArchiveConfig) {
        super(client, token, mongoURI, clientId, config);
    }

    public override interactionEventListener = async (_interaction: any): Promise<void> => {};
    public override messageCreateListener = async (_message: Message): Promise<void> => {};
    public override messageUpdateListener = async (_old: Message | PartialMessage, _new: Message | PartialMessage): Promise<void> => {};
    public override messageDeleteListener = async (_message: Message | PartialMessage): Promise<void> => {};
    public override messageReactionAddListener = async (_reaction: MessageReaction | PartialMessageReaction, _user: any): Promise<void> => {};
    public override messageReactionRemoveListener = async (_reaction: MessageReaction | PartialMessageReaction, _user: any): Promise<void> => {};
    public override guildMemberUpdateListener = async (_old: GuildMember | PartialGuildMember, _new: GuildMember | PartialGuildMember): Promise<void> => {};
    public override guildCreateListener = async (_guild: any): Promise<void> => {};

    private runningBackups = new Set<string>();

    public messageBackup = async (guild_ids: string[]) => {
        for (const guild_id of guild_ids) {
            await this.backup(guild_id);
        }
        const scheduleNext = () => {
            setTimeout(async () => {
                for (const guild_id of guild_ids) {
                    await this.backup(guild_id);
                }
                scheduleNext();
            }, BACKUP_INTERVAL_MS);
        };
        scheduleNext();
    }

    // Collects all messageable channels and threads in a guild.
    // Returns the channels to backup and the full set of live channel IDs for stale-doc cleanup.
    private collectChannels = async (guild_id: string): Promise<{ channels: TextBasedChannel[], liveChannelIds: Set<string> }> => {
        const guild = this.guildInfo[guild_id].guild;
        await guild.channels.fetch();

        const channels: TextBasedChannel[] = [];
        const liveChannelIds = new Set<string>();
        const seen = new Set<string>();

        const addChannel = (ch: any) => {
            if (!ch || seen.has(ch.id)) return;
            if (typeof ch.type !== 'number' || !ALLOWED_CHANNEL_TYPES.has(ch.type)) return;
            seen.add(ch.id);
            liveChannelIds.add(ch.id);
            // Forum/media channels hold messages only via threads — skip direct message fetch
            if (ch.messages && typeof ch.messages.fetch === 'function') {
                channels.push(ch as TextBasedChannel);
            }
        };

        for (const channel of guild.channels.cache.values()) {
            addChannel(channel);

            const anyChannel = channel as any;
            if (!anyChannel.threads || typeof anyChannel.threads.fetchActive !== 'function') continue;

            try {
                const active = await retryFetch<any>(() => anyChannel.threads.fetchActive());
                active.threads.forEach((t: any) => addChannel(t));
            } catch (err) {
                logger.errorLogger(this.clientId, guild_id, `fetchActive threads failed for ${anyChannel.name || channel.id}: ${String(err)}`);
            }

            // fetchArchived is paginated — loop until exhausted for both public and private types
            // Public thread pagination requires a DateResolvable for `before`, not a snowflake
            for (const type of ['public', 'private'] as const) {
                try {
                    let before: Date | undefined;
                    while (true) {
                        const opts: any = { type, limit: 100, fetchAll: type === 'private' };
                        if (before) opts.before = before;
                        const archived = await retryFetch<any>(() => anyChannel.threads.fetchArchived(opts));
                        archived.threads.forEach((t: any) => {
                            addChannel(t);
                            const archivedAt: Date | null = t.archivedAt;
                            if (archivedAt && (!before || archivedAt < before)) before = archivedAt;
                        });
                        if (!archived.hasMore) break;
                    }
                } catch (err) {
                    logger.errorLogger(this.clientId, guild_id, `fetchArchived ${type} threads failed for ${anyChannel.name || channel.id}: ${String(err)}`);
                }
            }
        }

        return { channels, liveChannelIds };
    };

    public backup = async (guild_id: string) => {
        if (this.runningBackups.has(guild_id)) {
            logger.errorLogger(this.clientId, guild_id, 'Backup already running, skipping this tick');
            return;
        }
        this.runningBackups.add(guild_id);
        try {
            await this._backup(guild_id);
        } finally {
            this.runningBackups.delete(guild_id);
        }
    };

    private _backup = async (guild_id: string) => {
        const db = this.guildInfo[guild_id]?.db;
        if (!db) {
            logger.errorLogger(this.clientId, guild_id, 'Database not found');
            return;
        }

        const debugCh = this.guildInfo[guild_id]?.channels?.debug;
        if (!debugCh?.isSendable()) {
            logger.errorLogger(this.clientId, guild_id, 'Debug channel not sendable');
            return;
        }

        const logPath = path.join(process.cwd(), 'logs', `msg_archive_${guild_id}.log`);
        const log = new BackupLog(logPath);

        try {
            const startTime = Date.now();
            let newCount = 0;
            const existingCount = await db.models['Message'].countDocuments({});

            const statusMsg = await debugCh.send(
                `[ SYSTEM ] Backup started. DB contains ${existingCount} messages.`
            );

            const { channels, liveChannelIds } = await this.collectChannels(guild_id);

            // Write header
            log.writeln('=== MSG ARCHIVE BACKUP ===');
            log.writeln(`Guild:    ${guild_id}`);
            log.writeln(`Started:  ${new Date().toISOString()}`);
            log.writeln(`DB count: ${existingCount} messages`);
            log.writeln();

            // Write channel list
            log.writeln(`Channels/threads to backup (${channels.length} total):`);
            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i] as any;
                const idx = String(i + 1).padStart(3, '0');
                const name = (ch.name || '(no name)').padEnd(32);
                log.writeln(`  [${idx}] #${name} (id: ${ch.id})`);
            }
            log.writeln();

            // Process each channel
            const allStats: ChannelBackupStats[] = [];
            for (let i = 0; i < channels.length; i++) {
                const channel = channels[i];
                const { added, stats } = await this.backupChannel(channel, db, guild_id, async () => {
                    await statusMsg.edit(
                        `[ SYSTEM ] Backup in progress. DB now contains (${existingCount}+${newCount}) messages.`
                    ).catch(() => {});
                });
                newCount += added;
                allStats.push(stats);

                const idx = String(i + 1).padStart(3, '0');
                const label = `[${idx}] #${stats.channelName || stats.channelId} (${stats.channelId})`;
                log.writeln(`--- ${label} ---`);

                if (stats.mode === 'incremental') {
                    log.writeln(`Mode:       incremental (resume from ${stats.resumeFromMsgId})`);
                } else {
                    log.writeln('Mode:       full (initial backup)');
                }

                log.writeln(`Batches:    ${stats.batches}`);
                log.writeln(`Fetched:    ${stats.totalFetched}`);
                log.writeln(`Skipped:    ${stats.skippedBots} bots, ${stats.skippedDuplicates} duplicates`);
                log.writeln(`New in DB:  ${stats.newMessages}`);

                if (stats.startMsgId) {
                    const preview = (stats.startMsgContent || '').replace(/\n/g, ' ').slice(0, 80);
                    log.writeln(`From msg:   ${stats.startMsgId} — "${preview}"`);
                }
                if (stats.endMsgId) {
                    const preview = (stats.endMsgContent || '').replace(/\n/g, ' ').slice(0, 80);
                    log.writeln(`To msg:     ${stats.endMsgId} — "${preview}"`);
                }
                if (!stats.startMsgId && !stats.endMsgId) {
                    log.writeln('Messages:   (none fetched this run)');
                }

                log.writeln(`Duration:   ${(stats.durationMs / 1000).toFixed(1)}s`);

                if (stats.error) {
                    log.writeln(`ERROR:      ${stats.error}`);
                }

                log.writeln();
            }

            // Remove Fetch docs for channels that no longer exist in Discord
            const allFetchDocs = await db.models['Fetch'].find({}, { channelID: 1 });
            const deletedChannelIds: string[] = [];
            for (const doc of allFetchDocs) {
                if (liveChannelIds.has(doc.channelID)) continue;
                try {
                    await this.client.channels.fetch(doc.channelID, { force: true });
                } catch (err) {
                    // Only delete on Unknown Channel (10003) — ignore 403s and transient errors
                    if (err instanceof DiscordAPIError && err.code === 10003) {
                        await db.models['Fetch'].deleteOne({ channelID: doc.channelID });
                        deletedChannelIds.push(doc.channelID);
                    }
                }
            }

            const duration = (Date.now() - startTime) / 1000;
            const finalCount = await db.models['Message'].countDocuments({});

            // Write overview
            const totalFetched = allStats.reduce((s, x) => s + x.totalFetched, 0);
            const totalBots = allStats.reduce((s, x) => s + x.skippedBots, 0);
            const totalDupes = allStats.reduce((s, x) => s + x.skippedDuplicates, 0);
            const errorCount = allStats.filter(x => x.error).length;

            log.writeln('=== OVERVIEW ===');
            log.writeln(`Channels processed:     ${channels.length}`);
            log.writeln(`Total fetched:          ${totalFetched}`);
            log.writeln(`Skipped (bots):         ${totalBots}`);
            log.writeln(`Skipped (duplicates):   ${totalDupes}`);
            log.writeln(`New messages total:     ${newCount}`);
            log.writeln(`DB count before:        ${existingCount}`);
            log.writeln(`DB count after:         ${finalCount}`);
            log.writeln(`Stale channels removed: ${deletedChannelIds.length}`);
            if (errorCount > 0) log.writeln(`Channels with errors:   ${errorCount}`);
            log.writeln(`Total duration:         ${duration.toFixed(1)}s`);
            log.writeln(`Completed:              ${new Date().toISOString()}`);

            await statusMsg.edit(
                `[ SYSTEM ] Backup complete. DB now contains (${existingCount}+${newCount}) messages. (${duration.toFixed(1)}s)` +
                (deletedChannelIds.length > 0 ? ` Removed ${deletedChannelIds.length} stale channel record(s).` : '')
            );
        } catch (err) {
            logger.errorLogger(this.clientId, guild_id, err);
            log.writeln(`FATAL ERROR: ${String(err)}`);
        } finally {
            log.close();
        }
    };

    private backupChannel = async (
        channel: TextBasedChannel,
        db: any,
        guild_id: string,
        onProgress: () => Promise<void>
    ): Promise<{ added: number; stats: ChannelBackupStats }> => {
        const ch = channel as any;
        const startTime = Date.now();
        const stats: ChannelBackupStats = {
            channelId: ch.id,
            channelName: ch.name || '',
            mode: 'full',
            newMessages: 0,
            totalFetched: 0,
            skippedBots: 0,
            skippedDuplicates: 0,
            batches: 0,
            durationMs: 0,
        };

        try {
            let fetchRecord = await db.models['Fetch'].findOne({ channelID: ch.id });
            if (!fetchRecord) {
                fetchRecord = await db.models['Fetch'].create({
                    channel: ch.name || '',
                    channelID: ch.id,
                    lastMessageID: '',
                });
            }

            const lastMessageID: string = fetchRecord.lastMessageID || '';
            let latestMessageId: string | undefined;

            let globalOldest: { id: string; content: string } | undefined;
            let globalNewest: { id: string; content: string } | undefined;

            const updateGlobalBounds = (batch: ReturnType<typeof this.saveBatch> extends Promise<infer T> ? T : never) => {
                if (batch.oldestMsg) {
                    if (!globalOldest || BigInt(batch.oldestMsg.id) < BigInt(globalOldest.id))
                        globalOldest = batch.oldestMsg;
                }
                if (batch.newestMsg) {
                    if (!globalNewest || BigInt(batch.newestMsg.id) > BigInt(globalNewest.id))
                        globalNewest = batch.newestMsg;
                }
            };

            if (lastMessageID) {
                stats.mode = 'incremental';
                stats.resumeFromMsgId = lastMessageID;
                let cursor = lastMessageID;
                while (true) {
                    const fetched = await retryFetch<any>(() => ch.messages.fetch({ limit: 100, after: cursor }));
                    if (fetched.size === 0) break;

                    const batch = await this.saveBatch(fetched, ch, db);
                    stats.batches++;
                    stats.totalFetched += fetched.size;
                    stats.newMessages += batch.inserted;
                    stats.skippedBots += batch.skippedBots;
                    stats.skippedDuplicates += batch.skippedDuplicates;
                    updateGlobalBounds(batch);

                    if (batch.inserted > 0) await onProgress();

                    if (batch.newestId) {
                        latestMessageId = batch.newestId;
                        cursor = batch.newestId;
                    }

                    if (fetched.size < 100) break;
                }
            } else {
                let cursor: string | undefined;
                while (true) {
                    const opts: any = { limit: 100 };
                    if (cursor) opts.before = cursor;

                    const fetched = await retryFetch<any>(() => ch.messages.fetch(opts));
                    if (fetched.size === 0) break;

                    const batch = await this.saveBatch(fetched, ch, db);
                    stats.batches++;
                    stats.totalFetched += fetched.size;
                    stats.newMessages += batch.inserted;
                    stats.skippedBots += batch.skippedBots;
                    stats.skippedDuplicates += batch.skippedDuplicates;
                    updateGlobalBounds(batch);

                    if (batch.inserted > 0) await onProgress();

                    if (!latestMessageId && batch.newestId) latestMessageId = batch.newestId;
                    if (batch.oldestId) cursor = batch.oldestId;

                    if (fetched.size < 100) break;
                }
            }

            if (latestMessageId) {
                await db.models['Fetch'].findOneAndUpdate(
                    { channelID: ch.id },
                    { channel: ch.name || '', lastMessageID: latestMessageId },
                    { upsert: true }
                );
            }

            stats.startMsgId = globalOldest?.id;
            stats.startMsgContent = globalOldest?.content;
            stats.endMsgId = globalNewest?.id;
            stats.endMsgContent = globalNewest?.content;
        } catch (err) {
            stats.error = String(err);
            logger.errorLogger(this.clientId, guild_id, `Failed to backup channel ${ch.name || ch.id}: ${String(err)}`);
        }

        stats.durationMs = Date.now() - startTime;
        return { added: stats.newMessages, stats };
    };

    private saveBatch = async (
        fetched: any,
        ch: any,
        db: any
    ): Promise<{
        inserted: number;
        skippedBots: number;
        skippedDuplicates: number;
        oldestId?: string;
        newestId?: string;
        oldestMsg?: { id: string; content: string };
        newestMsg?: { id: string; content: string };
    }> => {
        const ids: string[] = [];
        let oldestId: string | undefined;
        let newestId: string | undefined;

        for (const msg of fetched.values()) {
            ids.push((msg as any).id);
            const id = (msg as any).id;
            if (!oldestId || BigInt(id) < BigInt(oldestId)) oldestId = id;
            if (!newestId || BigInt(id) > BigInt(newestId)) newestId = id;
        }

        const existingDocs = await db.models['Message'].find(
            { messageId: { $in: ids } },
            { messageId: 1 }
        );
        const existingSet = new Set<string>(existingDocs.map((d: any) => d.messageId));

        let skippedBots = 0;
        let skippedDuplicates = 0;
        let oldestMsg: { id: string; content: string } | undefined;
        let newestMsg: { id: string; content: string } | undefined;

        const toInsert: any[] = [];
        for (const msg of fetched.values() as any) {
            if (msg.author?.bot) { skippedBots++; continue; }
            if (existingSet.has(msg.id)) { skippedDuplicates++; continue; }

            const content: string = msg.content || '';
            if (!oldestMsg || BigInt(msg.id) < BigInt(oldestMsg.id)) oldestMsg = { id: msg.id, content };
            if (!newestMsg || BigInt(msg.id) > BigInt(newestMsg.id)) newestMsg = { id: msg.id, content };

            toInsert.push({
                channelId: ch.id,
                channelName: ch.name || '',
                content,
                messageId: msg.id,
                userId: msg.author.id,
                userName: msg.author.username,
                attachments: msg.attachments.map((a: any) => ({
                    id: a.id,
                    name: a.name,
                    url: a.url,
                    contentType: a.contentType,
                })),
                reactions: msg.reactions.cache.map((r: any) => ({
                    id: r.emoji.id,
                    name: r.emoji.name,
                    animated: r.emoji.animated,
                    count: r.count,
                    userIds: r.users.cache.map((u: any) => u.id),
                })),
                stickers: msg.stickers.map((s: any) => ({ id: s.id, name: s.name })),
                timestamp: msg.createdTimestamp,
            });
        }

        if (toInsert.length === 0) return { inserted: 0, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };

        let inserted = 0;
        try {
            const result = await db.models['Message'].insertMany(toInsert, { ordered: false });
            inserted = Array.isArray(result) ? result.length : toInsert.length;
        } catch (err: any) {
            if (err.code === 11000 || err.name === 'BulkWriteError') {
                inserted = err.insertedCount ?? 0;
            } else {
                throw err;
            }
        }

        return { inserted, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };
    };
}
