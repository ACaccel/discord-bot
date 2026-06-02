/**
 * Unit tests for {@link renderPreview} / {@link buildCardEmbed}: the
 * discriminated-union reply dispatch and embed assembly. A minimal fake
 * Message captures the reply payload; the translator is stubbed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';

import {
  renderPreview,
  buildCardEmbed,
} from '../../../../src/plugins/social-link-preview/internal/render';
import type { Translator } from '../../../../src/core/i18n';
import type { LinkPreviewResult } from '../../../../src/infra/link-preview';

const makeTranslator = (): Translator =>
  ({
    t: vi.fn((key: string, params?: { provider?: string }) => `${key}|${params?.provider ?? ''}`),
  }) as unknown as Translator;

interface ReplyPayload {
  content?: string;
  embeds?: unknown[];
  allowedMentions?: { parse: readonly string[] };
}

const makeMessage = (): { message: Message; replies: ReplyPayload[] } => {
  const replies: ReplyPayload[] = [];
  const message = {
    reply: vi.fn(async (payload: ReplyPayload) => {
      replies.push(payload);
      return {} as Message;
    }),
  } as unknown as Message;
  return { message, replies };
};

describe('renderPreview', () => {
  it('replies with the proxy URL as content for a rewritten-url result', async () => {
    const { message, replies } = makeMessage();
    const result: LinkPreviewResult = {
      kind: 'rewritten-url',
      url: 'https://fxtwitter.com/a/status/1',
      sourceUrl: 'https://x.com/a/status/1',
    };
    await renderPreview(message, result, makeTranslator());

    expect(replies).toHaveLength(1);
    const [payload] = replies;
    expect(payload?.content).toBe('https://fxtwitter.com/a/status/1');
    expect(payload?.allowedMentions).toEqual({ parse: [] });
    expect(payload?.embeds).toBeUndefined();
  });

  it('replies with an embed for a card result', async () => {
    const { message, replies } = makeMessage();
    const result: LinkPreviewResult = {
      kind: 'card',
      card: {
        url: 'https://forum.gamer.com.tw/post/1',
        title: 'Title',
        description: 'Desc',
        imageUrl: 'https://cdn/og.jpg',
        siteName: 'Bahamut',
      },
      sourceUrl: 'https://forum.gamer.com.tw/post/1',
    };
    await renderPreview(message, result, makeTranslator());

    expect(replies).toHaveLength(1);
    const [payload] = replies;
    expect(payload?.embeds).toHaveLength(1);
    expect(payload?.allowedMentions).toEqual({ parse: [] });
  });
});

describe('buildCardEmbed', () => {
  it('sets title (linked), description, image, and a translated footer', () => {
    const embed = buildCardEmbed(
      {
        url: 'https://forum.gamer.com.tw/post/1',
        title: 'Hello',
        description: 'World',
        imageUrl: 'https://cdn/og.jpg',
        siteName: 'Bahamut',
      },
      makeTranslator(),
    );
    expect(embed.data.title).toBe('Hello');
    expect(embed.data.url).toBe('https://forum.gamer.com.tw/post/1');
    expect(embed.data.description).toBe('World');
    expect(embed.data.image?.url).toBe('https://cdn/og.jpg');
    expect(embed.data.footer?.text).toBe('replies:social_link_preview.embed_footer|Bahamut');
  });

  it('omits optional fields that are absent', () => {
    const embed = buildCardEmbed({ url: 'https://forum.gamer.com.tw/post/1' }, makeTranslator());
    expect(embed.data.title).toBeUndefined();
    expect(embed.data.description).toBeUndefined();
    expect(embed.data.image).toBeUndefined();
    expect(embed.data.footer).toBeUndefined();
  });

  it('truncates an over-long title', () => {
    const long = 'x'.repeat(400);
    const embed = buildCardEmbed({ url: 'https://e/1', title: long }, makeTranslator());
    expect(embed.data.title?.length).toBe(256);
    expect(embed.data.title?.endsWith('...')).toBe(true);
  });
});
