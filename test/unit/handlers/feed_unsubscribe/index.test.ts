/**
 * `/feed_unsubscribe` — the deletion scope it builds, who may build it,
 * and what it reports back.
 *
 * The scope is the whole risk: too wide and a member clears
 * subscriptions nobody asked to remove, too narrow and the command
 * silently does nothing. Every option combination therefore asserts on
 * the exact `deleteWhere` query, not just on the reply. The `account`
 * option accepts a list, which widens that scope one more way.
 */
import { describe, expect, it, vi } from 'vitest';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Types } from 'mongoose';

import FeedUnsubscribe from '../../../../src/handlers/commands/feed_unsubscribe';
import { MAX_LISTED_REMOVALS } from '../../../../src/handlers/commands/feed_unsubscribe/format-removed';
import { err, ok } from '../../../../src/core/result';
import { FeedPlatformRegistry, MAX_FEED_ACCOUNTS } from '../../../../src/infra/social-feed';
import { databaseErrorFrom } from '../../../../src/persistence/error-translator';
import type { FeedSubscriptionDoc } from '../../../../src/persistence/schemas/feed-subscription.schema';
import { buildFakeBot, echoTranslatorWithParams } from '../../../fixtures/discord/bot-fake';
import { buildTextChannel } from '../../../fixtures/discord/channel-builder';
import { buildGuild } from '../../../fixtures/discord/guild-builder';
import {
  buildChatInputInteraction,
  newInteractionSink,
} from '../../../fixtures/discord/interaction-builder';
import { buildFakeFeedPlatform } from '../../../fixtures/social-feed/fake-platform';

const GUILD_ID = 'g-1';
const HOME_CHANNEL = 'chan-home';
const OTHER_CHANNEL = 'chan-other';
const THREAD_CHANNEL = 'chan-thread';
const USER_ID = 'u-1';

const subscription = (overrides: Partial<FeedSubscriptionDoc> = {}): FeedSubscriptionDoc => ({
  _id: new Types.ObjectId(),
  platform: 'fake',
  account: 'someone',
  channel_id: HOME_CHANNEL,
  created_by: USER_ID,
  created_at: 1_700_000_000_000,
  filter: { media: 'media_only' },
  ...overrides,
});

interface Fixture {
  readonly deleted?: readonly FeedSubscriptionDoc[];
  readonly repoFails?: boolean;
  readonly options?: Readonly<Record<string, string>>;
  readonly channelOption?: string;
  /** Permissions the invoker holds in every channel; defaults to ViewChannel. */
  readonly invokerPermissions?: readonly bigint[];
  /** Leaves the invoker out of the member cache — permissions unknowable. */
  readonly invokerMemberMissing?: boolean;
}

const build = (fixture: Fixture = {}) => {
  const { platform } = buildFakeFeedPlatform({ invalidAccounts: new Set(['banned']) });
  const permissionsBySubject = {
    [USER_ID]: fixture.invokerPermissions ?? [PermissionFlagsBits.ViewChannel],
  };
  const parent = buildTextChannel({ id: 'chan-parent', permissionsBySubject });
  const guild = buildGuild({
    id: GUILD_ID,
    channels: [
      buildTextChannel({ id: HOME_CHANNEL, permissionsBySubject }),
      buildTextChannel({ id: OTHER_CHANNEL, permissionsBySubject }),
      parent,
      // A thread carries no overwrites of its own; the parent answers.
      buildTextChannel({ id: THREAD_CHANNEL, type: ChannelType.PublicThread, parent }),
    ],
    members: fixture.invokerMemberMissing === true ? [] : [{ id: USER_ID }],
  });

  const deleteWhere = vi.fn(async () =>
    fixture.repoFails === true
      ? err(databaseErrorFrom(new Error('boom'), { operation: 'test' }))
      : ok(fixture.deleted ?? [subscription()]),
  );
  const { bot, logger } = buildFakeBot({
    translator: echoTranslatorWithParams(),
    feedPlatformRegistry: new FeedPlatformRegistry([platform]),
    connectionManager: { isDisabled: () => undefined },
    getRepos: () => ({ feedSubscription: { deleteWhere } }),
  });

  const sink = newInteractionSink();
  const interaction = buildChatInputInteraction({
    commandName: 'feed_unsubscribe',
    guild,
    userId: USER_ID,
    channel: { id: HOME_CHANNEL },
    options: { ...fixture.options },
    ...(fixture.channelOption === undefined
      ? {}
      : { channels: { channel: { id: fixture.channelOption } } }),
    sink,
  });

  return { bot, interaction, sink, deleteWhere, logger };
};

const reply = (sink: ReturnType<typeof newInteractionSink>): string => {
  expect(sink.editReplies).toHaveLength(1);
  return sink.editReplies[0]?.content ?? '';
};

describe('/feed_unsubscribe', () => {
  it('answers ephemerally', async () => {
    const { bot, interaction, sink } = build();

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(sink.defers[0]?.flags).toBe(MessageFlags.Ephemeral);
  });

  it('clears the invoking channel when only the channel is implied', async () => {
    const { bot, interaction, deleteWhere } = build();

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({ channelId: HOME_CHANNEL });
  });

  it('scopes to the chosen channel when the option is given', async () => {
    const { bot, interaction, deleteWhere } = build({ channelOption: OTHER_CHANNEL });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({ channelId: OTHER_CHANNEL });
  });

  it('refuses a channel the invoker cannot see, before deleting anything', async () => {
    // Reach is bounded by visibility even though authority is not: a
    // member must not be able to empty the feeds of a channel they have
    // no access to.
    const { bot, interaction, sink, deleteWhere } = build({ invokerPermissions: [] });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(reply(sink)).toContain('replies:feed.invoker_cannot_view');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('says permissions are unknown when the invoker is not in the member cache', async () => {
    // "Unknown" must not read as "allowed" on the command that deletes.
    const { bot, interaction, sink, deleteWhere } = build({ invokerMemberMissing: true });

    await new FeedUnsubscribe().execute(interaction, bot);

    const content = reply(sink);
    expect(content).toContain('replies:feed.permissions_unknown');
    expect(content).not.toContain('replies:feed.invoker_cannot_view');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('clears a thread through the permissions of its parent', async () => {
    const { bot, interaction, deleteWhere } = build({ channelOption: THREAD_CHANNEL });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({ channelId: THREAD_CHANNEL });
  });

  it('refuses a thread the invoker cannot see the parent of', async () => {
    const { bot, interaction, sink, deleteWhere } = build({
      channelOption: THREAD_CHANNEL,
      invokerPermissions: [],
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(reply(sink)).toContain('replies:feed.invoker_cannot_view');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('refuses a channel it cannot resolve at all', async () => {
    const { bot, interaction, sink, deleteWhere } = build({ channelOption: 'chan-unknown' });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(reply(sink)).toContain('replies:feed.channel_not_supported');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('narrows by platform when one is named', async () => {
    const { bot, interaction, deleteWhere } = build({ options: { platform: 'fake' } });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({ channelId: HOME_CHANNEL, platform: 'fake' });
  });

  it('normalises the account through the named platform', async () => {
    const { bot, interaction, deleteWhere } = build({
      options: { platform: 'fake', account: '@SomeOne' },
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({
      channelId: HOME_CHANNEL,
      platform: 'fake',
      accounts: ['someone'],
    });
  });

  it('removes every account a single invocation names', async () => {
    const { bot, interaction, deleteWhere } = build({
      options: { platform: 'fake', account: '@Alpha, beta gamma' },
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({
      channelId: HOME_CHANNEL,
      platform: 'fake',
      accounts: ['alpha', 'beta', 'gamma'],
    });
  });

  it('refuses a list past the cap without deleting anything', async () => {
    const tooMany = Array.from({ length: MAX_FEED_ACCOUNTS + 1 }, (_, i) => `a${String(i)}`);
    const { bot, interaction, sink, deleteWhere } = build({
      options: { account: tooMany.join(',') },
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    const content = reply(sink);
    expect(content).toContain('replies:feed.too_many_accounts');
    expect(content).toContain(`"max":${String(MAX_FEED_ACCOUNTS)}`);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('refuses an account option that names nothing, rather than clearing the channel', async () => {
    // The dangerous direction: an unusable list must not degrade into
    // "no narrowing", which would empty the whole channel.
    const { bot, interaction, sink, deleteWhere } = build({ options: { account: ' , @ ' } });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(reply(sink)).toContain('replies:feed.no_accounts');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('still removes subscriptions to a platform that is no longer configured', async () => {
    // The whole reason this command never consults the registry for
    // authorisation: a retired platform's entries must stay clearable.
    const { bot, interaction, sink, deleteWhere } = build({
      options: { platform: 'retired', account: '@SomeOne' },
      deleted: [subscription({ platform: 'retired' })],
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({
      channelId: HOME_CHANNEL,
      platform: 'retired',
      accounts: ['someone'],
    });
    expect(reply(sink)).toContain('replies:feed.unsubscribed');
  });

  it('still resolves an account when no platform narrows the scope', async () => {
    const { bot, interaction, deleteWhere } = build({ options: { account: '@SomeOne' } });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(deleteWhere).toHaveBeenCalledWith({ channelId: HOME_CHANNEL, accounts: ['someone'] });
  });

  it('lists every subscription it removed', async () => {
    const { bot, interaction, sink } = build({
      deleted: [
        subscription({ account: 'someone' }),
        subscription({ platform: 'other', account: 'anotherone' }),
      ],
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    const content = reply(sink);
    expect(content).toContain('replies:feed.unsubscribed');
    expect(content).toContain('fake @someone');
    expect(content).toContain('other @anotherone');
    expect(content).toContain('"count":2');
  });

  it('records the removal in the operator log before replying', async () => {
    // The deletion has already committed and the confirmation is both
    // bounded and losable, so the log is the durable record.
    const { bot, interaction, logger } = build({
      deleted: [subscription({ account: 'alpha' })],
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    const logged = logger.info.mock.calls.flat().join(' ');
    expect(logged).toContain('feed.subscriptions_removed');
    expect(logged).toContain('fake @alpha');
  });

  it('bounds a very large confirmation so Discord will accept it', async () => {
    const deleted = Array.from({ length: MAX_LISTED_REMOVALS + 30 }, (_, index) =>
      subscription({ account: `account-${String(index)}` }),
    );
    const { bot, interaction, sink } = build({ deleted });

    await new FeedUnsubscribe().execute(interaction, bot);

    const content = reply(sink);
    expect(content).toContain('replies:feed.unsubscribed_more');
    expect(content).toContain(`"count":${String(deleted.length)}`);
  });

  it('says so plainly when the whole channel was already empty', async () => {
    const { bot, interaction, sink } = build({ deleted: [] });

    await new FeedUnsubscribe().execute(interaction, bot);

    const content = reply(sink);
    expect(content).toContain('replies:feed.unsubscribed_none');
    expect(content).not.toContain('unsubscribed_none_hint');
    expect(content).toContain(`<#${HOME_CHANNEL}>`);
  });

  it('suggests widening the search when a narrowed scope matched nothing', async () => {
    const { bot, interaction, sink } = build({ deleted: [], options: { account: 'ghost' } });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(reply(sink)).toContain('replies:feed.unsubscribed_none_hint');
  });

  it('reports an invalid handle instead of deleting nothing', async () => {
    // One bad entry fails the whole call: a partial deletion would make
    // a typo look like an account that was never subscribed.
    const { bot, interaction, sink, deleteWhere } = build({
      options: { platform: 'fake', account: 'alpha, banned' },
    });

    await new FeedUnsubscribe().execute(interaction, bot);

    expect(reply(sink)).toContain('errors:feed.invalid_account');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('falls back to the traced failure copy when the database refuses', async () => {
    const { bot, interaction, sink } = build({ repoFails: true });

    await new FeedUnsubscribe().execute(interaction, bot);

    const content = reply(sink);
    expect(content).toContain('replies:feed.failed');
    expect(content).toContain('traceId');
  });
});
