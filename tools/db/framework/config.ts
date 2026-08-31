/**
 * Unified configuration for the `db` ops CLI.
 *
 * One `config.json` carries a shared connection block (`mongo_uri`,
 * `guilds`, `output_path`) plus an `operations` map keyed by subcommand
 * name. The shared block is always validated here; each operation's slice
 * is validated lazily by that command's own schema at dispatch time (see
 * {@link parseOptions}), so a half-filled section for one command never
 * blocks a run of another.
 *
 * Validation uses zod and fails fast, mapping every failure onto the
 * project's structured {@link ConfigurationError} so the error taxonomy
 * (stable `code` + i18n `messageKey`) stays uniform with the rest of the
 * codebase.
 *
 * No top-level side effects beyond what callers pass in: the config path
 * is injected so unit tests can point at fixtures rather than the
 * gitignored real config.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { ConfigurationError } from '../../../src/core/errors/configuration-error';

/** Validated, normalized connection block common to every command. */
export interface SharedConfig {
  /** Base URI normalized to host-with-trailing-slash, as `buildGuildMongoUri` expects. */
  readonly mongoUri: string;
  /** One or more all-digit guild ids; each is a separate per-guild database. */
  readonly guilds: readonly string[];
  /** When set, the JSON report is written here instead of stdout. */
  readonly outputPath: string | null;
}

/** The parsed config: the shared block plus the raw per-operation slices. */
interface UnifiedConfig {
  readonly shared: SharedConfig;
  /** Raw, unvalidated option objects keyed by subcommand name. */
  readonly operations: Readonly<Record<string, unknown>>;
}

const guildIdSchema = z.string().regex(/^\d+$/, 'must be an all-digit string');

const unifiedConfigSchema = z.object({
  mongo_uri: z.string().min(1, 'must be a non-empty string'),
  guilds: z.array(guildIdSchema).min(1, 'must be a non-empty array of all-digit guild id strings'),
  output_path: z.string().min(1, 'must be null or a non-empty string').nullable().default(null),
  operations: z.record(z.unknown()).default({}),
});

/**
 * Build a {@link ConfigurationError} from a zod failure, surfacing the
 * first offending field path and reason so the operator can fix the
 * exact key. `configPath` is included in the error context when known.
 */
const configErrorFromZod = (
  error: z.ZodError,
  operation: string,
  configPath: string | undefined,
): ConfigurationError => {
  const issue = error.issues[0];
  const field = issue !== undefined && issue.path.length > 0 ? issue.path.join('.') : '<root>';
  const reason = issue !== undefined ? issue.message : 'invalid configuration';
  return new ConfigurationError({
    code: 'INVALID_CONFIG_JSON',
    messageKey: 'errors:config.invalid',
    context: {
      operation,
      input: { ...(configPath !== undefined ? { configPath } : {}), field, reason },
    },
  });
};

/**
 * Validate one command's slice of `operations` against its schema. Used
 * at dispatch time so each command owns its options contract; zod
 * failures (including a missing required field such as `mode`) become a
 * structured {@link ConfigurationError} rather than a raw `ZodError`.
 */
export const parseOptions = <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: unknown,
  commandName: string,
): T => {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw configErrorFromZod(result.error, `db.${commandName}`, undefined);
  }
  return result.data;
};

/**
 * Read, parse, and validate the operator-supplied `config.json`. A read
 * failure is a `MISSING_ENV` configuration error; malformed JSON or a
 * shared-block schema violation is `INVALID_CONFIG_JSON`. The `mongo_uri`
 * is normalized to the host-with-trailing-slash shape `buildGuildMongoUri`
 * expects (query string stripped, single trailing slash re-asserted).
 */
export const loadConfig = (configPath: string): UnifiedConfig => {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigurationError({
      code: 'MISSING_ENV',
      messageKey: 'errors:config.missing',
      context: { operation: 'db.loadConfig', input: { configPath, reason } },
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
      context: { operation: 'db.loadConfig', input: { configPath, reason: 'malformed JSON' } },
      cause: err instanceof Error ? err : undefined,
    });
  }

  const result = unifiedConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw configErrorFromZod(result.error, 'db.loadConfig', configPath);
  }
  const data = result.data;

  const mongoUriHost = data.mongo_uri.split('?', 1)[0] ?? data.mongo_uri;
  const mongoUri = `${mongoUriHost.replace(/\/+$/, '')}/`;

  return {
    shared: { mongoUri, guilds: data.guilds, outputPath: data.output_path },
    operations: data.operations,
  };
};
