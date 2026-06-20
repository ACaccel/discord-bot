/**
 * Unit coverage for the resilience contract of
 * `ConnectionManager`: transient-failure retry with bounded backoff,
 * persistent-failure / retry-exhaustion disabling, and the
 * `isDisabled` query surface.
 *
 * Uses `StaticConnectionManager`'s `openOverride` failure-injection
 * hook so the retry / disable behaviour is exercised deterministically
 * without a real cluster. Backoff is driven through an injected no-op
 * `sleep`, so the suite runs in zero wall time while still asserting
 * the delay schedule.
 */
import type { Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { asGuildId } from '../../../../src/core/ids';
import { DatabaseError } from '../../../../src/core/errors';
import {
  StaticConnectionManager,
  type GuildConnection,
  type RetryPolicy,
} from '../../../../src/infra/mongo/connection-manager';

const guildId = asGuildId('123456789012345678');

// `openOverride` bypasses `buildModels`, so the underlying connection
// is never dereferenced — a typed stub is sufficient for these tests.
const fakeConnection = {} as Connection;

const fastPolicy: RetryPolicy = { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1_000 };

const transientError = (): DatabaseError =>
  new DatabaseError({
    code: 'DATABASE_TIMEOUT',
    messageKey: 'errors.db.timeout',
    context: { operation: 'test.open' },
  });

const persistentError = (): DatabaseError =>
  new DatabaseError({
    code: 'DATABASE_UNKNOWN',
    messageKey: 'errors.db.unavailable',
    context: { operation: 'test.open' },
  });

const guildConnection = (): GuildConnection =>
  ({ guildId, connection: fakeConnection }) as unknown as GuildConnection;

describe('ConnectionManager — retry / disable', () => {
  it('retries a transient failure and succeeds within the attempt budget', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      calls += 1;
      if (calls < 3) throw transientError();
      return guildConnection();
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: fastPolicy,
      sleep,
      openOverride,
    });

    const conn = await mgr.getConnection(guildId);

    expect(conn.guildId).toBe(guildId);
    expect(openOverride).toHaveBeenCalledTimes(3);
    // Two retries -> two backoff sleeps: 100ms then 200ms.
    expect(sleep.mock.calls).toEqual([[100], [200]]);
    // A guild that ultimately connected is not disabled.
    expect(mgr.isDisabled(guildId)).toBeUndefined();
  });

  it('disables the guild after transient retries are exhausted', async () => {
    const sleep = vi.fn(async () => {});
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      throw transientError();
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: fastPolicy,
      sleep,
      openOverride,
    });

    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);

    // 3 attempts total, 2 backoff sleeps in between.
    expect(openOverride).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const disabled = mgr.isDisabled(guildId);
    expect(disabled).toBeDefined();
    expect(disabled?.traceId).toMatch(/^[0-9a-z]{6}$/);
    expect(disabled?.error.code).toBe('DATABASE_TIMEOUT');
  });

  it('disables the guild immediately on a persistent failure without retrying', async () => {
    const sleep = vi.fn(async () => {});
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      throw persistentError();
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: fastPolicy,
      sleep,
      openOverride,
    });

    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);

    // Persistent failure: a single attempt, no backoff sleeps.
    expect(openOverride).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(mgr.isDisabled(guildId)?.error.code).toBe('DATABASE_UNKNOWN');
  });

  it('short-circuits subsequent getConnection calls for a disabled guild', async () => {
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      throw persistentError();
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: fastPolicy,
      sleep: async () => {},
      openOverride,
    });

    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);
    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);

    // The second call must NOT hit `open` again — the disabled marker
    // short-circuits without touching the cluster.
    expect(openOverride).toHaveBeenCalledTimes(1);
  });

  it('keeps a stable traceId across repeated failures of the same guild', async () => {
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      throw persistentError();
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: fastPolicy,
      sleep: async () => {},
      openOverride,
    });

    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);
    const first = mgr.isDisabled(guildId)?.traceId;
    // Re-query: the marker is the durable record; the traceId never
    // changes once stamped so log/ticket correlation stays valid.
    expect(mgr.isDisabled(guildId)?.traceId).toBe(first);
  });

  it('clears the disabled marker on close so a recovered guild can retry', async () => {
    let shouldFail = true;
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      if (shouldFail) throw persistentError();
      return guildConnection();
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: fastPolicy,
      sleep: async () => {},
      openOverride,
    });

    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);
    expect(mgr.isDisabled(guildId)).toBeDefined();

    await mgr.close(guildId);
    expect(mgr.isDisabled(guildId)).toBeUndefined();

    // After the database recovers, the next getConnection succeeds.
    shouldFail = false;
    const conn = await mgr.getConnection(guildId);
    expect(conn.guildId).toBe(guildId);
  });

  it('caps the backoff delay at maxDelayMs', async () => {
    const sleep = vi.fn(async () => {});
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      throw transientError();
    });
    // 5 attempts -> 4 backoff sleeps: 100, 200, 400, then capped at 500.
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 500 },
      sleep,
      openOverride,
    });

    await expect(mgr.getConnection(guildId)).rejects.toBeInstanceOf(DatabaseError);
    expect(sleep.mock.calls).toEqual([[100], [200], [400], [500]]);
  });

  it('wraps a non-DatabaseError thrown by open into a typed DatabaseError', async () => {
    const openOverride = vi.fn(async (): Promise<GuildConnection> => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:27017');
    });
    const mgr = new StaticConnectionManager(fakeConnection, {
      retryPolicy: { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 10 },
      sleep: async () => {},
      openOverride,
    });

    const rejection = await mgr.getConnection(guildId).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(DatabaseError);
    // ECONNREFUSED is classified as a network failure.
    expect((rejection as DatabaseError).code).toBe('DATABASE_NETWORK');
  });
});
