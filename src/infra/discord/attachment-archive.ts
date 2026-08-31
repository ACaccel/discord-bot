/**
 * Archive a deleted Discord attachment to disk for forensics.
 *
 * Lives in `infra/discord/` because it imports `discord.js`, `axios`,
 * and `fs` — third-party SDK dependencies that the `core/` layer
 * deliberately excludes.
 */
import type { Attachment } from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'node:stream/promises';

import type { Logger } from '../../core/logger';

/**
 * Wall-clock budget for one CDN download. Discord's attachment CDN can
 * accept a connection and then stall, or trickle bytes indefinitely;
 * without a deadline the transfer promise never settles and the open
 * file descriptor leaks for the lifetime of the process.
 *
 * Enforced with `AbortSignal.timeout`, not axios's `timeout` option:
 * the latter maps to socket *inactivity*, which a slow trickle resets
 * forever.
 */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Upper bound on a single archived attachment. Matches the largest
 * upload Discord accepts from a boosted guild, so nothing that could
 * legitimately have been posted is refused, while a malformed or
 * hostile `Content-Length` cannot fill the disk.
 */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/**
 * Simultaneous downloads across one archive batch. A bulk delete can
 * carry 100 messages; without a bound every attachment starts at once
 * and the process holds 100 sockets and 100 file descriptors open.
 */
const MAX_CONCURRENT_DOWNLOADS = 4;

const tzDate = (): string => `${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} `;

/**
 * Download `attachment` and save it under
 * `./data/deleted_attachments/<guildId>/`. Used by the guild-events
 * plugin's `messageDelete` audit path.
 *
 * Attachments are binary, not text, so this is genuine file I/O —
 * structured logging cannot stand in for it.
 *
 * Never rejects: every failure mode is logged and swallowed so one bad
 * attachment cannot disturb the caller's audit flow.
 */
export const archiveDeletedAttachment = async (
  logger: Logger | undefined,
  guildId: string,
  attachment: Attachment,
): Promise<void> => {
  const safeName = `${tzDate().replaceAll('/', '_').replaceAll(':', '_')}${attachment.name}`;
  const filePath = `./data/deleted_attachments/${guildId}/${safeName}`;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (e) {
    logger?.error(
      { err: e instanceof Error ? e : new Error(String(e)), guildId },
      'archiveDeletedAttachment: could not create the archive directory',
    );
    return;
  }

  let response;
  try {
    response = await axios.get<NodeJS.ReadableStream>(attachment.url, {
      responseType: 'stream',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      maxContentLength: MAX_ATTACHMENT_BYTES,
      maxRedirects: 3,
    });
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

  try {
    // `pipeline` propagates a failure from either end and destroys both
    // streams. The hand-rolled `pipe` + `finish` listener it replaces
    // ignored source errors entirely, so an interrupted CDN transfer
    // left a promise pending forever and the write handle open.
    await pipeline(response.data, fs.createWriteStream(filePath));
  } catch (e) {
    logger?.error(
      { err: e instanceof Error ? e : new Error(String(e)), guildId, name: attachment.name },
      'archiveDeletedAttachment: write failed',
    );
    // A truncated file is worse than no file: it reads as a complete
    // archive later. Remove it and let the log carry the failure.
    await fs.promises.unlink(filePath).catch(() => undefined);
  }
};

/**
 * Archive a batch of attachments with a bounded number of concurrent
 * downloads. Resolves once every attachment has been attempted; like
 * {@link archiveDeletedAttachment}, it never rejects.
 */
export const archiveDeletedAttachments = async (
  logger: Logger | undefined,
  guildId: string,
  attachments: Iterable<Attachment>,
): Promise<void> => {
  const queue = [...attachments];
  const workerCount = Math.min(MAX_CONCURRENT_DOWNLOADS, queue.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        await archiveDeletedAttachment(logger, guildId, next);
      }
    }),
  );
};
