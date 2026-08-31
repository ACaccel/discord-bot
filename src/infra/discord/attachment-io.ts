/**
 * Attachment file I/O shared by the deleted-attachment archive and the
 * pre-delete attachment cache: bounded downloads, the archive's naming
 * and layout, non-overwriting publication, and the process-wide
 * download-slot bound.
 *
 * Both callers need the same guarantees — a wall-clock deadline, a size
 * ceiling, a bounded redirect chain, no truncated file left behind, and
 * no silent overwrite of an earlier forensic file — so the mechanics
 * live here once instead of being copied into each.
 *
 * The download slots are process-wide, so cache traffic and delete-time
 * fallbacks compete for the same four. That is deliberate: a per-call
 * bound would let a burst of uploads open an unbounded number of
 * sockets, at the cost of a fallback occasionally queueing behind
 * caching work.
 *
 * Nothing here logs: the caller owns the log line, because the same
 * failure means different things on the two paths (a 404 at delete time
 * is the expected CDN purge race; a 404 while the message is live is
 * not).
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'node:stream/promises';

/** Root of the forensic archive tree. `data/` is gitignored. */
const ARCHIVE_ROOT = './data/deleted_attachments';

/**
 * Wall-clock budget for one CDN download. Discord's attachment CDN can
 * accept a connection and then stall, or trickle bytes indefinitely;
 * without a deadline the transfer promise never settles and the open
 * file descriptor leaks for the lifetime of the process.
 *
 * Enforced with `AbortSignal.timeout`, not axios's `timeout` option:
 * the latter maps to socket *inactivity*, which a slow trickle resets
 * forever.
 */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Upper bound on a single downloaded attachment. Matches the largest
 * upload Discord accepts from a boosted guild, so nothing that could
 * legitimately have been posted is refused, while a malformed or
 * hostile `Content-Length` cannot fill the disk.
 */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/**
 * Simultaneous downloads across one batch. A bulk delete can carry 100
 * messages; without a bound every attachment starts at once and the
 * process holds 100 sockets and 100 file descriptors open.
 */
const MAX_CONCURRENT_DOWNLOADS = 4;

/** Where {@link downloadToFile} gave up. */
type DownloadStage = 'mkdir' | 'fetch' | 'write';

/** Why one download did not produce a complete file. */
interface DownloadFailure {
  readonly stage: DownloadStage;
  readonly error: Error;
  /** HTTP status when the failure carried one; `undefined` otherwise. */
  readonly status: number | undefined;
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/**
 * Read an HTTP status off a rejected request structurally rather than
 * through `axios.isAxiosError`, so the value survives a test double
 * that mocks the axios module wholesale.
 */
const httpStatusOf = (value: unknown): number | undefined => {
  const status = (value as { response?: { status?: unknown } } | null | undefined)?.response
    ?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Bytes left for the upload name after the cache's `<snowflake>-`
 * prefix, the archive's timestamp prefix, and a `.part` suffix, under
 * the 255-byte ceiling every mainstream filesystem imposes on one path
 * segment. Over it the write fails with `ENAMETOOLONG` and the
 * attachment is simply never archived.
 */
const MAX_NAME_BYTES = 160;

/** Trim to `MAX_NAME_BYTES` while keeping the extension readable. */
const capLength = (name: string): string => {
  if (Buffer.byteLength(name) <= MAX_NAME_BYTES) return name;
  const extension = path.extname(name).slice(0, 16);
  const stem = name.slice(0, name.length - path.extname(name).length);
  const budget = MAX_NAME_BYTES - Buffer.byteLength(extension);
  let trimmed = stem;
  while (Buffer.byteLength(trimmed) > budget) trimmed = trimmed.slice(0, -1);
  return `${trimmed}${extension}`;
};

/**
 * Reduce an attachment name to a single bounded path segment. Discord
 * sanitises upload names, but the value still crosses a trust boundary
 * before it is joined onto a local path — a separator or a `..` in it
 * would write outside the tree the caller intended.
 */
export const sanitizeFileName = (name: string): string => {
  const base = path.basename(name.replaceAll('\\', '/'));
  return base.length === 0 || base === '.' || base === '..' ? 'attachment' : capLength(base);
};

const tzDate = (): string => `${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} `;

/**
 * Timestamp-prefixed archive file name. The prefix is what keeps two
 * deletions of the same file name from overwriting each other.
 */
const archiveFileName = (name: string): string =>
  `${tzDate().replaceAll('/', '_').replaceAll(':', '_')}${sanitizeFileName(name)}`;

/**
 * Destination an archived attachment lands at. Both the download path
 * and the cache path resolve it here, so there is one archive layout
 * rather than two that can drift.
 */
export const archiveFilePath = (
  guildId: string,
  name: string,
  archiveRoot: string = ARCHIVE_ROOT,
): string => path.join(archiveRoot, guildId, archiveFileName(name));

/**
 * Suffix of a file still being written. A reader that walks the tree
 * must skip these: only the published name is a complete file.
 */
export const PARTIAL_SUFFIX = '.part';

/**
 * How many name collisions to walk past before giving up. The archive
 * name is timestamped to the second, so a batch published within one
 * second collides by construction; the ceiling only stops an unbounded
 * loop against a pathological directory.
 */
const MAX_PUBLISH_ATTEMPTS = 50;

/** `name.ext` -> `name-2.ext`, so the suffix stays before the extension. */
const withOrdinal = (destination: string, ordinal: number): string => {
  const extension = path.extname(destination);
  const stem = destination.slice(0, destination.length - extension.length);
  return `${stem}-${String(ordinal)}${extension}`;
};

/**
 * Move `source` to `candidate` only if that name is free.
 * Returns `false` when it is already taken.
 *
 * `link` + `unlink` rather than `rename`, because `rename` silently
 * overwrites and this tree is a forensic archive: losing an earlier
 * file to a same-second name collision is exactly the kind of silent
 * data loss the archive exists to prevent.
 */
const claimName = async (source: string, candidate: string): Promise<boolean> => {
  try {
    await fs.promises.link(source, candidate);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    // `link` cannot cross a filesystem boundary. The cache and the
    // archive normally share one, but an operator may mount `data/`
    // subtrees separately, and losing the file to that is not
    // acceptable when a copy costs one extra pass over the bytes.
    if (code !== 'EXDEV') throw e;
    try {
      await fs.promises.copyFile(source, candidate, fs.constants.COPYFILE_EXCL);
    } catch (copyError) {
      if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') return false;
      // The exclusive flag means this file is ours, so a partial copy
      // (a full disk, typically) is ours to remove rather than leave
      // behind reading as a complete archive.
      await fs.promises.unlink(candidate).catch(() => undefined);
      throw copyError;
    }
  }
  await fs.promises.unlink(source);
  return true;
};

/**
 * Publish `source` at `destination`, appending an ordinal when that
 * name is taken. Never overwrites an existing file.
 *
 * @throws when the filesystem refuses the move, or when every candidate
 *   name up to {@link MAX_PUBLISH_ATTEMPTS} is already taken.
 */
export const publishFile = async (source: string, destination: string): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? destination : withOrdinal(destination, attempt);
    if (await claimName(source, candidate)) return;
  }
  throw new Error(`publishFile: every candidate name for ${destination} is taken`);
};

/**
 * Fetch `url` and write the body to `filePath`, creating the parent
 * directory first.
 *
 * The body streams into a `.part` sibling and is published under the
 * real name only once complete, so a crash, a stalled transfer, or a
 * reader racing the download never sees a truncated file at a name that
 * reads as a finished one.
 *
 * Never rejects: it returns `undefined` on success and a
 * {@link DownloadFailure} describing where it stopped otherwise, so the
 * caller decides both the log level and whether a retry is worthwhile.
 */
export const downloadToFile = async (
  url: string,
  filePath: string,
): Promise<DownloadFailure | undefined> => {
  const staging = `${filePath}${PARTIAL_SUFFIX}`;
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  } catch (e) {
    return { stage: 'mkdir', error: toError(e), status: undefined };
  }

  let response;
  try {
    response = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      maxContentLength: MAX_ATTACHMENT_BYTES,
      maxRedirects: 3,
    });
  } catch (e) {
    return { stage: 'fetch', error: toError(e), status: httpStatusOf(e) };
  }

  try {
    // `pipeline` propagates a failure from either end and destroys both
    // streams; a hand-rolled `pipe` + `finish` listener ignores source
    // errors, leaving the promise pending and the write handle open.
    await pipeline(response.data, fs.createWriteStream(staging));
    await publishFile(staging, filePath);
  } catch (e) {
    await fs.promises.unlink(staging).catch(() => undefined);
    return { stage: 'write', error: toError(e), status: undefined };
  }

  return undefined;
};

/**
 * Process-wide download slots. The bound has to be global, not
 * per-call: `messageCreate` starts a cache download per message without
 * waiting, so a per-call limiter would still let a burst of uploads put
 * an unbounded number of sockets and file descriptors in flight.
 */
let inFlight = 0;
const waiting: (() => void)[] = [];

const acquireSlot = async (): Promise<void> => {
  if (inFlight < MAX_CONCURRENT_DOWNLOADS) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
};

const releaseSlot = (): void => {
  // Hand the slot straight to the next waiter rather than freeing and
  // re-taking it, so a caller arriving in between cannot overshoot the
  // ceiling.
  const next = waiting.shift();
  if (next !== undefined) {
    next();
    return;
  }
  inFlight -= 1;
};

/**
 * Run `worker` over `items`, each holding one of the process-wide
 * download slots. Resolves once every item has been attempted; rejects
 * only if `worker` itself rejects, so callers pass a worker that
 * swallows its failures.
 */
export const runBounded = async <T>(
  items: Iterable<T>,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  await Promise.all(
    [...items].map(async (item) => {
      await acquireSlot();
      try {
        await worker(item);
      } finally {
        releaseSlot();
      }
    }),
  );
};
