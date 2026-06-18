/**
 * Unit tests for {@link createSocialLinkPreviewPlugin}: plugin shape and the
 * cheap-guard ordering (enabled / bot author / DM / rank-suppressed channel /
 * non-sendable). The injected registry's `findProvider` is the probe: it is
 * reached only when every guard passes.
 *
 * Channel suppression now comes from a real {@link PermissionRankPolicy}
 * (built by the production factory from static config) resolved off the event
 * context, not a `blockedChannels` list. The `social_preview` default ceiling
 * is unbounded, so a channel previews unless an operator sets a finite ceiling.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';

import { createSocialLinkPreviewPlugin } from '../../../../src/plugins/social-link-preview';
import type { LinkPreviewProviderRegistry } from '../../../../src/infra/link-preview';
import {
  createPermissionRankPolicy,
  type PermissionRankPolicy,
  type PluginEventContext,
} from '../../../../src/core/plugin';
import { createContainer } from '../../../../src/core/ioc';
import { TOKENS } from '../../../../src/core/ioc/tokens';
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

/** An empty policy: `social_preview` ceiling defaults to unbounded, so nothing is suppressed. */
const emptyPolicy = createPermissionRankPolicy({});

const ctx = (policy: PermissionRankPolicy): PluginEventContext => {
  const container = createContainer();
  container.registerSingleton(TOKENS.PermissionRankPolicy, () => policy);
  return {
    logger: makeLogger(),
    translator: { t: vi.fn((k: string) => k) } as unknown as Translator,
    resolve: container.resolve.bind(container),
  } as unknown as PluginEventContext;
};

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
  policy: PermissionRankPolicy = emptyPolicy,
): Promise<void> => {
  const plugin = createSocialLinkPreviewPlugin(rawConfig, deps);
  const handler = plugin.events?.messageCreate;
  if (handler === undefined) throw new Error('no messageCreate handler');
  // The discord.js event arg is OmitPartialGroupDMChannel<Message>; our fake
  // is structurally a Message, so narrow it to the handler's exact param type.
  await handler(ctx(policy), message as Parameters<typeof handler>[1]);
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

  it('skips a channel above a configured social_preview ceiling', async () => {
    const { registry, findProvider } = makeRegistry();
    const policy = createPermissionRankPolicy({
      g1: { channels: { 'c-secret': 1 }, features: { social_preview: { maxChannelRank: 0 } } },
    });
    await fire({ enabled: true }, makeMessage({ channelId: 'c-secret' }), { registry }, policy);
    expect(findProvider).not.toHaveBeenCalled();
  });

  it('previews a ranked channel under the DEFAULT (unbounded) ceiling — the intentional change from blocked_channels', async () => {
    const { registry, findProvider } = makeRegistry();
    // A channel that would have been in nijika's old `blocked_channels` (rank
    // 1 here) now receives a preview, because social_preview defaults to no
    // ceiling. Suppressing it again requires an explicit finite ceiling.
    const policy = createPermissionRankPolicy({ g1: { channels: { 'c-secret': 1 } } });
    await fire({ enabled: true }, makeMessage({ channelId: 'c-secret' }), { registry }, policy);
    expect(findProvider).toHaveBeenCalledTimes(1);
  });

  it('skips non-sendable channels', async () => {
    const { registry, findProvider } = makeRegistry();
    await fire({ enabled: true }, makeMessage({ sendable: false }), { registry });
    expect(findProvider).not.toHaveBeenCalled();
  });
});
