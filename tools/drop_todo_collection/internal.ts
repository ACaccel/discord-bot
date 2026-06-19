/**
 * Pure, unit-testable internals for `drop_todo_collection`. The process
 * entry point (`drop_todo_collection.ts`) owns the mongoose lifecycle,
 * per-guild orchestration, and exit-code wiring; the helpers here are
 * referentially transparent given their arguments so
 * `drop_todo_collection.test.ts` can exercise them without booting Mongo.
 *
 * Context: the `todo_list` feature was permanently retired. Its data
 * lived in a `todos` collection inside each guild's own database
 * (`{baseUri}{guildId}`). This one-off tool drops that collection per
 * guild so no orphaned data is left behind. See the sibling README for
 * the runbook (audit with `dry_run: true`, then drop).
 *
 * No top-level side effects, no file I/O beyond what callers explicitly
 * pass in.
 */
import { readFileSync } from 'node:fs';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

/** The MongoDB collection Mongoose pluralised the `Todo` model into. */
export const TODOS_COLLECTION = 'todos';

export interface DropTodoConfig {
  /** Base MongoDB URI; the per-guild db name is spliced in by {@link buildGuildUri}. */
  readonly mongoUri: string;
  /** All-digit guild ids; each is a separate per-guild database. */
  readonly guilds: readonly string[];
  /**
   * When true (the default), the tool only counts the `todos` documents
   * it would remove and writes nothing — drops happen only on an
   * explicit `dry_run: false`. Defaulting to a dry run keeps an
   * accidental run non-destructive.
   */
  readonly dryRun: boolean;
  /** Write the JSON report here instead of stdout when set. */
  readonly outputPath: string | null;
}

const configError = (configPath: string, field: string, reason: string): ConfigurationError =>
  new ConfigurationError({
    code: 'INVALID_CONFIG_JSON',
    messageKey: 'errors:config.invalid',
    context: {
      operation: 'drop_todo_collection.parseConfig',
      input: { configPath, field, reason },
    },
  });

/**
 * Parse the operator-supplied `config.json`. Path is injected so unit
 * tests can point at fixture files rather than the gitignored real
 * config. `dry_run` defaults to `true` so an unconfigured run never
 * deletes data.
 */
export const parseConfig = (configPath: string): DropTodoConfig => {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigurationError({
      code: 'MISSING_ENV',
      messageKey: 'errors:config.missing',
      context: {
        operation: 'drop_todo_collection.parseConfig',
        input: { configPath, reason },
      },
      cause: err instanceof Error ? err : undefined,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    throw new ConfigurationError({
      code: 'INVALID_CONFIG_JSON',
      messageKey: 'errors:config.invalid',
      context: {
        operation: 'drop_todo_collection.parseConfig',
        input: { configPath, reason: 'malformed JSON' },
      },
      cause: err instanceof Error ? err : undefined,
    });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw configError(configPath, '<root>', 'must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;

  const mongoUri = obj['mongo_uri'];
  if (typeof mongoUri !== 'string' || mongoUri.length === 0) {
    throw configError(configPath, 'mongo_uri', 'must be a non-empty string');
  }

  const guildsRaw = obj['guilds'];
  if (!Array.isArray(guildsRaw) || guildsRaw.length === 0) {
    throw configError(configPath, 'guilds', 'must be a non-empty array of guild id strings');
  }
  const guilds: string[] = [];
  for (const g of guildsRaw) {
    if (typeof g !== 'string' || !/^\d+$/.test(g)) {
      throw configError(
        configPath,
        'guilds[]',
        `each entry must be an all-digit string, got ${String(g)}`,
      );
    }
    guilds.push(g);
  }

  let dryRun = true;
  const dryRunRaw = obj['dry_run'];
  if (dryRunRaw !== undefined && dryRunRaw !== null) {
    if (typeof dryRunRaw !== 'boolean') {
      throw configError(configPath, 'dry_run', 'must be a boolean');
    }
    dryRun = dryRunRaw;
  }

  let outputPath: string | null = null;
  const outputPathRaw = obj['output_path'];
  if (outputPathRaw !== undefined && outputPathRaw !== null) {
    if (typeof outputPathRaw !== 'string' || outputPathRaw.length === 0) {
      throw configError(configPath, 'output_path', 'must be null or a non-empty string');
    }
    outputPath = outputPathRaw;
  }

  return { mongoUri, guilds, dryRun, outputPath };
};

/**
 * Splice the guild db name between the host and the query string and
 * default `authSource=admin` when omitted. Mirrors the production
 * `buildGuildMongoUri` in `src/infra/mongo/connection-manager.ts` (and
 * the sibling `verify_db` tool) — without this, mongoose authenticates
 * against the per-guild database (where the operator user typically does
 * not exist) and the connection fails with "Authentication failed."
 */
export const buildGuildUri = (baseUri: string, guildId: string): string => {
  const [hostPart, queryPart] = baseUri.split('?', 2);
  const trimmedHost = (hostPart ?? '').replace(/\/+$/, '');
  const dbPart = `${trimmedHost}/${guildId}`;
  const params = new URLSearchParams(queryPart ?? '');
  if (!params.has('authSource')) {
    params.set('authSource', 'admin');
  }
  return `${dbPart}?${params.toString()}`;
};
