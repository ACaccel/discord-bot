/**
 * MessageBackupPlugin — periodic per-guild message backup, ported
 * from `src/bot/msg-archive/msg-archive.ts`.
 *
 * The plugin owns the full backup logic that used to live on the
 * `MsgArchive` BaseBot subclass. `MsgArchive` shrinks to a composition
 * root that registers this plugin; behaviour (channel fetch, retry,
 * pagination, log file format, stale-Fetch-doc cleanup) is preserved
 * verbatim.
 *
 * Wiring:
 *   - Reads `backupServers` config — the list of guild ids the bot
 *     should back up.
 *   - Resolves `GuildRegistry` for per-guild `repos` / `channels` /
 *     `guild` access and `DiscordClient` for `channels.fetch` on
 *     stale-doc verification.
 *   - Schedules itself on `onReady` (one-shot per guild then a
 *     1-hour repeat loop). `onShutdown` clears the loop so a fast
 *     restart does not double-trigger.
 *
 * Why bot-scope rather than guild-scope: backup batches all
 * configured guilds in series to keep request-rate predictable.
 * A guild-scoped variant would race against itself on the Mongo
 * connection pool and would not match the legacy timing contract.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ChannelType,
  type Client,
  DiscordAPIError,
  type Guild,
  type TextBasedChannel,
} from 'discord.js';

import type { GuildRegistry } from '../../core/guild-registry';
import { TOKENS } from '../../core/ioc';
import type { Logger } from '../../core/logger';
import type { Plugin } from '../../core/plugin';
import type { MessageRepo, Repos } from '../../persistence/repositories';
import type { MessageDoc } from '../../persistence/schemas/message.schema';
import * as legacyLogger from '../../utils/logger';

const PLUGIN_ID = 'message-backup';
const PLUGIN_VERSION = '1.0.0';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface MessageBackupPluginConfig {
  readonly backupServers: readonly string[];
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
  private readonly fd: number;
  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, 'w');
  }
  writeln(line = ''): void {
    fs.writeSync(this.fd, line + '\n');
  }
  close(): void {
    fs.closeSync(this.fd);
  }
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

// HTTP 5xx / 429 + transient network errors are worth retrying;
// anything else (4xx, Unknown Channel, validation) is permanent.
const isRetryableError = (err: unknown): boolean => {
  if (err === null || err === undefined) return false;
  const anyErr = err as { status?: number; httpStatus?: number; name?: string; code?: string };
  const status = anyErr.status ?? anyErr.httpStatus;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  if (
    anyErr.name === 'ConnectTimeoutError' ||
    anyErr.name === 'AbortError' ||
    anyErr.name === 'FetchError'
  ) {
    return true;
  }
  const code = anyErr.code;
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return true;
  }
  const msg = String(err);
  return msg.includes('ConnectTimeoutError') || msg.includes('Service Unavailable');
};

const retryFetch = async <T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> => {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === maxAttempts) throw err;
      // Jitter prevents many parallel channel backups retrying in lockstep.
      const jittered = delay * (0.5 + Math.random());
      await new Promise<void>((resolve) => setTimeout(resolve, jittered));
      delay *= 2;
    }
  }
  throw new Error('unreachable');
};

const collectChannels = async (
  guild: Guild,
  clientId: string,
): Promise<{ channels: TextBasedChannel[]; liveChannelIds: Set<string> }> => {
  await guild.channels.fetch();
  const channels: TextBasedChannel[] = [];
  const liveChannelIds = new Set<string>();
  const seen = new Set<string>();

  const addChannel = (ch: unknown): void => {
    const anyCh = ch as { id?: string; type?: number; messages?: { fetch?: unknown } };
    if (anyCh === null || anyCh === undefined) return;
    if (anyCh.id === undefined || seen.has(anyCh.id)) return;
    if (typeof anyCh.type !== 'number' || !ALLOWED_CHANNEL_TYPES.has(anyCh.type)) return;
    seen.add(anyCh.id);
    liveChannelIds.add(anyCh.id);
    if (anyCh.messages !== undefined && typeof anyCh.messages.fetch === 'function') {
      channels.push(ch as TextBasedChannel);
    }
  };

  for (const channel of guild.channels.cache.values()) {
    addChannel(channel);
    const anyChannel = channel as unknown as {
      threads?: {
        fetchActive?: () => Promise<{ threads: Map<string, unknown> }>;
        fetchArchived?: (opts: unknown) => Promise<{
          threads: Map<string, { archivedAt: Date | null }>;
          hasMore: boolean;
        }>;
      };
      name?: string;
    };
    if (anyChannel.threads === undefined || typeof anyChannel.threads.fetchActive !== 'function') {
      continue;
    }
    try {
      const active = await retryFetch(() => anyChannel.threads!.fetchActive!());
      active.threads.forEach((t) => addChannel(t));
    } catch (err) {
      legacyLogger.errorLogger(
        clientId,
        guild.id,
        `fetchActive threads failed for ${anyChannel.name ?? channel.id}: ${String(err)}`,
      );
    }
    for (const type of ['public', 'private'] as const) {
      try {
        let before: Date | undefined;
        // fetchArchived is paginated — drain both visibility classes.
        for (;;) {
          const opts: { type: 'public' | 'private'; limit: number; fetchAll: boolean; before?: Date } = {
            type,
            limit: 100,
            fetchAll: type === 'private',
          };
          if (before !== undefined) opts.before = before;
          const archived = await retryFetch(() => anyChannel.threads!.fetchArchived!(opts));
          archived.threads.forEach((t) => {
            addChannel(t);
            const archivedAt = (t as { archivedAt: Date | null }).archivedAt;
            if (archivedAt !== null && (before === undefined || archivedAt < before)) {
              before = archivedAt;
            }
          });
          if (!archived.hasMore) break;
        }
      } catch (err) {
        legacyLogger.errorLogger(
          clientId,
          guild.id,
          `fetchArchived ${type} threads failed for ${anyChannel.name ?? channel.id}: ${String(err)}`,
        );
      }
    }
  }
  return { channels, liveChannelIds };
};

interface BatchResult {
  inserted: number;
  skippedBots: number;
  skippedDuplicates: number;
  oldestId?: string;
  newestId?: string;
  oldestMsg?: { id: string; content: string };
  newestMsg?: { id: string; content: string };
}

const saveBatch = async (
  fetched: { values: () => Iterable<unknown> },
  ch: { id: string; name?: string },
  messageRepo: MessageRepo,
): Promise<BatchResult> => {
  const messages = [...fetched.values()] as Array<{
    id: string;
    author?: { bot?: boolean; id: string; username: string };
    content?: string;
    attachments: Map<string, { id: string; name: string; url: string; contentType?: string | null }>;
    reactions: {
      cache: Map<
        string,
        { emoji: { id?: string; name?: string; animated?: boolean }; count: number; users: { cache: Map<string, unknown> } }
      >;
    };
    stickers: Map<string, { id: string; name: string }>;
    createdTimestamp: number;
  }>;

  const ids: string[] = [];
  let oldestId: string | undefined;
  let newestId: string | undefined;
  for (const msg of messages) {
    ids.push(msg.id);
    if (oldestId === undefined || BigInt(msg.id) < BigInt(oldestId)) oldestId = msg.id;
    if (newestId === undefined || BigInt(msg.id) > BigInt(newestId)) newestId = msg.id;
  }

  const existingSet = await messageRepo.findExistingMessageIds(ids);

  let skippedBots = 0;
  let skippedDuplicates = 0;
  let oldestMsg: { id: string; content: string } | undefined;
  let newestMsg: { id: string; content: string } | undefined;
  const toInsert: unknown[] = [];

  for (const msg of messages) {
    if (msg.author?.bot === true) {
      skippedBots += 1;
      continue;
    }
    if (existingSet.has(msg.id)) {
      skippedDuplicates += 1;
      continue;
    }
    const content = msg.content ?? '';
    if (oldestMsg === undefined || BigInt(msg.id) < BigInt(oldestMsg.id)) {
      oldestMsg = { id: msg.id, content };
    }
    if (newestMsg === undefined || BigInt(msg.id) > BigInt(newestMsg.id)) {
      newestMsg = { id: msg.id, content };
    }
    toInsert.push({
      channelId: ch.id,
      channelName: ch.name ?? '',
      content,
      messageId: msg.id,
      userId: msg.author!.id,
      userName: msg.author!.username,
      attachments: [...msg.attachments.values()].map((a) => ({
        id: a.id,
        name: a.name,
        url: a.url,
        contentType: a.contentType,
      })),
      reactions: [...msg.reactions.cache.values()].map((r) => ({
        id: r.emoji.id,
        name: r.emoji.name,
        animated: r.emoji.animated,
        count: r.count,
        userIds: [...r.users.cache.keys()],
      })),
      stickers: [...msg.stickers.values()].map((s) => ({ id: s.id, name: s.name })),
      timestamp: msg.createdTimestamp,
    });
  }

  if (toInsert.length === 0) {
    return { inserted: 0, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };
  }

  // `insertManyIgnoringDuplicates` already converts BulkWriteError on
  // duplicate-key into a partial-success count (see message.repo.ts);
  // no try/catch needed here. Cast: `toInsert` is structurally a
  // MessageDoc minus the readonly `_id` (Mongo generates it on write).
  const { inserted } = await messageRepo.insertManyIgnoringDuplicates(
    toInsert as unknown as readonly MessageDoc[],
  );
  return { inserted, skippedBots, skippedDuplicates, oldestId, newestId, oldestMsg, newestMsg };
};

const backupChannel = async (
  channel: TextBasedChannel,
  repos: Repos,
  guildId: string,
  clientId: string,
  onProgress: () => Promise<void>,
): Promise<{ added: number; stats: ChannelBackupStats }> => {
  type FetchOpts = { limit: number; before?: string; after?: string };
  type FetchResult = { size: number; values(): Iterable<unknown> };
  const ch = channel as unknown as {
    id: string;
    name?: string;
    messages: { fetch: (opts: FetchOpts) => Promise<FetchResult> };
  };
  const startTime = Date.now();
  const stats: ChannelBackupStats = {
    channelId: ch.id,
    channelName: ch.name ?? '',
    mode: 'full',
    newMessages: 0,
    totalFetched: 0,
    skippedBots: 0,
    skippedDuplicates: 0,
    batches: 0,
    durationMs: 0,
  };

  try {
    let fetchRecord = await repos.fetch.findByChannelId(ch.id);
    if (fetchRecord === undefined) {
      fetchRecord = await repos.fetch.create(ch.name ?? '', ch.id, '');
    }
    const lastMessageID = fetchRecord.lastMessageID ?? '';
    let latestMessageId: string | undefined;
    let globalOldest: { id: string; content: string } | undefined;
    let globalNewest: { id: string; content: string } | undefined;

    const updateGlobalBounds = (batch: BatchResult): void => {
      if (batch.oldestMsg !== undefined) {
        if (globalOldest === undefined || BigInt(batch.oldestMsg.id) < BigInt(globalOldest.id)) {
          globalOldest = batch.oldestMsg;
        }
      }
      if (batch.newestMsg !== undefined) {
        if (globalNewest === undefined || BigInt(batch.newestMsg.id) > BigInt(globalNewest.id)) {
          globalNewest = batch.newestMsg;
        }
      }
    };

    if (lastMessageID.length > 0) {
      stats.mode = 'incremental';
      stats.resumeFromMsgId = lastMessageID;
      let cursor = lastMessageID;
      for (;;) {
        const fetched = await retryFetch(() =>
          ch.messages.fetch({ limit: 100, after: cursor }),
        );
        if (fetched.size === 0) break;
        const batch = await saveBatch(fetched, ch, repos.message);
        stats.batches += 1;
        stats.totalFetched += fetched.size;
        stats.newMessages += batch.inserted;
        stats.skippedBots += batch.skippedBots;
        stats.skippedDuplicates += batch.skippedDuplicates;
        updateGlobalBounds(batch);
        if (batch.inserted > 0) await onProgress();
        if (batch.newestId !== undefined) {
          latestMessageId = batch.newestId;
          cursor = batch.newestId;
        }
        if (fetched.size < 100) break;
      }
    } else {
      let cursor: string | undefined;
      for (;;) {
        const opts: { limit: number; before?: string } = { limit: 100 };
        if (cursor !== undefined) opts.before = cursor;
        const fetched = await retryFetch(() => ch.messages.fetch(opts));
        if (fetched.size === 0) break;
        const batch = await saveBatch(fetched, ch, repos.message);
        stats.batches += 1;
        stats.totalFetched += fetched.size;
        stats.newMessages += batch.inserted;
        stats.skippedBots += batch.skippedBots;
        stats.skippedDuplicates += batch.skippedDuplicates;
        updateGlobalBounds(batch);
        if (batch.inserted > 0) await onProgress();
        if (latestMessageId === undefined && batch.newestId !== undefined) {
          latestMessageId = batch.newestId;
        }
        if (batch.oldestId !== undefined) cursor = batch.oldestId;
        if (fetched.size < 100) break;
      }
    }

    if (latestMessageId !== undefined) {
      await repos.fetch.upsertLastMessageID(ch.name ?? '', ch.id, latestMessageId);
    }
    stats.startMsgId = globalOldest?.id;
    stats.startMsgContent = globalOldest?.content;
    stats.endMsgId = globalNewest?.id;
    stats.endMsgContent = globalNewest?.content;
  } catch (err: unknown) {
    stats.error = String(err);
    legacyLogger.errorLogger(
      clientId,
      guildId,
      `Failed to backup channel ${ch.name ?? ch.id}: ${String(err)}`,
    );
  }
  stats.durationMs = Date.now() - startTime;
  return { added: stats.newMessages, stats };
};

const performBackup = async (
  guildId: string,
  registry: GuildRegistry,
  client: Client,
  clientId: string,
  pluginLogger: Logger,
): Promise<void> => {
  const guild = client.guilds.cache.get(guildId);
  if (guild === undefined) {
    pluginLogger.warn({ guildId }, 'message-backup: guild not in cache');
    return;
  }
  const repos = registry.getRepos(guildId);
  if (repos === undefined) {
    legacyLogger.errorLogger(clientId, guildId, 'Repos not available for guild');
    return;
  }

  const debugCh = registry.getChannel(guildId, 'debug');
  if (debugCh === undefined || !debugCh.isSendable()) {
    legacyLogger.errorLogger(clientId, guildId, 'Debug channel not sendable');
    return;
  }

  const logPath = path.join(process.cwd(), 'logs', `msg-archive-${guildId}.log`);
  const log = new BackupLog(logPath);

  try {
    const startTime = Date.now();
    let newCount = 0;
    const existingCount = await repos.message.countAll();

    const statusMsg = await debugCh.send(
      `[ SYSTEM ] Backup started. DB contains ${existingCount} messages.`,
    );

    const { channels, liveChannelIds } = await collectChannels(guild, clientId);

    log.writeln('=== MSG ARCHIVE BACKUP ===');
    log.writeln(`Guild:    ${guildId}`);
    log.writeln(`Started:  ${new Date().toISOString()}`);
    log.writeln(`DB count: ${existingCount} messages`);
    log.writeln();
    log.writeln(`Channels/threads to backup (${channels.length} total):`);
    for (let i = 0; i < channels.length; i += 1) {
      const ch = channels[i] as unknown as { id: string; name?: string };
      const idx = String(i + 1).padStart(3, '0');
      const name = (ch.name ?? '(no name)').padEnd(32);
      log.writeln(`  [${idx}] #${name} (id: ${ch.id})`);
    }
    log.writeln();

    const allStats: ChannelBackupStats[] = [];
    for (let i = 0; i < channels.length; i += 1) {
      const channel = channels[i]!;
      const { added, stats } = await backupChannel(channel, repos, guildId, clientId, async () => {
        await statusMsg
          .edit(
            `[ SYSTEM ] Backup in progress. DB now contains (${existingCount}+${newCount}) messages.`,
          )
          .catch(() => undefined);
      });
      newCount += added;
      allStats.push(stats);

      const idx = String(i + 1).padStart(3, '0');
      const label = `[${idx}] #${stats.channelName.length > 0 ? stats.channelName : stats.channelId} (${stats.channelId})`;
      log.writeln(`--- ${label} ---`);
      if (stats.mode === 'incremental') {
        log.writeln(`Mode:       incremental (resume from ${stats.resumeFromMsgId ?? ''})`);
      } else {
        log.writeln('Mode:       full (initial backup)');
      }
      log.writeln(`Batches:    ${stats.batches}`);
      log.writeln(`Fetched:    ${stats.totalFetched}`);
      log.writeln(`Skipped:    ${stats.skippedBots} bots, ${stats.skippedDuplicates} duplicates`);
      log.writeln(`New in DB:  ${stats.newMessages}`);
      if (stats.startMsgId !== undefined) {
        const preview = (stats.startMsgContent ?? '').replace(/\n/g, ' ').slice(0, 80);
        log.writeln(`From msg:   ${stats.startMsgId} — "${preview}"`);
      }
      if (stats.endMsgId !== undefined) {
        const preview = (stats.endMsgContent ?? '').replace(/\n/g, ' ').slice(0, 80);
        log.writeln(`To msg:     ${stats.endMsgId} — "${preview}"`);
      }
      if (stats.startMsgId === undefined && stats.endMsgId === undefined) {
        log.writeln('Messages:   (none fetched this run)');
      }
      log.writeln(`Duration:   ${(stats.durationMs / 1000).toFixed(1)}s`);
      if (stats.error !== undefined) {
        log.writeln(`ERROR:      ${stats.error}`);
      }
      log.writeln();
    }

    const allFetchChannelIds = await repos.fetch.listChannelIds();
    const deletedChannelIds: string[] = [];
    for (const channelID of allFetchChannelIds) {
      if (liveChannelIds.has(channelID)) continue;
      try {
        await client.channels.fetch(channelID, { force: true });
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 10003) {
          await repos.fetch.deleteByChannelId(channelID);
          deletedChannelIds.push(channelID);
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    const finalCount = await repos.message.countAll();
    const totalFetched = allStats.reduce((s, x) => s + x.totalFetched, 0);
    const totalBots = allStats.reduce((s, x) => s + x.skippedBots, 0);
    const totalDupes = allStats.reduce((s, x) => s + x.skippedDuplicates, 0);
    const errorCount = allStats.filter((x) => x.error !== undefined).length;

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
        (deletedChannelIds.length > 0
          ? ` Removed ${deletedChannelIds.length} stale channel record(s).`
          : ''),
    );
  } catch (err: unknown) {
    legacyLogger.errorLogger(clientId, guildId, err);
    log.writeln(`FATAL ERROR: ${String(err)}`);
  } finally {
    log.close();
  }
};

export const createMessageBackupPlugin = (
  rawConfig: MessageBackupPluginConfig,
): Plugin => {
  const config: MessageBackupPluginConfig = {
    backupServers: [...rawConfig.backupServers],
  };
  const running = new Set<string>();
  let loopHandle: NodeJS.Timeout | undefined;
  let stopped = false;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    async onReady(ctx): Promise<void> {
      const registry = ctx.resolve(TOKENS.GuildRegistry);
      const client = ctx.resolve(TOKENS.DiscordClient);
      const clientId = client.user?.id ?? 'unknown';

      const runOnce = async (): Promise<void> => {
        for (const guildId of config.backupServers) {
          if (running.has(guildId)) {
            legacyLogger.errorLogger(
              clientId,
              guildId,
              'Backup already running, skipping this tick',
            );
            continue;
          }
          running.add(guildId);
          try {
            await performBackup(guildId, registry, client, clientId, ctx.logger);
          } finally {
            running.delete(guildId);
          }
        }
      };

      await runOnce();
      const scheduleNext = (): void => {
        if (stopped) return;
        loopHandle = setTimeout(async () => {
          await runOnce();
          scheduleNext();
        }, BACKUP_INTERVAL_MS);
      };
      scheduleNext();
    },

    async onShutdown(): Promise<void> {
      stopped = true;
      if (loopHandle !== undefined) {
        clearTimeout(loopHandle);
        loopHandle = undefined;
      }
    },
  };
};
