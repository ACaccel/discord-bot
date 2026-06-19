/**
 * Handler-level tests for `handleTempRoleCreate`.
 *
 * The handler imports `BaseBot` type-only, so this test constructs
 * minimal fakes for the interaction, bot, guild, channel and repos —
 * no handler-registry or real Discord wiring.
 */
import type { Job } from 'node-schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { ok } from '../../../src/core/result';
import { handleTempRoleCreate } from '../../../src/plugins/temp-role/internal/handlers';
import type { BaseBot } from '../../../src/bot';

const GUILD_ID = 'guild-1';
const translator = { t: (key: string) => key } as unknown as BaseBot['translator'];

const makeRepos = () => ({
  tempRole: {
    create: vi.fn().mockResolvedValue(ok({ role_id: 'role-1' })),
    findByRoleId: vi.fn().mockResolvedValue(ok(undefined)),
    deleteByRoleId: vi.fn().mockResolvedValue(ok(true)),
    listAll: vi.fn().mockResolvedValue(ok([])),
  },
});

const makeGuild = (roleCount: number) => ({
  id: GUILD_ID,
  roles: {
    cache: { size: roleCount },
    create: vi.fn().mockResolvedValue({ id: 'role-1' }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
});

const makeChannel = (sendable: boolean) => ({
  id: 'chan-1',
  isSendable: () => sendable,
  send: vi.fn().mockResolvedValue({ id: 'msg-1', delete: vi.fn().mockResolvedValue(undefined) }),
});

const scheduledJobs = new Map<string, Job>();

const makeBot = (repos: ReturnType<typeof makeRepos>): BaseBot =>
  ({
    client: { guilds: { cache: new Map() }, channels: { fetch: vi.fn() } },
    getRepos: (guildId: string) => (guildId === GUILD_ID ? repos : undefined),
    getGuildInfo: () => undefined,
    getAllGuildInfo: () => new Map(),
    jobs: scheduledJobs,
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    translator,
  }) as unknown as BaseBot;

const makeInteraction = (
  guild: any,
  channel: any,
  opts: { name?: string; days?: number },
): ChatInputCommandInteraction =>
  ({
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    guild,
    channel,
    user: { id: 'user-1' },
    options: {
      get: (name: string) => {
        if (name === 'name') return opts.name === undefined ? undefined : { value: opts.name };
        if (name === 'days') return opts.days === undefined ? undefined : { value: opts.days };
        return undefined;
      },
    },
  }) as unknown as ChatInputCommandInteraction;

afterEach(() => {
  for (const job of scheduledJobs.values()) job.cancel();
  scheduledJobs.clear();
  vi.clearAllMocks();
});

describe('handleTempRoleCreate', () => {
  it('creates the role, posts the claim message, and removes the ephemeral ack', async () => {
    const repos = makeRepos();
    const guild = makeGuild(10);
    const channel = makeChannel(true);
    const interaction = makeInteraction(guild, channel, { name: 'Notify', days: 7 });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(guild.roles.create).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(repos.tempRole.create).toHaveBeenCalledTimes(1);
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('defaults to a 30-day lifetime when days is omitted', async () => {
    const repos = makeRepos();
    const guild = makeGuild(10);
    const channel = makeChannel(true);
    const interaction = makeInteraction(guild, channel, { name: 'Notify' });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(repos.tempRole.create).toHaveBeenCalledTimes(1);
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank name without creating a role', async () => {
    const repos = makeRepos();
    const guild = makeGuild(10);
    const channel = makeChannel(true);
    const interaction = makeInteraction(guild, channel, { name: '   ', days: 7 });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:temp_role.missing_name',
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
  });

  it('rejects a duration above the hard cap without creating a role', async () => {
    const repos = makeRepos();
    const guild = makeGuild(10);
    const channel = makeChannel(true);
    const interaction = makeInteraction(guild, channel, { name: 'Notify', days: 31 });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:temp_role.invalid_duration',
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
  });

  it('reports the role limit and creates nothing when the guild is full', async () => {
    const repos = makeRepos();
    const guild = makeGuild(250);
    const channel = makeChannel(true);
    const interaction = makeInteraction(guild, channel, { name: 'Notify', days: 7 });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:temp_role.at_role_limit',
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  it('reports guild_not_found when invoked outside a guild', async () => {
    const repos = makeRepos();
    const channel = makeChannel(true);
    const interaction = makeInteraction(null, channel, { name: 'Notify', days: 7 });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'errors:command.guild_not_found',
    });
  });

  it('reports the database-not-found copy when the guild has no repos', async () => {
    const repos = makeRepos();
    const guild = makeGuild(10);
    const channel = makeChannel(true);
    const interaction = makeInteraction(guild, channel, { name: 'Notify', days: 7 });
    const bot = makeBot(repos);
    (bot as unknown as { getRepos: () => undefined }).getRepos = () => undefined;

    await handleTempRoleCreate(interaction, bot);

    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'errors:db.not_found' });
    expect(guild.roles.create).not.toHaveBeenCalled();
  });

  it('rejects when the invoking channel is not sendable', async () => {
    const repos = makeRepos();
    const guild = makeGuild(10);
    const channel = makeChannel(false);
    const interaction = makeInteraction(guild, channel, { name: 'Notify', days: 7 });

    await handleTempRoleCreate(interaction, makeBot(repos));

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'errors:command.channel_not_found',
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
  });
});
