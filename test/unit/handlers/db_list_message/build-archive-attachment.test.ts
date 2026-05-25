import { describe, expect, it } from 'vitest';

import { buildArchiveAttachment } from '../../../../src/handlers/commands/db_list_message/build-archive-attachment';

describe('buildArchiveAttachment', () => {
  it('uses an allday hour label when hour is null', () => {
    const attachment = buildArchiveAttachment({
      channelId: 'ch1',
      date: '2026-05-23',
      hour: null,
      text: 'hello',
    });
    expect(attachment.name).toBe('db_list_message_ch1_2026-05-23_allday.txt');
  });

  it('uses a zero-padded hour label otherwise', () => {
    const attachment = buildArchiveAttachment({
      channelId: 'ch1',
      date: '2026-05-23',
      hour: 7,
      text: 'hello',
    });
    expect(attachment.name).toBe('db_list_message_ch1_2026-05-23_07.txt');
  });

  it('encodes the supplied text into the attachment buffer', () => {
    const attachment = buildArchiveAttachment({
      channelId: 'ch1',
      date: '2026-05-23',
      hour: 0,
      text: 'hello world',
    });
    expect(attachment.attachment).toBeInstanceOf(Buffer);
    expect((attachment.attachment as Buffer).toString('utf8')).toBe('hello world');
  });
});
