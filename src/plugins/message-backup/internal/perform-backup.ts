/**
 * One per-guild backup pass: collect channels, run `backupChannel` for
 * each, write the per-guild transcript, sweep stale Fetch docs.
 *
 * Errors at this level fall into a `try / catch / finally`: the catch
 * arm writes a FATAL line to the log + emits a structured error; the
 * finally closes the log file so a partial run still leaves a usable
 * artifact.
 */
import { type Client, DiscordAPIError } from 'discord.js';

import type { GuildRegistry } from '../../../core/guild-registry';
import { logError, type Logger } from '../../../core/logger';
import { BackupLog, NullBackupLog, type BackupTranscript } from './backup-log';
import { buildBackupLogPath } from './log-path';
import { backupChannel, type ChannelBackupStats } from './backup-channel';
import { collectChannels } from './collect-channels';

export const performBackup = async (
  guildId: string,
  registry: GuildRegistry,
  client: Client,
  pluginLogger: Logger,
  writeTranscript: boolean,
): Promise<void> => {
  const guild = client.guilds.cache.get(guildId);
  if (guild === undefined) {
    pluginLogger.warn({ guildId }, 'message-backup: guild not in cache');
    return;
  }
  const repos = registry.getRepos(guildId);
  if (repos === undefined) {
    logError(pluginLogger, guildId, 'Repos not available for guild');
    return;
  }

  const debugCh = registry.getChannel(guildId, 'debug');
  if (debugCh === undefined || !debugCh.isSendable()) {
    logError(pluginLogger, guildId, 'Debug channel not sendable');
    return;
  }

  // Transcript logging is opt-in: when disabled, a Null Object swallows every
  // `writeln` so the backup runs identically but writes no `logs/backup/` file.
  const log: BackupTranscript = writeTranscript
    ? new BackupLog(buildBackupLogPath(guildId, new Date()))
    : new NullBackupLog();

  try {
    const startTime = Date.now();
    let newCount = 0;
    // Repo methods return Result<T, DatabaseError>. An `err` is
    // re-thrown so the surrounding catch writes the FATAL log line.
    const existingCountResult = await repos.message.countAll();
    if (!existingCountResult.ok) throw existingCountResult.error;
    const existingCount = existingCountResult.value;

    const statusMsg = await debugCh.send(
      `[ SYSTEM ] Backup started. DB contains ${existingCount} messages.`,
    );

    const { channels, liveChannelIds } = await collectChannels(guild, pluginLogger);

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
      const { added, stats } = await backupChannel(
        channel,
        repos,
        guildId,
        pluginLogger,
        async () => {
          await statusMsg
            .edit(
              `[ SYSTEM ] Backup in progress. DB now contains (${existingCount}+${newCount}) messages.`,
            )
            .catch(() => undefined);
        },
      );
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

    const fetchChannelIdsResult = await repos.fetch.listChannelIds();
    if (!fetchChannelIdsResult.ok) throw fetchChannelIdsResult.error;
    const allFetchChannelIds = fetchChannelIdsResult.value;
    const deletedChannelIds: string[] = [];
    for (const channelID of allFetchChannelIds) {
      if (liveChannelIds.has(channelID)) continue;
      try {
        await client.channels.fetch(channelID, { force: true });
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 10003) {
          const deleteResult = await repos.fetch.deleteByChannelId(channelID);
          if (!deleteResult.ok) throw deleteResult.error;
          deletedChannelIds.push(channelID);
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    const finalCountResult = await repos.message.countAll();
    if (!finalCountResult.ok) throw finalCountResult.error;
    const finalCount = finalCountResult.value;
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
    logError(pluginLogger, guildId, err);
    log.writeln(`FATAL ERROR: ${String(err)}`);
  } finally {
    log.close();
  }
};
