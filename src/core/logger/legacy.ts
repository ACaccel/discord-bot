/**
 * Handler-facing logger helpers — the post-PR-F2 home for the positional-args
 * `(clientId, guildId, err)` shape that handler / plugin / event callsites
 * grew up calling. Replaces the long-deprecated `src/utils/logger.ts` shim
 * (PR-E retired the file-backup leg; PR-F2 collapses everything into pure
 * `core/logger` `child().error()` / `child().info()` lines).
 *
 * These functions are **not** deprecated — they are the canonical handler-side
 * facade over the structured `Logger`. The shape exists because:
 *   - handler callsites pre-date constructor-injected loggers
 *   - the bot scope (`{ bot: clientId }`) + guild scope (`{ guildId }`)
 *     bindings are the same on every line, so pre-composing them at the
 *     helper keeps callsites short
 *   - the legacy file backup (`./logs/<bot>/...`) is gone — ops dashboards
 *     consume the pino JSON stream directly
 */
import type { Attachment, Channel, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

import type { Logger } from './logger';

const tzDate = (): string => `${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} `;

/**
 * Log an unexpected error. `err` may be a DomainError instance, a native
 * Error, or any thrown value — pino's serialiser preserves stack + cause
 * for Error subclasses; non-Error throws are emitted under the `raw` key.
 *
 * `logger === undefined` is a defensive no-op for the pre-`run()` window;
 * any handler-context callsite is guaranteed to receive a defined logger.
 */
export const logError = (
  logger: Logger | undefined,
  clientId: string,
  guildId: string | null | undefined,
  err: unknown,
): void => {
  if (logger === undefined) return;
  const child =
    guildId === null || guildId === undefined || guildId === ''
      ? logger.child({ bot: clientId })
      : logger.child({ bot: clientId, guildId });
  if (err instanceof Error) {
    child.error({ err }, 'errorLogger');
  } else {
    child.error({ raw: err }, 'errorLogger');
  }
};

/** Bot-scoped info-level log; the legacy `systemLogger` shape. */
export const logSystem = (logger: Logger | undefined, clientId: string, msg: string): void => {
  logger?.child({ bot: clientId }).info({ msg }, 'system');
};

/**
 * Audit-log-style line tagged with the guild's display name. Drops the
 * pre-PR-F2 file backup (deprecated since Phase 6 per the shim header).
 */
export const logGuildEvent = (
  logger: Logger | undefined,
  clientId: string,
  guildId: string,
  eventType: string,
  msg: string,
  guildName: string,
): void => {
  const flat = msg.replaceAll('\n', '\\n');
  logger
    ?.child({ bot: clientId, guildId, guildName })
    .info({ eventType: eventType.toUpperCase(), msg: flat }, 'guild event');
};

/**
 * Send a log line / embed to a guild channel. The structured `logger`
 * receives any send failure so the caller does not have to wrap a
 * try/catch around every audit-channel mirror.
 */
export const sendChannelLog = async (
  logger: Logger | undefined,
  channel: Channel | undefined,
  embed?: EmbedBuilder,
  log?: string,
): Promise<void> => {
  try {
    if (!channel?.isSendable()) return;
    if (log !== undefined) await channel.send(log);
    if (embed !== undefined) await channel.send({ embeds: [embed] });
  } catch (e) {
    logger?.error(
      { err: e instanceof Error ? e : new Error(String(e)) },
      'sendChannelLog: send failed',
    );
  }
};

/**
 * Archive a (presumably deleted) attachment to disk for forensics. Used
 * by the guild-events plugin's `messageDelete` audit path.
 *
 * Retained as I/O behaviour rather than collapsed into a log line —
 * attachments are binary, not text, so structured logging cannot replace
 * them.
 */
export const archiveDeletedAttachment = async (
  logger: Logger | undefined,
  guildId: string,
  attachment: Attachment,
): Promise<void> => {
  try {
    const safeName = `${tzDate().replaceAll('/', '_').replaceAll(':', '_')}${attachment.name}`;
    const filePath = `./data/deleted_attachments/${guildId}/${safeName}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let response;
    try {
      response = await axios.get(attachment.url, { responseType: 'stream' });
    } catch (err) {
      logger?.warn(
        {
          err: err instanceof Error ? err : new Error(String(err)),
          guildId,
          name: attachment.name,
        },
        'archiveDeletedAttachment: fetch failed',
      );
      return;
    }

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', reject);
    });
  } catch (e) {
    logger?.error(
      { err: e instanceof Error ? e : new Error(String(e)), guildId },
      'archiveDeletedAttachment: write failed',
    );
  }
};
