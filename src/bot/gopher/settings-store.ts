/**
 * GopherSettingsStore — the single owner of gopher's runtime-mutable
 * settings and their persistence to `config.json`.
 *
 * Today the only mutable field is the self-hosted LLM `endpoint`. The store
 * holds the live value in memory (the auto-reply client reads it via
 * `getEndpoint` on every call) and `setEndpoint` both swaps that value and
 * rewrites `config.json` so the change survives a restart, preserving every
 * other key with a 2-space indent.
 *
 * Layering: this lives in the composition-root layer (`src/bot/**`), the
 * only place permitted to touch the filesystem and know `config.json`'s
 * path. The settings-api plugin receives narrow `getEndpoint` / `setEndpoint`
 * callbacks and stays oblivious to the file, so the plugin contract is not
 * widened into a config-file registrar.
 *
 * Validation note: input validation lives at the HTTP boundary (the
 * settings-api plugin's zod schema), so `setEndpoint` trusts it receives a
 * well-formed URL and focuses solely on persistence (single responsibility).
 */
import { readFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';

/** Shape of the `config.json` slice this store reads/writes. */
interface MutableConfigShape {
  llm_auto_reply?: { endpoint?: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

const readEndpoint = (raw: string): string => {
  const parsed = JSON.parse(raw) as MutableConfigShape;
  const endpoint = parsed.llm_auto_reply?.endpoint;
  return typeof endpoint === 'string' ? endpoint : '';
};

export class GopherSettingsStore {
  #endpoint: string;
  /**
   * Tail of the serialized persist chain. Overlapping `setEndpoint` calls
   * append to it so their read-modify-write of `config.json` never
   * interleaves (which could clobber a concurrent write or desync the file
   * from the in-memory value). A prior failure does not block later writes.
   */
  #writeChain: Promise<void> = Promise.resolve();

  /**
   * @param configPath absolute path to the bot's `config.json`. Read once
   *   synchronously at construction (boot time) to seed the live endpoint;
   *   `config.json` is already valid JSON here because the bot imports it.
   */
  public constructor(private readonly configPath: string) {
    this.#endpoint = readEndpoint(readFileSync(configPath, 'utf8'));
  }

  /** The current self-hosted LLM endpoint. */
  public getEndpoint(): string {
    return this.#endpoint;
  }

  /**
   * Swap the live endpoint and persist it back to `config.json`. The
   * in-memory value is updated first so a failed write does not desync the
   * running plugin from what the operator just set; the write is then
   * serialized behind any in-flight persist and made durable atomically.
   */
  public async setEndpoint(url: string): Promise<void> {
    this.#endpoint = url;
    // Chain onto the previous write regardless of whether it succeeded, so a
    // single failed persist cannot wedge the queue for all later updates.
    const done = this.#writeChain.then(
      () => this.persist(url),
      () => this.persist(url),
    );
    this.#writeChain = done.then(
      () => undefined,
      () => undefined,
    );
    await done;
  }

  /**
   * Read `config.json` fresh (so out-of-band edits to other keys survive),
   * set `llm_auto_reply.endpoint`, and replace the file atomically via a
   * temp file + rename so a crash mid-write cannot truncate the live config.
   */
  private async persist(url: string): Promise<void> {
    const raw = await readFile(this.configPath, 'utf8');
    const config = JSON.parse(raw) as MutableConfigShape;
    config.llm_auto_reply = { ...(config.llm_auto_reply ?? {}), endpoint: url };
    const tmpPath = `${this.configPath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.configPath);
  }
}
