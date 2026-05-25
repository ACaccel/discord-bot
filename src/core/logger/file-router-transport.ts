/**
 * In-process file-routing sink for pino.
 *
 * Each JSON Lines record written here is dispatched to a file chosen
 * from its `bot` / `guildId` bindings, rotating on the local-time day
 * boundary. The sink runs in the same Node process as the bot (as a
 * `Writable` consumed by {@link import('pino').multistream}) — no
 * worker thread, no `require.resolve` dance for TypeScript source vs.
 * compiled output, and a clean `close` that flushes every cached file
 * descriptor synchronously enough for graceful shutdown.
 *
 * Why not `pino.transport({ target: 'pino-abstract-transport' })`:
 *   - the worker entry point would need to resolve to a JS file at
 *     runtime, which is awkward when the project runs through
 *     `ts-node` (the worker thread does not inherit the parent's
 *     `--loader` flags) and adds a build step purely for tests.
 *   - the routing rules are pure record-content branching plus a
 *     write-stream cache; no separate process is required.
 *   - keeping the sink in-process keeps the bot's `process.exit`
 *     story crisp: when `installProcessHandlers` triggers a shutdown
 *     the cached streams are ended on the same event loop.
 *
 * Routing rules:
 *   - records carrying `guildId` →
 *     `<rootDir>/<bot>/<guildId>/<YYYY-MM-DD>.log`
 *   - records without `guildId` (system / bot-level lines) →
 *     `<rootDir>/<bot>/<YYYY-MM-DD>.log`
 *   - records without `bot` (only possible in the pre-bind window)
 *     fall back to `<rootDir>/_unbound/<YYYY-MM-DD>.log` so nothing
 *     is silently dropped.
 *
 * Layer purity: only Node built-ins (`fs`, `path`, `stream`). No
 * discord.js / mongoose / our own infra — `core/**` stays clean. The
 * `time` field on each record is left as pino's UTC ISO so the file
 * is unambiguous to read across timezones; only *file selection* uses
 * local time so rotation happens at the operator's midnight.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';

export interface FileRouterOptions {
  /** Root directory under which `<botId>[/<guildId>]/<date>.log` lives. */
  readonly rootDir: string;
}

interface CachedStream {
  /** `YYYY-MM-DD` of the local-time day the stream was opened on. */
  date: string;
  stream: WriteStream;
}

const UNBOUND_BUCKET = '_unbound';

/**
 * Format a `Date` as `YYYY-MM-DD` using the operator's local timezone.
 * `getMonth()` is 0-based so the `+1` is intentional.
 */
const localDateKey = (now: Date): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const targetFilePath = (
  rootDir: string,
  botId: string,
  guildId: string | undefined,
  date: string,
): string => {
  if (guildId !== undefined && guildId.length > 0) {
    return join(rootDir, botId, guildId, `${date}.log`);
  }
  return join(rootDir, botId, `${date}.log`);
};

const cacheKey = (botId: string | undefined, guildId: string | undefined): string => {
  const bot = botId !== undefined && botId.length > 0 ? botId : UNBOUND_BUCKET;
  const guild = guildId !== undefined && guildId.length > 0 ? guildId : '';
  return `${bot}|${guild}`;
};

const openStream = (filePath: string): WriteStream => {
  mkdirSync(dirname(filePath), { recursive: true });
  return createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
};

const endStreamAsync = (stream: WriteStream): Promise<void> =>
  new Promise<void>((resolve) => {
    // Resolve on `close` unconditionally; an already-errored stream
    // would otherwise stall shutdown waiting for a callback that will
    // never fire.
    stream.once('close', () => {
      resolve();
    });
    stream.end();
  });

/**
 * Build a pino-compatible `Writable` that routes each JSON Lines
 * record to a per-(bot,guild) file with local-date rotation. Pass
 * the returned stream into `pino.multistream(...)` alongside any
 * other targets (pretty console, alternate sinks).
 *
 * The stream receives whatever `pino.multistream` writes — by default
 * a single JSON Lines string per record, no trailing partial line. We
 * split defensively on `\n` to tolerate batched writes from future
 * pino versions that might coalesce multiple records into one chunk.
 */
export const createFileRouterStream = (options: FileRouterOptions): Writable => {
  if (typeof options.rootDir !== 'string' || options.rootDir.length === 0) {
    throw new Error(
      'file-router-transport: rootDir option is required and must be a non-empty string',
    );
  }
  const rootDir = options.rootDir;
  const cache = new Map<string, CachedStream>();
  // Buffer for partial lines (defensive; pino writes complete lines).
  let pending = '';

  const writeRecord = (line: string): void => {
    if (line.length === 0) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Malformed record — write it to the unbound bucket verbatim so
      // it is not lost; failing the whole stream would silence pino.
      const fallback = openOrRefresh(undefined, undefined);
      fallback.stream.write(`${line}\n`);
      return;
    }
    const botId = typeof obj['bot'] === 'string' ? (obj['bot'] as string) : undefined;
    const guildId = typeof obj['guildId'] === 'string' ? (obj['guildId'] as string) : undefined;
    const cached = openOrRefresh(botId, guildId);
    cached.stream.write(`${line}\n`);
  };

  const openOrRefresh = (botId: string | undefined, guildId: string | undefined): CachedStream => {
    const key = cacheKey(botId, guildId);
    const date = localDateKey(new Date());
    const existing = cache.get(key);
    if (existing !== undefined && existing.date === date) {
      return existing;
    }
    if (existing !== undefined) {
      // Day rolled over — fire-and-forget close the prior stream.
      void endStreamAsync(existing.stream);
      cache.delete(key);
    }
    const filePath = targetFilePath(rootDir, botId ?? UNBOUND_BUCKET, guildId, date);
    const fresh: CachedStream = { date, stream: openStream(filePath) };
    cache.set(key, fresh);
    return fresh;
  };

  return new Writable({
    decodeStrings: false,
    write(chunk: string | Buffer, _enc, cb): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      pending += text;
      let idx = pending.indexOf('\n');
      while (idx !== -1) {
        const line = pending.slice(0, idx);
        pending = pending.slice(idx + 1);
        writeRecord(line);
        idx = pending.indexOf('\n');
      }
      cb();
    },
    final(cb): void {
      // Drain any trailing partial line, then close every cached
      // stream. `Promise.all` is awaited inline so the pino flush path
      // sees a clean shutdown.
      if (pending.length > 0) {
        writeRecord(pending);
        pending = '';
      }
      const streams = Array.from(cache.values()).map((c) => c.stream);
      cache.clear();
      Promise.all(streams.map((s) => endStreamAsync(s)))
        .then(() => {
          cb();
        })
        .catch((err: unknown) => {
          cb(err instanceof Error ? err : new Error(String(err)));
        });
    },
  });
};
