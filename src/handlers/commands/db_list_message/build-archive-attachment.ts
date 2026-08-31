import { AttachmentBuilder } from 'discord.js';

/**
 * Package the rendered transcript into a Discord file attachment.
 * The helper depends on a Discord builder (it is not pure), but it
 * is still extracted so the index.ts handler only worries about
 * "is this print=yes or print=no" routing logic.
 */
interface BuildArchiveAttachmentParams {
  readonly channelId: string;
  readonly date: string;
  readonly hour: number | null | undefined;
  readonly text: string;
}

export const buildArchiveAttachment = (params: BuildArchiveAttachmentParams): AttachmentBuilder => {
  const { channelId, date, hour, text } = params;
  const hourLabel =
    hour === null || hour === undefined ? 'allday' : `${hour.toString().padStart(2, '0')}`;
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), {
    name: `db_list_message_${channelId}_${date}_${hourLabel}.txt`,
  });
};
