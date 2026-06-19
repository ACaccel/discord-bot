/**
 * Tests for the `temp_role` command-class wrapper.
 *
 * The thin handler delegates to the plugin's `handleTempRoleCreate` and
 * owns the error boundary: an unexpected failure (e.g. a re-thrown
 * `DatabaseError` from the create rollback path) must be routed through
 * `replyForError` with the `replies:temp_role.failed` fallback copy.
 */
import type { Job } from 'node-schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';

import { err, ok } from '../../../src/core/result';
import { databaseErrorFrom } from '../../../src/persistence/error-translator';
import temp_role from '../../../src/handlers/commands/temp_role';
import type { BaseBot } from '../../../src/bot';

const GUILD_ID = 'guild-1';
const translator = { t: (key: string) => key } as unknown as BaseBot['translator'];

const makeRepos = (createResult: unknown) => ({
  tempRole: {
    create: vi.fn().mockResolvedValue(createResult),
    findByRoleId: vi.fn().mockResolvedValue(ok(undefined)),
    deleteByRoleId: vi.fn().mockResolvedValue(ok(true)),
    listAll: vi.fn().mockResolvedValue(ok([])),
  },
});

const makeGuild = () => ({
  id: GUILD_ID,
  roles: {
    cache: { size: 10 },
    create: vi.fn().mockResolvedValue({ id: 'role-1' }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
});

const makeChannel = () => ({
  id: 'chan-1',
  isSendable: () => true,
  send: vi.fn().mockResolvedValue({ id: 'msg-1', delete: vi.fn().mockResolvedValue(undefined) }),
});

const scheduledJobs = new Map<string, Job>();

// A logger whose `child(...)` returns itself, so replyForError's
// `logError` (which scopes via `logger.child({ guildId })`) works.
const makeLogger = () => {
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), child: () => logger };
  return logger;
};

const makeBot = (repos: ReturnType<typeof makeRepos>): BaseBot =>
  ({
    client: { guilds: { cache: new Map() }, channels: { fetch: vi.fn() } },
    getRepos: (guildId: string) => (guildId === GUILD_ID ? repos : undefined),
    getGuildInfo: () => undefined,
    getAllGuildInfo: () => new Map(),
    jobs: scheduledJobs,
    logger: makeLogger(),
    translator,
  }) as unknown as BaseBot;

const makeInteraction = (): ChatInputCommandInteraction =>
  ({
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    // Post-defer state so replyForError edits the deferred reply.
    deferred: true,
    replied: false,
    guild: makeGuild(),
    channel: makeChannel(),
    user: { id: 'user-1' },
    options: {
      get: (name: string) =>
        name === 'name' ? { value: 'Notify' } : name === 'days' ? { value: 7 } : undefined,
    },
  }) as unknown as ChatInputCommandInteraction;

afterEach(() => {
  for (const job of scheduledJobs.values()) job?.cancel();
  scheduledJobs.clear();
  vi.clearAllMocks();
});

describe('temp_role command wrapper', () => {
  it('delegates to the plugin handler on the happy path', async () => {
    const interaction = makeInteraction();

    await new temp_role().execute(interaction, makeBot(makeRepos(ok({ role_id: 'role-1' }))));

    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('routes an unexpected failure through replyForError with the failed copy', async () => {
    const interaction = makeInteraction();
    const repos = makeRepos(err(databaseErrorFrom(new Error('boom'), { operation: 'test' })));

    await new temp_role().execute(interaction, makeBot(repos));

    // The create rollback rethrows the DatabaseError; the wrapper's catch
    // surfaces the trace-id-stamped fallback copy on the deferred reply.
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'replies:temp_role.failed' });
  });
});
