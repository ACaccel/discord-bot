/**
 * Configuration schema and defaults for the settings-api plugin.
 *
 * Defaults live here in code (zod `.default()`), so a bot may declare an
 * empty / partial `settings_api` block in its `config.json` and still
 * boot with a fully-formed, safe (disabled, loopback-bound) configuration.
 * `.strict()` surfaces a mistyped key at startup rather than silently
 * ignoring it.
 *
 * Security note: the API key is intentionally NOT part of this schema.
 * Secrets never live in `config.json`; the key is read from the validated
 * environment (`GOPHER_SETTINGS_API_KEY`) and injected by the composition
 * root. This block only carries the non-secret transport settings.
 */
import { z } from 'zod';

const ConfigSchema = z
  .object({
    /** Master switch. Off by default so the API is strictly opt-in. */
    enabled: z.boolean().default(false),
    /**
     * Network interface to bind. Defaults to `127.0.0.1` (loopback only):
     * the API mutates settings and persists `config.json`, so the safe
     * default is unreachable from outside the host. Set `0.0.0.0` to expose
     * it for remote use (pair with a firewall allow-list and TLS).
     */
    host: z.string().min(1).default('127.0.0.1'),
    /** URL prefix all routes are mounted under (must start with `/`). */
    basePath: z
      .string()
      .startsWith('/', 'basePath must start with "/"')
      .default('/settings'),
  })
  .strict();

export type SettingsApiPluginConfig = z.infer<typeof ConfigSchema>;

/**
 * Parse a raw `settings_api` config block into a fully-defaulted,
 * validated config. Passing `undefined` (the block is absent) yields the
 * all-defaults, disabled configuration rather than throwing.
 *
 * @throws {z.ZodError} when a provided value is the wrong type or an
 *   unknown key is present (fail-fast at composition time).
 */
export const parseSettingsApiConfig = (raw: unknown): SettingsApiPluginConfig =>
  ConfigSchema.parse(raw ?? {});
