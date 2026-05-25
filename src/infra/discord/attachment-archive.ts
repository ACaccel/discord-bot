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

import type { Logger } from '../../core/logger';

const tzDate = (): string => `${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} `;

/**
 * Download `attachment` and save it under
 * `./data/deleted_attachments/<guildId>/`. Used by the guild-events
 * plugin's `messageDelete` audit path.
 *
 * Attachments are binary, not text, so this is genuine file I/O —
 * structured logging cannot stand in for it.
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
