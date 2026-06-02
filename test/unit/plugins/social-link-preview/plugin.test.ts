/**
 * Unit tests for {@link createSocialLinkPreviewPlugin}: plugin shape and
 * the cheap-guard ordering (enabled / bot author / DM / blocked channel /
 * non-sendable). The injected registry's `findProvider` is the probe: it
 * is reached only when every guard passes.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';

import { createSocialLinkPreviewPlugin } from '../../../../src/plugins/social-link-preview';
import type { LinkPreviewProviderRegistry } from '../../../../src/infra/link-preview';
import type { PluginEventContext } from '../../../../src/core/plugin';
import type { Logger } from '../../../../src/core/logger';
import type { Translator } from '../../../../src/core/i18n';

const makeLogger = (): Logger => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger as unknown as Logger;
};

const ctx = (): PluginEventContext =>
  ({
    logger: makeLogger(),
    translator: { t: vi.fn((k: string) => k) } as unknown as Translator,
  }) as unknown as PluginEventContext;

const makeRegistry = (): {
  registry: LinkPreviewProviderRegistry;
  findProvider: ReturnType<typeof vi.fn>;
} => {
  const findProvider = vi.fn(() => undefined);
  return { registry: { findProvider } as unknown as LinkPreviewProviderRegistry, findProvider };
};

interface MsgOpts {
  readonly content?: string;
  readonly bot?: boolean;
  readonly guildId?: string | null;
  readonly channelId?: string;
  readonly sendable?: boolean;
}

const makeMessage = (opts: MsgOpts = {}): Message =>
  ({
    content: opts.content ?? 'see https://x.com/a/status/1',
    author: { bot: opts.bot ?? false },
    guildId: opts.guildId === undefined ? 'g1' : opts.guildId,
    channelId: opts.channelId ?? 'c1',
    channel: { isSendable: () => opts.sendable ?? true },
  }) as unknown as Message;

const fire = async (
  rawConfig: unknown,
  message: Message,
  deps: Parameters<typeof createSocialLinkPreviewPlugin>[1],
): Promise<void> => {
  const plugin = createSocialLinkPreviewPlugin(rawConfig, deps);
  const handler = plugin.events?.messageCreate;
  if (handler === undefined) throw new Error('no messageCreate handler');
  // The discord.js event arg is OmitPartialGroupDMChannel<Message>; our fake
  // is structurally a Message, so narrow it to the handler's exact param type.
  await handler(ctx(), message as Parameters<typeof handler>[1]);
};

describe('createSocialLinkPreviewPlugin shape', () => {
  it('declares id, version, bot scope, non-critical, and a messageCreate subscription', () => {
    const plugin = createSocialLinkPreviewPlugin({ enabled: true });
    expect(plugin.id).toBe('social-link-preview');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.scope).toBe('bot');
    expect(plugin.critical === true).toBe(false);
    expect(plugin.events?.messageCreate).toBeTypeOf('function');
  });
});

describe('createSocialLinkPreviewPlugin guards', () => {
  it('reaches the registry when every guard passes', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: true }, makeMessage(), { registry });
    expect(findProvider).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: false }, makeMessage(), { registry });
    expect(findProvider).not.toHaveBeenCalled();
  });

  it('skips bot-authored messages', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: true }, makeMessage({ bot: true }), { registry });
    expect(findProvider).not.toHaveBeenCalled();
  });

  it('skips direct messages (no guild)', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: true }, makeMessage({ guildId: null }), { registry });
    expect(findProvider).not.toHaveBeenCalled();
  });

  it('skips blocked channels', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: true }, makeMessage({ channelId: 'c-blocked' }), {
      registry,
      blockedChannels: ['c-blocked'],
    });
    expect(findProvider).not.toHaveBeenCalled();
  });

  it('skips non-sendable channels', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: true }, makeMessage({ sendable: false }), { registry });
    expect(findProvider).not.toHaveBeenCalled();
  });
});
