/**
 * EarthquakePlugin — owns the `/discord/earthquake` HTTP webhook and
 * the per-guild earthquake-alert broadcast.
 *
 * This is a `scope: 'bot'` plugin assembled only by `nijika`. Its
 * `start` hook stands up the Express server; `onShutdown` closes it so
 * a fast restart does not leak the listening socket. The broadcast
 * logic lives in `internal/` so this file is lifecycle wiring only.
 *
 * Why a factory: the listen `port` is per-bot configuration captured
 * into the closure, mirroring the `createMessageBackupPlugin` pattern.
 */
import express, { type Express } from 'express';
import type { Server } from 'node:http';

import { TOKENS } from '../../core/plugin';
import { logError, logSystem } from '../../core/logger';
import type { Plugin } from '../../core/plugin';
import { broadcastEarthquakeAlert } from './internal';

const PLUGIN_ID = 'earthquake';
const PLUGIN_VERSION = '1.0.0';

/** Configuration for {@link createEarthquakePlugin}. */
export interface EarthquakePluginConfig {
  /** TCP port the earthquake webhook server listens on. */
  readonly port: number;
}

/**
 * Build the earthquake plugin. The returned object is pure data; all
 * mutable state (the HTTP server handle) is captured in the closure.
 */
export const createEarthquakePlugin = (rawConfig: EarthquakePluginConfig): Plugin => {
  const config: EarthquakePluginConfig = { port: rawConfig.port };
  let server: Server | undefined;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    // Not critical: a failed webhook server must not abort the bot —
    // the rest of nijika's features stay available.
    critical: false,

    async start(ctx): Promise<void> {
      const client = ctx.resolve(TOKENS.DiscordClient);
      const registry = ctx.resolve(TOKENS.GuildRegistry);
      const clientId = client.user?.id ?? 'unknown';

      const app: Express = express();
      app.use(express.json());
      const router = express.Router();
      app.use('/discord', router);

      router.get('/', (_req, res) => {
        res.status(200).send('Hello World!');
      });

      router.post('/earthquake', (_req, res) => {
        logSystem(ctx.logger, clientId, 'Earthquake alert webhook received; broadcasting.');
        // Respond 200 immediately; the per-guild broadcast runs
        // detached. `broadcastEarthquakeAlert` isolates each guild's
        // failure internally, so a single async IIFE with a defensive
        // catch is enough to keep this off the unhandledRejection path.
        void (async () => {
          try {
            await broadcastEarthquakeAlert(client, registry, ctx.translator, ctx.logger, clientId);
          } catch (err: unknown) {
            logError(ctx.logger, clientId, null, err);
          }
        })();
        res.status(200).send('OK');
      });

      await new Promise<void>((resolve, reject) => {
        const listening = app.listen(config.port, () => {
          logSystem(
            ctx.logger,
            clientId,
            `earthquake webhook server is running on port ${config.port}`,
          );
          resolve();
        });
        listening.on('error', reject);
        server = listening;
      });
    },

    async onShutdown(ctx): Promise<void> {
      if (server === undefined) return;
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = undefined;
      const client = ctx.resolve(TOKENS.DiscordClient);
      logSystem(ctx.logger, client.user?.id ?? 'unknown', 'earthquake webhook server closed');
    },
  };
};
