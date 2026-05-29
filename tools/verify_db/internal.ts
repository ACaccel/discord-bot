/**
 * Pure, unit-testable internals for `verify_db`. The main entry point
 * (`verify_db.ts`) is process-lifecycle code (mongoose connection,
 * stdout writes, exit code wiring); the helpers here are extracted so
 * `verify_db.test.ts` can exercise them without booting Mongo.
 *
 * No top-level side effects, no file I/O beyond what callers explicitly
 * pass in. The only environment touch is reading `process.stderr.isTTY`
 * inside the default progress-writer factory — and even that is
 * overridable via the `tty` parameter so tests can pin the behaviour
 * deterministically.
 */
import { readFileSync } from 'node:fs';

import { ConfigurationError } from '../../src/core/errors/configuration-error';

export interface ToolConfig {
  readonly mongoUri: string;
  readonly guildId: string;
  readonly sampleLimit: number;
  readonly outputPath: string | null;
}

/**
 * Parse the operator-supplied `config.json`. Path is injected so unit
 * tests can point at fixture files rather than the gitignored real
 * config.
 */
export const parseConfig = (configPath: string): ToolConfig => {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigurationError({
      code: 'MISSING_ENV',
      messageKey: 'errors:config.missing',
      context: {
        operation: 'verify_db.parseConfig',
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
        operation: 'verify_db.parseConfig',
        input: { configPath, reason: 'malformed JSON' },
      },
      cause: err instanceof Error ? err : undefined,
    });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ConfigurationError({
      code: 'INVALID_CONFIG_JSON',
      messageKey: 'errors:config.invalid',
      context: {
        operation: 'verify_db.parseConfig',
        input: { configPath, reason: 'root must be a JSON object' },
      },
    });
  }
  const obj = parsed as Record<string, unknown>;

  const fieldError = (field: string, reason: string): ConfigurationError =>
    new ConfigurationError({
      code: 'INVALID_CONFIG_JSON',
      messageKey: 'errors:config.invalid',
      context: {
        operation: 'verify_db.parseConfig',
        input: { configPath, field, reason },
      },
    });

  const mongoUri = obj['mongo_uri'];
  if (typeof mongoUri !== 'string' || mongoUri.length === 0) {
    throw fieldError('mongo_uri', 'must be a non-empty string');
  }
  const guildId = obj['guild_id'];
  if (typeof guildId !== 'string' || !/^\d+$/.test(guildId)) {
    throw fieldError('guild_id', 'must be an all-digit string');
  }
  let sampleLimit = 50;
  const sampleLimitRaw = obj['sample_limit'];
  if (sampleLimitRaw !== undefined && sampleLimitRaw !== null) {
    if (
      typeof sampleLimitRaw !== 'number' ||
      !Number.isInteger(sampleLimitRaw) ||
      sampleLimitRaw < 0
    ) {
      throw fieldError('sample_limit', 'must be a non-negative integer');
    }
    sampleLimit = sampleLimitRaw;
  }
  let outputPath: string | null = null;
  const outputPathRaw = obj['output_path'];
  if (outputPathRaw !== undefined && outputPathRaw !== null) {
    if (typeof outputPathRaw !== 'string' || outputPathRaw.length === 0) {
      throw fieldError('output_path', 'must be null or a non-empty string');
    }
    outputPath = outputPathRaw;
  }
  return { mongoUri, guildId, sampleLimit, outputPath };
};

/**
 * Splice the guild db name between the host and the query string and
 * default `authSource=admin` when omitted. Mirrors the production
 * `buildGuildMongoUri` in `src/infra/mongo/connection-manager.ts` —
 * without this, mongoose authenticates against the per-guild database
 * (where the operator user typically does not exist) and the connection
 * fails with "Authentication failed."
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

/**
 * Stream-agnostic progress writer. The real tool wires this to
 * `process.stderr`; tests inject an in-memory sink to assert on the
 * emitted control sequences.
 *
 * When `tty` is true the writer uses a `\r` + ANSI clear-line escape so
 * the same physical line is rewritten in place (operator watching live
 * sees one line per step). When false, each call writes a fresh line
 * terminated by `\n` so CI / file-redirected logs stay readable.
 */
export interface ProgressSink {
  write(text: string): void;
}

export const createProgressWriter = (
  sink: ProgressSink,
  tty: boolean,
): ((line: string, terminate: boolean) => void) => {
  return (line: string, terminate: boolean): void => {
    if (tty) {
      sink.write(`\r\x1b[2K${line}${terminate ? '\n' : ''}`);
    } else {
      sink.write(`${line}\n`);
    }
  };
};
