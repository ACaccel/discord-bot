import { describe, expect, it } from 'vitest';

import {
  formatMessageLines,
  type MessageLike,
} from '../../../../src/handlers/commands/db_list_message/format-message-lines';

const baseMessage = (overrides: Partial<MessageLike> = {}): MessageLike => ({
  userId: 'u1',
  userName: 'alice',
  content: 'hello',
  attachments: [],
  reactions: [],
  stickers: [],
  timestamp: new Date(2026, 4, 23, 10, 5, 0, 0).getTime(),
  ...overrides,
});

const fixedResolver = async (_id: string, fallback: string): Promise<string> =>
  fallback === 'alice' ? 'AliceLongDisplayName' : fallback;

describe('formatMessageLines', () => {
  it('renders a basic text message with prefix + timestamp', async () => {
    const lines = await formatMessageLines([baseMessage()], { resolveDisplayName: fixedResolver });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('*10:05*');
    expect(lines[0]).toContain('(alice)');
    expect(lines[0]).toContain('hello');
  });

  it('truncates long display names with an ellipsis', async () => {
    const lines = await formatMessageLines([baseMessage()], { resolveDisplayName: fixedResolver });
    expect(lines[0]).toContain('AliceLongD...');
  });

  it('emits an [empty] placeholder when there is no content, attachment, or sticker', async () => {
    const lines = await formatMessageLines([baseMessage({ content: '' })], {
      resolveDisplayName: fixedResolver,
    });
    expect(lines.some((l) => l.includes('[empty]'))).toBe(true);
  });

  it('renders attachments and stickers as their own lines', async () => {
    const lines = await formatMessageLines(
      [
        baseMessage({
          content: '',
          attachments: [{ id: 'a1', name: 'img.png', url: 'https://x' }],
          stickers: [{ id: 's1', name: 'wave' }],
        }),
      ],
      { resolveDisplayName: fixedResolver },
    );
    expect(lines.some((l) => l.includes('attachment - img.png'))).toBe(true);
    expect(lines.some((l) => l.includes('sticker - wave'))).toBe(true);
  });

  it('appends a reaction summary to the first line of the message', async () => {
    const lines = await formatMessageLines(
      [
        baseMessage({
          reactions: [{ id: '1', name: 'foo', animated: false, count: 3 }],
        }),
      ],
      { resolveDisplayName: fixedResolver },
    );
    expect(lines[0]).toContain('[reactions: <:foo:1> x3]');
  });
});
