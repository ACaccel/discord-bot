/**
 * Per-guild MongoDB connection lifecycle.
 *
 * Owns the SDK boundary to mongoose: opening, closing, and tracking
 * one `Connection` per guild id. Repositories receive a `Connection`
 * (via {@link ConnectionManager.getConnection}) and never touch
 * `mongoose.createConnection` themselves — that keeps `persistence/`
 * free of SDK lifecycle concerns and makes test substitution trivial.
 *
 * Why `infra/mongo/` and not `persistence/`:
 *   `persistence/` owns the mapping from domain to storage (schemas +
 *   repositories). Connection acquisition is the SDK boundary, the same
 *   category as a Discord client or LLM HTTP client. Per the layer
 *   contract (plan §1, layer rules, and architecture-reviewer consult).
 *
 * Resilience (gap D5):
 *   `getConnection` classifies a failed open via the `persistence/`
 *   error-translator. A *transient* failure (`DATABASE_TIMEOUT` /
 *   `DATABASE_NETWORK`) is retried with bounded exponential backoff; a
 *   *persistent* failure — or a transient one whose retries are
 *   exhausted — marks the guild **disabled**. Once disabled, every
 *   subsequent `getConnection(guildId)` short-circuits with the same
 *   `DatabaseError` (no further cluster traffic) until {@link close} /
 *   {@link closeAll} clears the marker. Each disabled marker carries a
 *   generated `traceId` so the user-facing `errors:db.guild_disabled`
 *   message can be grep-correlated to the structured boot log.
 *
 *   Per-URI sharing: `MongoConnectionManager` instances are pooled by
 *   base URI in the composition root (`BaseBot.sharedConnectionManagers`).
 *   Because the disabled set is now manager-internal state, two bots
 *   that share one base URI also share one disabled set — a guild
 *   disabled for one is disabled for the other. This is intentional:
 *   they target the same physical database, so the failure is the
 *   same failure.
 */
import mongoose, { type Connection, type Model } from 'mongoose';
import type { GuildId } from '../../core/ids';
import { SCHEMAS, type DocByName, type SchemaName } from '../../persistence/schemas';
import { DatabaseError } from '../../core/errors/external-service-error';
import { databaseErrorFrom, isTransient } from '../../persistence/error-translator';

/**
 * Typed model registry for one guild connection. Replaces the legacy
 * `Record<string, Model<any>>` map.
 */
export type Models = {
  readonly [K in SchemaName]: Model<DocByName[K]>;
};

export interface GuildConnection {
  readonly guildId: GuildId;
  readonly connection: Connection;
  readonly models: Models;
}

/**
 * Disabled-guild marker. Returned by {@link ConnectionManager.isDisabled}
 * so the handler layer can render `errors:db.guild_disabled` with a
 * `traceId` that matches the structured log line written when the
 * guild was disabled.
 */
export interface DisabledGuildState {
  /** Stable id linking the user-facing message to the boot log. */
  readonly traceId: string;
  /** The classified failure that caused the guild to be disabled. */
  readonly error: DatabaseError;
}

/**
 * Bounded-backoff retry policy for transient connection failures.
 *
 * Defaults: up to 3 attempts (1 initial + 2 retries), 200 ms initial
 * delay doubling each retry, capped at 2 s. The policy is constructor-
 * injectable so tests can drive deterministic, fast retries.
 */
export interface RetryPolicy {
  /** Total attempts including the first. Must be >= 1. */
  readonly maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  readonly initialDelayMs: number;
  /** Upper bound on any single backoff delay, in milliseconds. */
  readonly maxDelayMs: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 2_000,
});

/** Injectable sleep so tests advance backoff without real wall time. */
type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Generate a short, stable trace id for correlating logs to user messages. */
const generateTraceId = (): string => Math.random().toString(36).slice(2, 8).padStart(6, '0');

/**
 * Validate and assemble a per-guild MongoDB URI.
 *
 * Discord snowflake ids are digit-only; rejecting anything else here
 * prevents URI injection via crafted guild ids (e.g. a `guildId` that
 * embeds `?` would silently rewrite the connection's query string).
 */
export const buildGuildMongoUri = (baseUri: string, guildId: string): string => {
  if (guildId.length === 0) {
    throw new TypeError('buildGuildMongoUri: guildId must be non-empty');
  }
  if (!/^\d+$/.test(guildId)) {
    throw new TypeError(`buildGuildMongoUri: guildId must be all digits, got "${guildId}"`);
  }
  return `${baseUri}${guildId}?authSource=admin`;
};

const buildModels = (connection: Connection): Models => ({
  Fetch: connection.model<DocByName['Fetch']>('Fetch', SCHEMAS.Fetch),
  Message: connection.model<DocByName['Message']>('Message', SCHEMAS.Message),
  Reply: connection.model<DocByName['Reply']>('Reply', SCHEMAS.Reply),
  Todo: connection.model<DocByName['Todo']>('Todo', SCHEMAS.Todo),
  Giveaway: connection.model<DocByName['Giveaway']>('Giveaway', SCHEMAS.Giveaway),
  Activity: connection.model<DocByName['Activity']>('Activity', SCHEMAS.Activity),
  UserApiSetting: connection.model<DocByName['UserApiSetting']>(
    'UserApiSetting',
    SCHEMAS.UserApiSetting,
  ),
});

/**
 * Run every model's index build, tolerating per-model rejections.
 *
 * Pre-Phase-2 the bot relied on mongoose's lazy `autoIndex` and
 * tolerated index-build failures silently. Phase 2 added `await
 * m.init()` to close a startup race between
 * `insertManyIgnoringDuplicates` and the auto-built unique index.
 *
 * But treating every init failure as fatal is strictly worse for the
 * operator: a single permission gap or one collection with legacy
 * duplicates would block ALL DB commands across EVERY guild. So we
 * `allSettled`: we still await the build (race window stays closed
 * when permissions/data are OK), but rejections drop a stderr line
 * and the connection stays serving. Each init runs in its own task so
 * the per-model `name` stays in scope on rejection. Stderr keeps this
 * layer free of cross-imports into core/logger.
 */
const initModelsBestEffort = async (models: Models, guildId: GuildId): Promise<void> => {
  await Promise.allSettled(
    Object.entries(models).map(async ([name, model]) => {
      try {
        await model.init();
      } catch (err: unknown) {
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        process.stderr.write(
          `[mongo] model.init() failed for ${name} on guild ${guildId}: ${reason}. ` +
            `Connection kept open; indexes may be missing.\n`,
        );
        throw err;
      }
    }),
  );
};

/**
 * Shared transient-retry / persistent-disable loop for both
 * {@link ConnectionManager} implementations.
 *
 * Runs `open` up to `policy.maxAttempts` times. A failure is
 * classified via the `persistence/` error-translator: a *transient*
 * error with attempts remaining triggers a capped exponential-backoff
 * `sleep` and a retry; a *persistent* error — or an exhausted
 * transient one — is handed to `onDisable` (so the caller records the
 * guild as disabled) and then rethrown as a typed {@link DatabaseError}.
 *
 * Extracted as a free function so `MongoConnectionManager` and
 * `StaticConnectionManager` share one resilience implementation and
 * cannot drift; each manager keeps its own `onDisable` (the production
 * manager additionally writes an operator-facing stderr line).
 */
const retryOpen = async (params: {
  readonly guildId: GuildId;
  readonly operation: string;
  readonly policy: RetryPolicy;
  readonly sleep: SleepFn;
  readonly open: (guildId: GuildId) => Promise<GuildConnection>;
  readonly onDisable: (guildId: GuildId, error: DatabaseError) => void;
}): Promise<GuildConnection> => {
  const { guildId, operation, policy, sleep, open, onDisable } = params;
  const { maxAttempts, initialDelayMs, maxDelayMs } = policy;
  let lastError: DatabaseError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await open(guildId);
    } catch (raw: unknown) {
      const dbError =
        raw instanceof DatabaseError
          ? raw
          : databaseErrorFrom(raw, { operation, input: { guildId, attempt } });
      lastError = dbError;

      const retriable = isTransient(dbError) && attempt < maxAttempts;
      if (!retriable) break;

      // Exponential backoff, capped: 200ms, 400ms, 800ms, ... <= maxDelayMs.
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }

  // Retries exhausted or a persistent failure: disable the guild so
  // subsequent calls short-circuit, and rethrow the typed error.
  const error =
    lastError ??
    databaseErrorFrom(new Error('connection open produced no error'), {
      operation,
      input: { guildId },
    });
  onDisable(guildId, error);
  throw error;
};

/**
 * Connection acquisition contract. Implementations:
 *   - {@link MongoConnectionManager}: production, talks to a real cluster.
 *   - {@link StaticConnectionManager}: wraps an externally-managed
 *     connection (mongodb-memory-server) for integration tests.
 */
export interface ConnectionManager {
  /**
   * Open (or return the cached) connection for `guildId`. The returned
   * `GuildConnection` carries the strongly-typed `Models` map.
   *
   * Throws a {@link DatabaseError} if the open fails. Transient
   * failures are retried internally before the throw; a guild that
   * fails persistently (or exhausts its retries) is marked disabled —
   * see {@link isDisabled}.
   */
  getConnection(guildId: GuildId): Promise<GuildConnection>;
  /**
   * Query the disabled state of a guild. Returns `undefined` when the
   * guild is healthy (or has never been opened), or a
   * {@link DisabledGuildState} carrying the `traceId` and the
   * classified failure when the guild has been disabled.
   */
  isDisabled(guildId: GuildId): DisabledGuildState | undefined;
  /** Close every open guild connection. Safe to call multiple times. */
  closeAll(): Promise<void>;
  /** Close a single guild connection if open; no-op otherwise. */
  close(guildId: GuildId): Promise<void>;
}

/**
 * Default {@link ConnectionManager} backed by `mongoose.createConnection`.
 *
 * Connections are cached per guild id; concurrent `getConnection` calls
 * for the same guild dedupe via the in-flight promise so the cluster is
 * not hit twice during a startup race.
 */
export class MongoConnectionManager implements ConnectionManager {
  private readonly cache = new Map<GuildId, GuildConnection>();
  private readonly pending = new Map<GuildId, Promise<GuildConnection>>();
  private readonly disabled = new Map<GuildId, DisabledGuildState>();
  private readonly retryPolicy: RetryPolicy;
  private readonly sleep: SleepFn;

  /**
   * @param baseUri    Base MongoDB URI; the guild id + `authSource` are
   *                   appended per guild by {@link buildGuildMongoUri}.
   * @param retryPolicy Bounded-backoff policy for transient failures.
   *                   Defaults to {@link DEFAULT_RETRY_POLICY}.
   * @param sleep      Injectable delay primitive — tests pass a no-op
   *                   to keep backoff retries instantaneous.
   */
  constructor(
    private readonly baseUri: string,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    sleep: SleepFn = realSleep,
  ) {
    this.retryPolicy = retryPolicy;
    this.sleep = sleep;
  }

  public async getConnection(guildId: GuildId): Promise<GuildConnection> {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;

    // A disabled guild short-circuits without touching the cluster.
    // The marker is cleared by close()/closeAll() so a recovered guild
    // can be retried on the next process boot.
    const disabledState = this.disabled.get(guildId);
    if (disabledState !== undefined) {
      throw disabledState.error;
    }

    const inFlight = this.pending.get(guildId);
    if (inFlight !== undefined) return inFlight;

    const promise = this.openWithRetry(guildId).finally(() => {
      this.pending.delete(guildId);
    });
    this.pending.set(guildId, promise);
    return promise;
  }

  public isDisabled(guildId: GuildId): DisabledGuildState | undefined {
    return this.disabled.get(guildId);
  }

  public async close(guildId: GuildId): Promise<void> {
    // Clearing the disabled marker on close lets the next boot retry a
    // guild whose database has since recovered.
    this.disabled.delete(guildId);
    const entry = this.cache.get(guildId);
    if (entry === undefined) return;
    this.cache.delete(guildId);
    await entry.connection.close();
  }

  public async closeAll(): Promise<void> {
    this.disabled.clear();
    const entries = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(entries.map((e) => e.connection.close()));
  }

  /** Open with bounded-backoff retry for transient failures (see {@link retryOpen}). */
  private openWithRetry(guildId: GuildId): Promise<GuildConnection> {
    return retryOpen({
      guildId,
      operation: 'MongoConnectionManager.open',
      policy: this.retryPolicy,
      sleep: this.sleep,
      open: (id) => this.open(id),
      onDisable: (id, error) => this.markDisabled(id, error),
    });
  }

  /**
   * Record a guild as disabled, generating the correlation `traceId`
   * and writing one operator-facing stderr line. Idempotent: the first
   * marker wins so the `traceId` stays stable across repeated failures.
   */
  private markDisabled(guildId: GuildId, error: DatabaseError): void {
    if (this.disabled.has(guildId)) return;
    const traceId = generateTraceId();
    this.disabled.set(guildId, { traceId, error });
    process.stderr.write(
      `[mongo] guild ${guildId} disabled after connection failure ` +
        `(code=${error.code}, traceId=${traceId}): ${error.message}\n`,
    );
  }

  private async open(guildId: GuildId): Promise<GuildConnection> {
    const uri = buildGuildMongoUri(this.baseUri, guildId);
    const connection = await mongoose.createConnection(uri).asPromise();
    try {
      const models = buildModels(connection);
      // Best-effort index initialization — see initModelsBestEffort.
      // A rejected init does NOT fail the open; the connection stays
      // serving. The bot's structured logger separately reports
      // "MongoDB for guild ... connected".
      await initModelsBestEffort(models, guildId);
      const entry: GuildConnection = { guildId, connection, models };
      this.cache.set(guildId, entry);
      return entry;
    } catch (err: unknown) {
      // Reached only when something OTHER than `m.init()` throws
      // (e.g. `buildModels` itself). The mongoose connection is open
      // at this point — close it so a failed cold-start does not leak
      // a TCP socket and the next `getConnection` retries cleanly.
      try {
        await connection.close();
      } catch {
        // Suppress: the original error is what callers need to see;
        // close failures during cleanup must not mask it.
      }
      throw err;
    }
  }
}

/**
 * Adapter that wraps an externally-managed `Connection` (typically the
 * mongodb-memory-server in integration tests). Lets tests reuse the same
 * `ConnectionManager` contract without spinning per-guild URIs.
 *
 * The `openOverride` constructor hook lets a test inject a failing
 * `open` so the transient-retry / persistent-disable behaviour of the
 * {@link ConnectionManager} contract can be exercised deterministically
 * without a real cluster.
 */
export class StaticConnectionManager implements ConnectionManager {
  private readonly cache = new Map<GuildId, GuildConnection>();
  private readonly pending = new Map<GuildId, Promise<GuildConnection>>();
  private readonly disabled = new Map<GuildId, DisabledGuildState>();
  private readonly retryPolicy: RetryPolicy;
  private readonly sleep: SleepFn;
  private readonly openOverride?: (guildId: GuildId) => Promise<GuildConnection>;

  /**
   * @param underlying  Externally-managed mongoose connection.
   * @param options     Optional retry policy, sleep primitive, and an
   *                    `openOverride` failure-injection hook for tests.
   */
  constructor(
    private readonly underlying: Connection,
    options: {
      readonly retryPolicy?: RetryPolicy;
      readonly sleep?: SleepFn;
      readonly openOverride?: (guildId: GuildId) => Promise<GuildConnection>;
    } = {},
  ) {
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.sleep = options.sleep ?? realSleep;
    this.openOverride = options.openOverride;
  }

  public async getConnection(guildId: GuildId): Promise<GuildConnection> {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;

    const disabledState = this.disabled.get(guildId);
    if (disabledState !== undefined) {
      throw disabledState.error;
    }

    const inFlight = this.pending.get(guildId);
    if (inFlight !== undefined) return inFlight;

    const promise = this.openWithRetry(guildId).finally(() => {
      this.pending.delete(guildId);
    });
    this.pending.set(guildId, promise);
    return promise;
  }

  public isDisabled(guildId: GuildId): DisabledGuildState | undefined {
    return this.disabled.get(guildId);
  }

  public async close(guildId: GuildId): Promise<void> {
    this.disabled.delete(guildId);
    this.cache.delete(guildId);
  }

  public async closeAll(): Promise<void> {
    this.disabled.clear();
    this.cache.clear();
  }

  /**
   * Open with bounded-backoff retry for transient failures, via the
   * shared {@link retryOpen} loop — so the static adapter and the
   * production manager behave identically against the
   * `ConnectionManager` contract.
   */
  private openWithRetry(guildId: GuildId): Promise<GuildConnection> {
    return retryOpen({
      guildId,
      operation: 'StaticConnectionManager.open',
      policy: this.retryPolicy,
      sleep: this.sleep,
      open: (id) => this.open(id),
      onDisable: (id, error) => this.markDisabled(id, error),
    });
  }

  private markDisabled(guildId: GuildId, error: DatabaseError): void {
    if (this.disabled.has(guildId)) return;
    const traceId = generateTraceId();
    this.disabled.set(guildId, { traceId, error });
  }

  /**
   * Build the guild connection from the externally-managed connection,
   * or delegate to the injected `openOverride` failure hook.
   *
   * Blocks until every model's declared indexes are present (notably
   * the unique index on `Message.messageId` that
   * `insertManyIgnoringDuplicates` depends on). Without this, the first
   * insert of a suite races the auto-index build and unique constraints
   * silently do not enforce.
   */
  private async open(guildId: GuildId): Promise<GuildConnection> {
    if (this.openOverride !== undefined) {
      return this.openOverride(guildId);
    }
    const models = buildModels(this.underlying);
    await Promise.all(Object.values(models).map((m) => m.init()));
    const entry: GuildConnection = {
      guildId,
      connection: this.underlying,
      models,
    };
    this.cache.set(guildId, entry);
    return entry;
  }
}
