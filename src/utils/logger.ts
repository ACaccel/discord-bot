/**
 * @deprecated Backward-compatibility shim over `src/core/logger`.
 *
 * Every legacy callsite (`logger.systemLogger`, `logger.errorLogger`,
 * `logger.guildLogger`) goes through this module. Internally, the
 * functions delegate to a process-wide structured logger:
 *
 *   - On first use, a default logger is built from `process.env.LOG_LEVEL`
 *     / `process.env.NODE_ENV` via `createLoggerFromProcessEnv`. This
 *     covers the chicken-and-egg case where handlers import this module
 *     at boot before BaseBot has had a chance to install a richer one.
 *   - {@link initLegacyLogger} replaces the default with the bot-scoped
 *     child logger created in `BaseBot.run()`. Called exactly once per
 *     bot process; subsequent calls log a warning and no-op.
 *
 * `attachmentLogger` and `channelLogger` retain their I/O behaviour
 * (file write / Discord channel send) but route their internal error
 * fallbacks through the structured logger.
 *
 * Removed in Phase 6 when every callsite has migrated to either the
 * IoC-resolved logger or a domain-error throw.
 */
import type { Attachment, Channel, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { createLoggerFromProcessEnv, type Logger } from '../core/logger';

let current: Logger | undefined;

const getLogger = (): Logger => {
  if (current === undefined) {
    current = createLoggerFromProcessEnv({ scope: 'legacy' });
  }
  return current;
};

/**
 * Replace the lazy default logger with one already scoped to the
 * running bot (typically `rootLogger.child({ bot: clientId })`). Call
 * from `BaseBot.run()` after the IoC container has built its own
 * Logger singleton.
 */
export const initLegacyLogger = (logger: Logger): void => {
  if (current !== undefined) {
    current.warn({ scope: 'legacy' }, 'initLegacyLogger called twice; ignoring later call');
    return;
  }
  current = logger;
};

const getDate = () => {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) + ' ';
};

/**
 * (test) save deleted attachments
 */
export const attachmentLogger = async (guild_id: string, attachment: Attachment) => {
  try {
    // Define the path where the attachment will be saved
    const filePath = `./data/deleted_attachments/${guild_id}/${getDate().replaceAll('/', '_').replaceAll(':', '_')}${attachment.name}`;

    // Ensure the directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Fetch the attachment data and save it to the file
    let response;
    try {
      response = await axios.get(attachment.url, { responseType: 'stream' });
    } catch (err: unknown) {
      getLogger().warn(
        {
          err: err instanceof Error ? err : new Error(String(err)),
          guild_id,
          name: attachment.name,
        },
        'attachmentLogger: failed to fetch attachment',
      );
      return;
    }

    // Save the file
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    // Wait for the file to finish saving
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', reject);
    });
  } catch (e: unknown) {
    getLogger().error(
      { err: e instanceof Error ? e : new Error(String(e)), guild_id },
      'attachmentLogger: write failed',
    );
  }
};

/**
 * Log channel events as embedded message to guild's channel.
 */
export const channelLogger = async (
  channel: Channel | undefined,
  embed?: EmbedBuilder,
  log?: string,
) => {
  try {
    if (!channel) return;
    if (!channel.isSendable()) return;

    if (log) {
      await channel.send(log);
    }
    if (embed) {
      await channel.send({ embeds: [embed] });
    }
  } catch (e: unknown) {
    getLogger().error(
      { err: e instanceof Error ? e : new Error(String(e)) },
      'channelLogger: send failed',
    );
  }
};

/**
 * Log guild events as a single structured line. Backwards-compatible
 * positional signature; internally emits a pino line plus the legacy
 * file-backup for now (callers that grep the log files still work).
 */
export const guildLogger = (
  bot_id: string,
  guild_id: string,
  event_type: string,
  msg: string,
  guild_name: string,
) => {
  try {
    const flat = msg.replaceAll('\n', '\\n');
    getLogger()
      .child({ bot: bot_id, guildId: guild_id, guildName: guild_name })
      .info({ eventType: event_type.toUpperCase(), msg: flat }, 'guild event');
    logBackup(`[${event_type.toUpperCase()}] <${guild_name}> - ${flat}`, bot_id, guild_id, 'logs');
  } catch (e: unknown) {
    getLogger().error(
      { err: e instanceof Error ? e : new Error(String(e)), bot_id, guild_id },
      'guildLogger: failed',
    );
  }
};

/**
 * Log system information. Replaces the legacy console.log + file
 * backup. The file write is retained for parity until Phase 6.
 */
export const systemLogger = (bot_id: string, msg: string) => {
  try {
    getLogger().child({ bot: bot_id }).info({ msg }, 'system');
    logBackup(`[SYSTEM] ${msg}`, bot_id, '', 'logs');
  } catch (e: unknown) {
    getLogger().error(
      { err: e instanceof Error ? e : new Error(String(e)), bot_id },
      'systemLogger: failed',
    );
  }
};

/**
 * Log an unexpected error. `msg` may be a DomainError instance, a
 * native Error, or any thrown value — the pino serialiser preserves
 * stack + cause for Error subclasses.
 *
 * guild_id = '' if no guild specified
 */
export const errorLogger = (bot_id: string, guild_id: string | undefined | null, msg: unknown) => {
  try {
    const gid = guild_id ?? '';
    const child =
      gid === ''
        ? getLogger().child({ bot: bot_id })
        : getLogger().child({ bot: bot_id, guildId: gid });
    if (msg instanceof Error) {
      child.error({ err: msg }, 'errorLogger');
    } else {
      child.error({ raw: msg }, 'errorLogger');
    }
    logBackup(msg, bot_id, gid, 'errors');
  } catch (e: unknown) {
    // Last-resort: structured logger itself failed. Drop on the floor
    // rather than introduce a console fallback that bypasses the
    // redactor. Phase 6 will replace this whole shim.
    void e;
  }
};

/**
 * Backup logs to file under *log_type* folder.
 * @deprecated File-backup retained until Phase 6 for parity with the
 *   pre-refactor logging directory layout. Wrapped here so the
 *   structured logger does not silently break ops dashboards that grep
 *   `./logs/<bot>/<date>.log`.
 */
const logBackup = (msg: unknown, bot_id: string, guild_id: string, log_type: string) => {
  try {
    // create a new file every day
    let p = '';
    if (guild_id === '') {
      p = `./${log_type}/${bot_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }).replaceAll('/', '_')}.log`;
      if (!fs.existsSync(p)) {
        if (!fs.existsSync(`./${log_type}/${bot_id}`)) {
          fs.mkdirSync(`./${log_type}/${bot_id}`, { recursive: true });
        }
        fs.writeFileSync(p, '');
      }
    } else {
      p = `./${log_type}/${bot_id}/${guild_id}/${new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }).replaceAll('/', '_')}.log`;
      if (!fs.existsSync(p)) {
        if (!fs.existsSync(`./${log_type}/${bot_id}/${guild_id}`)) {
          fs.mkdirSync(`./${log_type}/${bot_id}/${guild_id}`, { recursive: true });
        }
        fs.writeFileSync(p, '');
      }
    }

    fs.appendFileSync(p, getDate() + String(msg) + '\n');
  } catch (e: unknown) {
    // Last-resort: drop on the floor. The structured logger above
    // remains responsible for surfacing the parent error; the
    // file-backup is a parity-only convenience until Phase 6.
    void e;
  }
};
